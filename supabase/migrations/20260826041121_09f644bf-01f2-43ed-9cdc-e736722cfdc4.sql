ALTER TABLE public.billing_ack_state
  ADD COLUMN IF NOT EXISTS recovery_ciphertext text,
  ADD COLUMN IF NOT EXISTS recovery_key_version integer,
  ADD COLUMN IF NOT EXISTS recovery_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz;

ALTER TABLE public.billing_ack_state DROP CONSTRAINT IF EXISTS billing_ack_state_status_chk;
ALTER TABLE public.billing_ack_state ADD CONSTRAINT billing_ack_state_status_chk
  CHECK (status IN ('pending','ack_in_progress','acknowledged','not_required','recovery_required','failed_terminal'));

CREATE INDEX IF NOT EXISTS idx_billing_ack_recovery_expiry
  ON public.billing_ack_state (recovery_expires_at)
  WHERE recovery_ciphertext IS NOT NULL;

-- Atomically claim due acknowledgement work. SKIP LOCKED plus a lease means
-- concurrent workers never take the same row.
CREATE OR REPLACE FUNCTION public.claim_billing_ack_work(
  _owner text,
  _limit integer DEFAULT 50,
  _lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  purchase_token_hash text,
  user_id uuid,
  product_id text,
  status text,
  attempts integer,
  next_attempt_at timestamptz,
  recovery_ciphertext text,
  recovery_key_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT b.purchase_token_hash
    FROM public.billing_ack_state b
    WHERE b.status IN ('pending','ack_in_progress')
      AND b.next_attempt_at <= now()
      AND (b.lease_until IS NULL OR b.lease_until <= now())
    ORDER BY b.next_attempt_at ASC
    LIMIT greatest(1, least(coalesce(_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.billing_ack_state b
     SET lease_owner = _owner,
         lease_until = now() + make_interval(secs => greatest(30, least(coalesce(_lease_seconds,120), 900))),
         status = 'ack_in_progress'
    FROM due
   WHERE b.purchase_token_hash = due.purchase_token_hash
  RETURNING b.purchase_token_hash, b.user_id, b.product_id, b.status, b.attempts,
            b.next_attempt_at, b.recovery_ciphertext, b.recovery_key_version;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_billing_ack_work(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_ack_work(text, integer, integer) TO service_role;

-- Record an acknowledgement outcome. A row that is already terminal-successful
-- is never overwritten by a slower/stale worker.
CREATE OR REPLACE FUNCTION public.complete_billing_ack(
  _hash text,
  _owner text,
  _status text,
  _attempts integer,
  _last_error text,
  _next_attempt_at timestamptz,
  _acknowledged_at timestamptz,
  _clear_recovery boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated integer;
BEGIN
  UPDATE public.billing_ack_state b
     SET status = _status,
         attempts = greatest(b.attempts, _attempts),
         last_error = _last_error,
         last_attempt_at = now(),
         next_attempt_at = coalesce(_next_attempt_at, now()),
         acknowledged_at = coalesce(b.acknowledged_at, _acknowledged_at),
         lease_owner = NULL,
         lease_until = NULL,
         recovery_ciphertext = CASE WHEN _clear_recovery THEN NULL ELSE b.recovery_ciphertext END,
         recovery_key_version = CASE WHEN _clear_recovery THEN NULL ELSE b.recovery_key_version END,
         recovery_expires_at = CASE WHEN _clear_recovery THEN NULL ELSE b.recovery_expires_at END
   WHERE b.purchase_token_hash = _hash
     AND b.status NOT IN ('acknowledged','not_required')
     AND (_owner IS NULL OR b.lease_owner IS NULL OR b.lease_owner = _owner);
  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_billing_ack(text, text, text, integer, text, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_billing_ack(text, text, text, integer, text, timestamptz, timestamptz, boolean) TO service_role;

-- Retention: recoverable ciphertext is deleted once it is no longer needed.
CREATE OR REPLACE FUNCTION public.purge_expired_ack_recovery()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _purged integer;
BEGIN
  UPDATE public.billing_ack_state
     SET recovery_ciphertext = NULL,
         recovery_key_version = NULL,
         recovery_expires_at = NULL
   WHERE recovery_ciphertext IS NOT NULL
     AND (recovery_expires_at IS NULL
          OR recovery_expires_at <= now()
          OR status IN ('acknowledged','not_required'));
  GET DIAGNOSTICS _purged = ROW_COUNT;
  RETURN _purged;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_ack_recovery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_ack_recovery() TO service_role;