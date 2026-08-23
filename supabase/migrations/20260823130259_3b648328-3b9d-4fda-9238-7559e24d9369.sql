-- =========================================================
-- PHASE 9 (step 2/2) — SUBSCRIPTIONS + AD-POLICY FOUNDATION
-- Server-authoritative entitlements, Play-billing event model,
-- configurable plan limits, ad configuration.
-- =========================================================

-- ---------- 1. entitlements: lifecycle columns ----------
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS entitlement_key TEXT NOT NULL DEFAULT 'premium',
  ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS purchase_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS event_seq BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.entitlements.event_seq IS
  'Monotonic authoritative billing-event sequence. A lower-sequence event can never overwrite this row.';

-- Entitlements are written only by SECURITY DEFINER code / service_role.
CREATE OR REPLACE FUNCTION public.guard_entitlement_tables()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden: entitlement state is server-authoritative'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_entitlements ON public.entitlements;
CREATE TRIGGER trg_guard_entitlements
BEFORE INSERT OR UPDATE OR DELETE ON public.entitlements
FOR EACH ROW EXECUTE FUNCTION public.guard_entitlement_tables();

-- ---------- 2. subscription_products ----------
CREATE TABLE IF NOT EXISTS public.subscription_products (
  id TEXT PRIMARY KEY,
  entitlement_key TEXT NOT NULL DEFAULT 'premium',
  plan public.subscription_tier NOT NULL DEFAULT 'pro',
  platform TEXT NOT NULL DEFAULT 'google_play',
  base_plan_id TEXT,
  offer_id TEXT,
  period TEXT NOT NULL DEFAULT 'monthly',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscription_products TO authenticated;
GRANT ALL ON public.subscription_products TO service_role;
ALTER TABLE public.subscription_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_select_active" ON public.subscription_products;
CREATE POLICY "products_select_active" ON public.subscription_products
  FOR SELECT TO authenticated USING (is_active);

-- Catalogue placeholders. No public price is stored here: Google Play remains
-- the authoritative price/offer surface for Play-distributed builds.
INSERT INTO public.subscription_products (id, plan, base_plan_id, period, sort_order)
VALUES
  ('synctogether.premium.monthly', 'pro', 'premium-monthly', 'monthly', 1),
  ('synctogether.premium.yearly',  'pro', 'premium-yearly',  'yearly',  2)
ON CONFLICT (id) DO NOTHING;

-- ---------- 3. subscription_events (append-only history) ----------
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google_play',
  product_id TEXT,
  purchase_token_hash TEXT,
  event_type TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_seq BIGINT NOT NULL DEFAULT 0,
  applied BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT NOT NULL DEFAULT 'applied',
  dedupe_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_events_user ON public.subscription_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_events_token ON public.subscription_events(purchase_token_hash);

-- Read-own only. Never any client DML: billing history must stay auditable.
GRANT SELECT ON public.subscription_events TO authenticated;
GRANT ALL ON public.subscription_events TO service_role;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sub_events_select_own" ON public.subscription_events;
CREATE POLICY "sub_events_select_own" ON public.subscription_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS trg_guard_subscription_events ON public.subscription_events;
CREATE TRIGGER trg_guard_subscription_events
BEFORE INSERT OR UPDATE OR DELETE ON public.subscription_events
FOR EACH ROW EXECUTE FUNCTION public.guard_entitlement_tables();

-- ---------- 4. configurable plan limits ----------
CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan_key TEXT PRIMARY KEY,
  limits JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plan_limits TO authenticated;
GRANT ALL ON public.plan_limits TO service_role;
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_limits_select" ON public.plan_limits;
CREATE POLICY "plan_limits_select" ON public.plan_limits FOR SELECT TO authenticated USING (true);

INSERT INTO public.plan_limits (plan_key, limits) VALUES
  ('free', '{
     "max_active_rooms": 25,
     "max_room_members": 10,
     "max_call_minutes": 45,
     "max_local_media_minutes": 30,
     "max_playlists": 5,
     "ads_enabled": true
   }'::jsonb),
  ('premium', '{
     "max_active_rooms": 100,
     "max_room_members": 50,
     "max_call_minutes": 240,
     "max_local_media_minutes": 120,
     "max_playlists": 100,
     "ads_enabled": false
   }'::jsonb)
ON CONFLICT (plan_key) DO NOTHING;

-- ---------- 5. remote ad configuration (frequency caps) ----------
CREATE TABLE IF NOT EXISTS public.ad_config (
  id BOOLEAN PRIMARY KEY DEFAULT true,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ad_config_singleton CHECK (id)
);
GRANT SELECT ON public.ad_config TO authenticated;
GRANT ALL ON public.ad_config TO service_role;
ALTER TABLE public.ad_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_config_select" ON public.ad_config;
CREATE POLICY "ad_config_select" ON public.ad_config FOR SELECT TO authenticated USING (true);

-- Deliberately conservative defaults (documented in the Phase 9 report).
INSERT INTO public.ad_config (id, config) VALUES (true, '{
  "ads_enabled": true,
  "min_seconds_between_fullscreen": 180,
  "max_fullscreen_per_session": 2,
  "min_seconds_after_app_open_ad": 120,
  "min_session_seconds_before_first_fullscreen": 90,
  "banner_enabled": true,
  "app_open_enabled": false,
  "interstitial_enabled": true
}'::jsonb) ON CONFLICT (id) DO NOTHING;

-- ---------- 6. authoritative entitlement snapshot ----------
CREATE OR REPLACE FUNCTION public.entitlement_snapshot(_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e public.entitlements%ROWTYPE;
  _status TEXT;
  _premium BOOLEAN := false;
  _limits JSONB;
BEGIN
  SELECT * INTO _e FROM public.entitlements WHERE user_id = _user_id;
  IF NOT FOUND THEN
    _status := 'expired';
  ELSE
    _status := _e.status::TEXT;
    IF _status = 'active' AND _e.plan <> 'free' THEN
      IF _e.expires_at IS NULL OR _e.expires_at > now() THEN
        _premium := true;
      ELSE
        _status := 'expired';
      END IF;
    ELSIF _status = 'grace_period' AND _e.plan <> 'free' THEN
      IF _e.grace_until IS NULL OR _e.grace_until > now() THEN
        _premium := true;
      ELSE
        _status := 'expired';
      END IF;
    END IF;
    -- pending / paused / revoked / expired never grant premium.
  END IF;

  SELECT limits INTO _limits FROM public.plan_limits
   WHERE plan_key = CASE WHEN _premium THEN 'premium' ELSE 'free' END;

  RETURN jsonb_build_object(
    'ok', true,
    'plan', CASE WHEN _premium THEN 'premium' ELSE 'free' END,
    'premium', _premium,
    'raw_plan', COALESCE(_e.plan::TEXT, 'free'),
    'status', _status,
    'source', COALESCE(_e.source::TEXT, 'system'),
    'entitlement_key', COALESCE(_e.entitlement_key, 'premium'),
    'product_id', _e.product_id,
    'starts_at', _e.starts_at,
    'expires_at', _e.expires_at,
    'grace_until', _e.grace_until,
    'cancel_at_period_end', COALESCE(_e.cancel_at_period_end, false),
    'updated_at', _e.updated_at,
    'ads_enabled', COALESCE((_limits->>'ads_enabled')::BOOLEAN, true),
    'limits', COALESCE(_limits, '{}'::jsonb)
  );
END; $$;
REVOKE ALL ON FUNCTION public.entitlement_snapshot(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_premium(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.entitlement_snapshot(_user_id)->>'premium')::BOOLEAN, false);
$$;
REVOKE ALL ON FUNCTION public.is_premium(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_premium(UUID) TO authenticated;

-- The caller's own authoritative entitlement. Never trusts client input.
CREATE OR REPLACE FUNCTION public.my_entitlement()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  RETURN public.entitlement_snapshot(_uid);
END; $$;
REVOKE ALL ON FUNCTION public.my_entitlement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_entitlement() TO authenticated;

-- Own billing history, with no tokens or provider payload secrets.
CREATE OR REPLACE FUNCTION public.my_subscription_events(_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  RETURN jsonb_build_object('ok', true, 'events', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'event_type', e.event_type,
      'event_time', e.event_time,
      'product_id', e.product_id,
      'outcome', e.outcome,
      'applied', e.applied
    ) ORDER BY e.event_time DESC)
    FROM (SELECT * FROM public.subscription_events
           WHERE user_id = _uid ORDER BY event_time DESC
           LIMIT LEAST(GREATEST(COALESCE(_limit,20),1),100)) e
  ), '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.my_subscription_events(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_subscription_events(INTEGER) TO authenticated;

-- ---------- 7. authoritative billing event application ----------
-- Called ONLY by trusted server code (service_role) after the purchase has
-- been verified against the platform. Idempotent, replay-safe and monotonic.
CREATE OR REPLACE FUNCTION public.apply_billing_event(
  _user_id UUID,
  _event_type TEXT,
  _provider TEXT DEFAULT 'google_play',
  _product_id TEXT DEFAULT NULL,
  _purchase_token TEXT DEFAULT NULL,
  _event_seq BIGINT DEFAULT 0,
  _event_time TIMESTAMPTZ DEFAULT now(),
  _expires_at TIMESTAMPTZ DEFAULT NULL,
  _grace_until TIMESTAMPTZ DEFAULT NULL,
  _cancel_at_period_end BOOLEAN DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- A purchase token belongs to exactly one account: reuse on another account
  -- is rejected outright so a leaked token cannot mint a second entitlement.
  IF _hash IS NOT NULL THEN
    SELECT user_id INTO _owner FROM public.subscription_events
     WHERE purchase_token_hash = _hash AND user_id <> _user_id LIMIT 1;
    IF _owner IS NOT NULL THEN
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
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
      'entitlement', public.entitlement_snapshot(_user_id));
  END IF;

  SELECT * INTO _cur FROM public.entitlements WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.entitlements (user_id) VALUES (_user_id);
    SELECT * INTO _cur FROM public.entitlements WHERE user_id = _user_id FOR UPDATE;
  END IF;

  -- Stale / out-of-order events are recorded but never applied.
  IF COALESCE(_event_seq,0) < _cur.event_seq THEN
    UPDATE public.subscription_events SET outcome = 'stale_ignored' WHERE dedupe_key = _dedupe;
    RETURN jsonb_build_object('ok', true, 'stale', true,
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
      -- Cancelled but still paid for: premium stays until expiry.
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
      -- Pending is NEVER premium.
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

  RETURN jsonb_build_object('ok', true, 'applied', true,
    'entitlement', public.entitlement_snapshot(_user_id));
END; $$;
REVOKE ALL ON FUNCTION public.apply_billing_event(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_event(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB)
  TO service_role;

-- ---------- 8. admin manual grant (audited) ----------
CREATE OR REPLACE FUNCTION public.admin_grant_entitlement(
  _user_id UUID, _reason TEXT, _expires_at TIMESTAMPTZ DEFAULT NULL, _revoke BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _seq BIGINT;
  _res JSONB;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT COALESCE(event_seq, 0) + 1 INTO _seq FROM public.entitlements WHERE user_id = _user_id;

  _res := public.apply_billing_event(
    _user_id,
    CASE WHEN _revoke THEN 'revoked' ELSE 'admin_grant' END,
    'admin', NULL, NULL, COALESCE(_seq, 1), now(), _expires_at, NULL, NULL,
    jsonb_build_object('actor_id', _uid, 'reason', left(_reason, 500)));

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid,
          CASE WHEN _revoke THEN 'entitlement.admin_revoke' ELSE 'entitlement.admin_grant' END,
          'entitlement', _user_id,
          jsonb_build_object('reason', left(_reason, 500), 'expires_at', _expires_at));

  RETURN _res;
END; $$;
REVOKE ALL ON FUNCTION public.admin_grant_entitlement(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_entitlement(UUID, TEXT, TIMESTAMPTZ, BOOLEAN) TO authenticated;

-- Support view: status + event history, never tokens or payment credentials.
CREATE OR REPLACE FUNCTION public.admin_subscription_overview(_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.is_staff(_uid) THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'entitlement', public.entitlement_snapshot(_user_id),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_type', e.event_type, 'event_time', e.event_time, 'provider', e.provider,
        'product_id', e.product_id, 'outcome', e.outcome, 'applied', e.applied,
        'event_seq', e.event_seq) ORDER BY e.event_time DESC)
      FROM (SELECT * FROM public.subscription_events WHERE user_id = _user_id
             ORDER BY event_time DESC LIMIT 50) e), '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.admin_subscription_overview(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_subscription_overview(UUID) TO authenticated;

-- ---------- 9. server-side usage limit enforcement ----------
CREATE OR REPLACE FUNCTION public.enforce_room_entitlement_limits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _limits JSONB;
  _active INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- trusted server/service paths
  _limits := public.entitlement_snapshot(NEW.owner_id)->'limits';

  IF NEW.max_members > COALESCE((_limits->>'max_room_members')::INTEGER, 10) THEN
    RAISE EXCEPTION 'premium_required: room capacity above your plan limit'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO _active FROM public.rooms
   WHERE owner_id = NEW.owner_id
     AND status IN ('draft','active','paused')
     AND (expires_at IS NULL OR expires_at > now());

  IF _active >= COALESCE((_limits->>'max_active_rooms')::INTEGER, 25) THEN
    RAISE EXCEPTION 'limit_reached: active room limit for your plan'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_room_entitlement_limits ON public.rooms;
CREATE TRIGGER trg_enforce_room_entitlement_limits
BEFORE INSERT ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.enforce_room_entitlement_limits();

-- Premium-only capacity control: a free host cannot raise a room above the
-- free cap, and the decision is made here, never in the client.
CREATE OR REPLACE FUNCTION public.set_room_capacity(_room_id UUID, _max_members INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF _room.host_id <> _uid AND _room.owner_id <> _uid THEN
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

  UPDATE public.rooms SET max_members = _max_members, updated_at = now() WHERE id = _room_id;
  RETURN jsonb_build_object('ok', true, 'max_members', _max_members);
END; $$;
REVOKE ALL ON FUNCTION public.set_room_capacity(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_room_capacity(UUID, INTEGER) TO authenticated;

-- Generic server-side gate used before premium-only or metered actions.
CREATE OR REPLACE FUNCTION public.entitlement_precheck(_feature TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _snap JSONB;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  _snap := public.entitlement_snapshot(_uid);
  IF _feature IN ('ad_free','premium_capacity','extended_call','extended_local_media')
     AND NOT (_snap->>'premium')::BOOLEAN THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'premium_required',
                              'entitlement', _snap);
  END IF;
  RETURN jsonb_build_object('ok', true, 'entitlement', _snap);
END; $$;
REVOKE ALL ON FUNCTION public.entitlement_precheck(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entitlement_precheck(TEXT) TO authenticated;