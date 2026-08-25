-- 1. Least-privilege grants on all monetization tables.
REVOKE ALL ON public.entitlements FROM anon, authenticated;
REVOKE ALL ON public.subscription_events FROM anon, authenticated;
REVOKE ALL ON public.subscription_products FROM anon, authenticated;
REVOKE ALL ON public.plan_limits FROM anon, authenticated;
REVOKE ALL ON public.ad_config FROM anon, authenticated;

GRANT SELECT ON public.entitlements TO authenticated;
GRANT SELECT ON public.subscription_events TO authenticated;
GRANT SELECT ON public.subscription_products TO authenticated;
GRANT SELECT ON public.plan_limits TO authenticated;
GRANT SELECT ON public.ad_config TO authenticated;

GRANT ALL ON public.entitlements TO service_role;
GRANT ALL ON public.subscription_events TO service_role;
GRANT ALL ON public.subscription_products TO service_role;
GRANT ALL ON public.plan_limits TO service_role;
GRANT ALL ON public.ad_config TO service_role;

-- 2. The entitlement guard must let the trusted billing routine through.
CREATE OR REPLACE FUNCTION public.guard_entitlement_tables()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE(current_setting('app.entitlement_write', true), '') = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'forbidden: entitlement state is server-authoritative'
    USING ERRCODE = '42501';
END; $$;

REVOKE ALL ON FUNCTION public.guard_entitlement_tables() FROM PUBLIC;

-- 3. Billing application: mark the trusted window, and report duplicates.
CREATE OR REPLACE FUNCTION public.apply_billing_event(
  _user_id uuid, _event_type text, _provider text DEFAULT 'google_play'::text,
  _product_id text DEFAULT NULL::text, _purchase_token text DEFAULT NULL::text,
  _event_seq bigint DEFAULT 0, _event_time timestamptz DEFAULT now(),
  _expires_at timestamptz DEFAULT NULL::timestamptz,
  _grace_until timestamptz DEFAULT NULL::timestamptz,
  _cancel_at_period_end boolean DEFAULT NULL::boolean,
  _metadata jsonb DEFAULT '{}'::jsonb)
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
BEGIN
  IF _user_id IS NULL OR _event_type IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _event_type NOT IN ('purchase_verified','renewed','restored','cancelled',
                         'grace_started','grace_ended','expired','revoked',
                         'paused','pending','admin_grant') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

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
             || '|' || _event_type || '|' || COALESCE(_event_seq, 0)::TEXT;

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
    expires_at = CASE WHEN _event_type IN ('revoked') THEN now()
                      WHEN _expires_at IS NOT NULL THEN _expires_at
                      ELSE expires_at END,
    grace_until = CASE WHEN _event_type = 'grace_started' THEN _grace_until
                       WHEN _event_type IN ('grace_ended','expired','revoked') THEN NULL
                       ELSE grace_until END,
    cancel_at_period_end = _cancel,
    last_event_at = COALESCE(_event_time, now()),
    event_seq = GREATEST(COALESCE(_event_seq,0), event_seq),
    updated_at = now()
  WHERE user_id = _user_id;

  UPDATE public.subscription_events SET applied = true, outcome = 'applied'
   WHERE dedupe_key = _dedupe;

  PERFORM set_config('app.entitlement_write', '0', true);
  RETURN jsonb_build_object('ok', true, 'applied', true, 'outcome', 'applied',
    'entitlement', public.entitlement_snapshot(_user_id));
END; $function$;

REVOKE ALL ON FUNCTION public.apply_billing_event(uuid, text, text, text, text, bigint,
  timestamptz, timestamptz, timestamptz, boolean, jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Room capacity is only changeable through set_room_capacity.
CREATE OR REPLACE FUNCTION public.guard_room_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.max_members IS DISTINCT FROM OLD.max_members
     AND auth.uid() IS NOT NULL
     AND COALESCE(current_setting('app.room_capacity_write', true), '') <> '1' THEN
    RAISE EXCEPTION 'forbidden: room capacity is server-authoritative'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.guard_room_capacity() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_room_capacity ON public.rooms;
CREATE TRIGGER trg_guard_room_capacity
BEFORE UPDATE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.guard_room_capacity();

CREATE OR REPLACE FUNCTION public.set_room_capacity(_room_id uuid, _max_members integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _limits JSONB;
  _joined INTEGER;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _max_members IS NULL OR _max_members < 2 OR _max_members > 50 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF COALESCE(_room.host_id, _room.owner_id) <> _uid AND _room.owner_id <> _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _room.status IN ('ended','archived') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;

  _limits := public.entitlement_snapshot(_uid)->'limits';
  IF _max_members > COALESCE((_limits->>'max_room_members')::INTEGER, 10) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'premium_required');
  END IF;

  SELECT count(*) INTO _joined FROM public.room_members
   WHERE room_id = _room_id AND status = 'joined';
  IF _max_members < _joined THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  PERFORM set_config('app.room_capacity_write', '1', true);
  UPDATE public.rooms SET max_members = _max_members, updated_at = now() WHERE id = _room_id;
  PERFORM set_config('app.room_capacity_write', '0', true);

  RETURN jsonb_build_object('ok', true, 'max_members', _max_members);
END; $function$;