-- PHASE 11: Real-time Developer Notification (RTDN) intake ledger.
-- Backend-only: no client role may read or write it.
CREATE TABLE IF NOT EXISTS public.play_rtdn_messages (
  message_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  notification_type INTEGER,
  purchase_token_hash TEXT,
  event_seq BIGINT NOT NULL DEFAULT 0,
  publish_time TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 1,
  outcome TEXT NOT NULL DEFAULT 'received',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS play_rtdn_messages_token_idx
  ON public.play_rtdn_messages (purchase_token_hash, event_seq DESC);

REVOKE ALL ON public.play_rtdn_messages FROM anon, authenticated;
GRANT ALL ON public.play_rtdn_messages TO service_role;
ALTER TABLE public.play_rtdn_messages ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (which bypasses RLS) may touch this table.

-- Allow verification failures / RTDN receipts to be recorded as audit-only
-- events. They deliberately fall through to the ELSE branch, so they never
-- change plan, status or expiry.
CREATE OR REPLACE FUNCTION public.apply_billing_event(_user_id uuid, _event_type text, _provider text DEFAULT 'google_play'::text, _product_id text DEFAULT NULL::text, _purchase_token text DEFAULT NULL::text, _event_seq bigint DEFAULT 0, _event_time timestamp with time zone DEFAULT now(), _expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _grace_until timestamp with time zone DEFAULT NULL::timestamp with time zone, _cancel_at_period_end boolean DEFAULT NULL::boolean, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _hash TEXT := CASE WHEN _purchase_token IS NULL THEN NULL
                     ELSE encode(sha256(_purchase_token::bytea), 'hex') END;
  _dedupe TEXT;
  _inserted BOOLEAN := false;
  _cur public.entitlements%ROWTYPE;
  _plan public.subscription_tier;
  _status public.entitlement_status;
  _cancel BOOLEAN;
  _owner UUID;
  _audit_only BOOLEAN;
BEGIN
  IF _user_id IS NULL OR _event_type IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _event_type NOT IN ('purchase_verified','renewed','restored','cancelled',
                         'grace_started','grace_ended','expired','revoked',
                         'paused','pending','admin_grant',
                         'verification_failed','rtdn_received') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  _audit_only := _event_type IN ('verification_failed','rtdn_received');

  PERFORM set_config('app.entitlement_write', '1', true);

  IF _hash IS NOT NULL THEN
    SELECT user_id INTO _owner FROM public.subscription_events
     WHERE purchase_token_hash = _hash AND user_id <> _user_id LIMIT 1;
    IF _owner IS NOT NULL THEN
      PERFORM set_config('app.entitlement_write', '0', true);
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
  END IF;

  _dedupe := COALESCE(_provider,'google_play') || '|' || COALESCE(_hash, _user_id::TEXT)
             || '|' || _event_type || '|' || COALESCE(_event_seq, 0)::TEXT
             || CASE WHEN _audit_only THEN '|' || clock_timestamp()::TEXT ELSE '' END;

  INSERT INTO public.subscription_events (
    user_id, provider, product_id, purchase_token_hash, event_type,
    event_time, event_seq, dedupe_key, metadata, applied, outcome)
  VALUES (_user_id, COALESCE(_provider,'google_play'), _product_id, _hash, _event_type,
          COALESCE(_event_time, now()), COALESCE(_event_seq,0), _dedupe,
          COALESCE(_metadata,'{}'::jsonb), false, 'recorded')
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;

  IF NOT _inserted THEN
    PERFORM set_config('app.entitlement_write', '0', true);
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'outcome', 'duplicate',
      'entitlement', public.entitlement_snapshot(_user_id));
  END IF;

  IF _audit_only THEN
    UPDATE public.subscription_events SET outcome = 'audit_only' WHERE dedupe_key = _dedupe;
    PERFORM set_config('app.entitlement_write', '0', true);
    RETURN jsonb_build_object('ok', true, 'outcome', 'audit_only',
      'entitlement', public.entitlement_snapshot(_user_id));
  END IF;

  SELECT * INTO _cur FROM public.entitlements WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.entitlements (user_id) VALUES (_user_id);
    SELECT * INTO _cur FROM public.entitlements WHERE user_id = _user_id FOR UPDATE;
  END IF;

  IF COALESCE(_event_seq,0) < _cur.event_seq THEN
    UPDATE public.subscription_events SET outcome = 'stale_ignored' WHERE dedupe_key = _dedupe;
    PERFORM set_config('app.entitlement_write', '0', true);
    RETURN jsonb_build_object('ok', true, 'stale', true, 'outcome', 'stale_ignored',
      'entitlement', public.entitlement_snapshot(_user_id));
  END IF;

  _plan   := _cur.plan;
  _status := _cur.status;
  _cancel := COALESCE(_cancel_at_period_end, _cur.cancel_at_period_end, false);

  CASE _event_type
    WHEN 'purchase_verified', 'renewed', 'restored', 'admin_grant' THEN
      _plan := 'pro'; _status := 'active';
      IF _event_type <> 'admin_grant' THEN _cancel := COALESCE(_cancel_at_period_end, false); END IF;
    WHEN 'cancelled' THEN
      _cancel := true;
    WHEN 'grace_started' THEN
      _status := 'grace_period';
    WHEN 'grace_ended', 'expired' THEN
      _plan := 'free'; _status := 'expired';
    WHEN 'revoked' THEN
      _plan := 'free'; _status := 'revoked';
    WHEN 'paused' THEN
      _status := 'paused';
    WHEN 'pending' THEN
      _plan := 'free'; _status := 'pending';
    ELSE NULL;
  END CASE;

  UPDATE public.entitlements SET
    plan = _plan,
    status = _status,
    source = CASE WHEN _event_type = 'admin_grant' THEN 'admin_grant'::public.entitlement_source
                  ELSE 'play_billing'::public.entitlement_source END,
    product_id = COALESCE(_product_id, product_id),
    purchase_token_hash = CASE WHEN _event_type = 'admin_grant' THEN purchase_token_hash
                               ELSE COALESCE(_hash, purchase_token_hash) END,
    expires_at = CASE WHEN _expires_at IS NOT NULL THEN _expires_at ELSE expires_at END,
    grace_until = CASE WHEN _grace_until IS NOT NULL THEN _grace_until ELSE grace_until END,
    cancel_at_period_end = _cancel,
    event_seq = GREATEST(COALESCE(_event_seq,0), _cur.event_seq),
    last_event_at = COALESCE(_event_time, now()),
    updated_at = now()
  WHERE user_id = _user_id;

  UPDATE public.subscription_events SET applied = true, outcome = 'applied'
   WHERE dedupe_key = _dedupe;

  PERFORM set_config('app.entitlement_write', '0', true);
  RETURN jsonb_build_object('ok', true, 'outcome', 'applied',
    'entitlement', public.entitlement_snapshot(_user_id));
END;
$function$;