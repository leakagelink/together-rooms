-- =========================================================
-- SyncTogether — Phase 2: secure room engine
-- =========================================================

-- ---------------------------------------------------------
-- 1. ENTITLEMENTS (server-controlled; replaces trust in profiles.subscription_tier)
-- ---------------------------------------------------------
CREATE TYPE public.entitlement_status AS ENUM ('active','expired','revoked','pending');
CREATE TYPE public.entitlement_source AS ENUM ('system','grant','promo','billing');

CREATE TABLE public.entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan public.subscription_tier NOT NULL DEFAULT 'free',
  source public.entitlement_source NOT NULL DEFAULT 'system',
  status public.entitlement_status NOT NULL DEFAULT 'active',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX idx_entitlements_user ON public.entitlements(user_id);

-- Read-only for the owner. No INSERT/UPDATE/DELETE grant to authenticated at all:
-- entitlement state is mutated exclusively by service_role / SECURITY DEFINER code.
GRANT SELECT ON public.entitlements TO authenticated;
GRANT ALL ON public.entitlements TO service_role;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entitlements_select_own" ON public.entitlements FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE TRIGGER trg_entitlements_updated BEFORE UPDATE ON public.entitlements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill an entitlement row for every existing user.
INSERT INTO public.entitlements (user_id, plan, source, status)
SELECT id, 'free', 'system', 'active' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- New users get one automatically.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.privacy_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  INSERT INTO public.entitlements (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Neutralize profiles.subscription_tier as a security boundary.
COMMENT ON COLUMN public.profiles.subscription_tier IS
  'DEPRECATED as of Phase 2. Display-only legacy column; NOT an entitlement source. Use public.entitlements.';

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (username, display_name, avatar_url, bio, updated_at) ON public.profiles TO authenticated;

-- Defence in depth: even a column grant mistake cannot escalate a tier.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role' AND auth.uid() IS NOT NULL THEN
    NEW.subscription_tier := OLD.subscription_tier;
    NEW.status := OLD.status;
    NEW.id := OLD.id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_profile_privileged_columns() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_profiles_guard BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();

-- Minimal entitlement read for feature gating.
CREATE OR REPLACE FUNCTION public.current_plan()
RETURNS public.subscription_tier LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT plan FROM public.entitlements
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND starts_at <= now()
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1),
    'free'::public.subscription_tier);
$$;
REVOKE ALL ON FUNCTION public.current_plan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_plan() TO authenticated;

-- ---------------------------------------------------------
-- 2. RATE LIMITING
-- ---------------------------------------------------------
CREATE TABLE public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, action, window_start)
);
CREATE INDEX idx_rate_limits_window ON public.rate_limits(window_start);

-- No grants to authenticated: only SECURITY DEFINER code touches this table.
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limits_no_client_access" ON public.rate_limits FOR SELECT TO authenticated USING (false);

CREATE OR REPLACE FUNCTION public.consume_rate_limit(_action TEXT, _limit INTEGER, _window_seconds INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _bucket TIMESTAMPTZ;
  _count INTEGER;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  _bucket := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  INSERT INTO public.rate_limits (user_id, action, window_start, count)
  VALUES (_uid, _action, _bucket, 1)
  ON CONFLICT (user_id, action, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO _count;

  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
  RETURN _count <= _limit;
END; $$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------
-- 3. ROOM LIFECYCLE HELPERS
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.room_is_joinable(_room public.rooms)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _room.status IN ('ended','archived') THEN 'room_ended'
    WHEN _room.status = 'draft' THEN 'room_not_open'
    WHEN _room.expires_at IS NOT NULL AND _room.expires_at <= now() THEN 'room_expired'
    ELSE 'ok'
  END;
$$;
REVOKE ALL ON FUNCTION public.room_is_joinable(public.rooms) FROM PUBLIC, anon, authenticated;

-- Shared, atomic membership creation. Assumes the caller already holds a row lock
-- on the room and has authorized the join path (code or invite).
CREATE OR REPLACE FUNCTION public.admit_member(_room public.rooms, _uid UUID, _via TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _reason TEXT;
  _existing public.room_members%ROWTYPE;
  _joined INTEGER;
BEGIN
  _reason := public.room_is_joinable(_room);
  IF _reason <> 'ok' THEN RETURN jsonb_build_object('ok', false, 'reason', _reason); END IF;

  SELECT * INTO _existing FROM public.room_members
   WHERE room_id = _room.id AND user_id = _uid FOR UPDATE;

  IF FOUND AND _existing.status = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF FOUND AND _existing.status = 'joined' THEN
    RETURN jsonb_build_object('ok', true, 'room_id', _room.id, 'already_member', true);
  END IF;

  -- Block semantics: cannot join a room containing someone in a block relationship.
  IF EXISTS (
    SELECT 1 FROM public.room_members m
     WHERE m.room_id = _room.id AND m.status = 'joined' AND m.user_id <> _uid
       AND public.is_blocked_between(m.user_id, _uid)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT count(*) INTO _joined FROM public.room_members
   WHERE room_id = _room.id AND status = 'joined';
  IF _joined >= _room.max_members THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_full');
  END IF;

  INSERT INTO public.room_members (room_id, user_id, role, status, joined_at, left_at)
  VALUES (_room.id, _uid, 'member', 'joined', now(), NULL)
  ON CONFLICT (room_id, user_id) DO UPDATE
    SET status = 'joined', role = 'member', joined_at = now(), left_at = NULL;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room.id, _uid, 'USER_JOINED', jsonb_build_object('via', _via));

  RETURN jsonb_build_object('ok', true, 'room_id', _room.id, 'already_member', false);
END; $$;
REVOKE ALL ON FUNCTION public.admit_member(public.rooms, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------
-- 4. JOIN BY CODE
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_room_by_code(_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _result JSONB;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  _code := upper(btrim(COALESCE(_code, '')));
  IF _code !~ '^[A-Z0-9]{6,12}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  IF NOT public.consume_rate_limit('join_code', 10, 600) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  -- Row lock serializes concurrent joins so capacity cannot be exceeded.
  SELECT * INTO _room FROM public.rooms WHERE join_code = _code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  _result := public.admit_member(_room, _uid, 'join_code');
  IF (_result->>'ok')::boolean THEN
    _result := _result || jsonb_build_object('room_name', _room.name);
  END IF;
  RETURN _result;
END; $$;
REVOKE ALL ON FUNCTION public.join_room_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room_by_code(TEXT) TO authenticated;

-- ---------------------------------------------------------
-- 5. INVITES
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_room_invite(
  _room_id UUID, _token_hash TEXT, _max_uses INTEGER, _expires_in_hours INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _invite_id UUID;
  _expires TIMESTAMPTZ;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _max_uses < 1 OR _max_uses > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _expires_in_hours < 1 OR _expires_in_hours > 720 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF NOT public.is_room_host(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF NOT public.consume_rate_limit('invite_create', 20, 3600) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  _expires := now() + make_interval(hours => _expires_in_hours);

  INSERT INTO public.room_invites (room_id, created_by, token_hash, max_uses, expires_at)
  VALUES (_room_id, _uid, _token_hash, _max_uses, _expires)
  RETURNING id INTO _invite_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'invite.created', 'room_invite', _invite_id,
          jsonb_build_object('room_id', _room_id, 'max_uses', _max_uses));

  RETURN jsonb_build_object('ok', true, 'invite_id', _invite_id, 'expires_at', _expires);
END; $$;
REVOKE ALL ON FUNCTION public.create_room_invite(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room_invite(UUID, TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_room_invite(_invite_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _room_id UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  SELECT room_id INTO _room_id FROM public.room_invites WHERE id = _invite_id;
  IF NOT FOUND OR NOT public.is_room_host(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  UPDATE public.room_invites SET revoked_at = now()
   WHERE id = _invite_id AND revoked_at IS NULL;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'invite.revoked', 'room_invite', _invite_id, jsonb_build_object('room_id', _room_id));

  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.revoke_room_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_room_invite(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_room_invite(_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _invite public.room_invites%ROWTYPE;
  _room public.rooms%ROWTYPE;
  _result JSONB;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  END IF;
  IF NOT public.consume_rate_limit('invite_redeem', 10, 600) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT * INTO _invite FROM public.room_invites WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND
     OR _invite.revoked_at IS NOT NULL
     OR _invite.expires_at <= now()
     OR _invite.use_count >= _invite.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _invite.room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invite'); END IF;

  _result := public.admit_member(_room, _uid, 'invite');
  IF NOT (_result->>'ok')::boolean THEN RETURN _result; END IF;

  IF NOT (_result->>'already_member')::boolean THEN
    UPDATE public.room_invites SET use_count = use_count + 1 WHERE id = _invite.id;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (_uid, 'invite.redeemed', 'room_invite', _invite.id,
            jsonb_build_object('room_id', _room.id));
  END IF;

  RETURN _result || jsonb_build_object('room_name', _room.name);
END; $$;
REVOKE ALL ON FUNCTION public.redeem_room_invite(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_room_invite(TEXT) TO authenticated;

-- ---------------------------------------------------------
-- 6. LEAVE ROOM / HOST TRANSFER / END ROOM
-- ---------------------------------------------------------
-- Deterministic successor rule: joined members other than the leaver, ordered by
-- role priority (co_host > moderator > member > guest) then earliest joined_at,
-- then user_id as a final tie-break.
CREATE OR REPLACE FUNCTION public.pick_room_successor(_room_id UUID, _excluding UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id FROM public.room_members m
   WHERE m.room_id = _room_id AND m.status = 'joined' AND m.user_id <> _excluding
   ORDER BY CASE m.role
              WHEN 'co_host' THEN 0 WHEN 'moderator' THEN 1
              WHEN 'member' THEN 2 ELSE 3 END,
            m.joined_at ASC, m.user_id ASC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.pick_room_successor(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.leave_room(_room_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _was_host BOOLEAN;
  _successor UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.room_members
                  WHERE room_id = _room_id AND user_id = _uid AND status = 'joined') THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'not_a_member');
  END IF;

  _was_host := (_room.owner_id = _uid) OR (_room.host_id = _uid)
    OR EXISTS (SELECT 1 FROM public.room_members
                WHERE room_id = _room_id AND user_id = _uid AND role = 'host' AND status = 'joined');

  UPDATE public.room_members
     SET status = 'left', left_at = now(), role = 'member',
         can_invite = false, can_moderate = false, can_control_playback = false
   WHERE room_id = _room_id AND user_id = _uid;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room_id, _uid, 'USER_LEFT', '{}'::jsonb);

  IF NOT _was_host THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'left');
  END IF;

  _successor := public.pick_room_successor(_room_id, _uid);

  IF _successor IS NULL THEN
    UPDATE public.rooms SET status = 'ended', ended_at = now(), host_id = NULL
     WHERE id = _room_id;
    INSERT INTO public.room_events (room_id, actor_id, type, payload)
    VALUES (_room_id, _uid, 'ROOM_ENDED', jsonb_build_object('cause', 'host_left_no_successor'));
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (_uid, 'room.ended', 'room', _room_id, jsonb_build_object('cause', 'host_left_no_successor'));
    RETURN jsonb_build_object('ok', true, 'outcome', 'room_ended');
  END IF;

  UPDATE public.rooms SET owner_id = _successor, host_id = _successor WHERE id = _room_id;
  UPDATE public.room_members
     SET role = 'host', can_invite = true, can_moderate = true, can_control_playback = true
   WHERE room_id = _room_id AND user_id = _successor;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room_id, _uid, 'HOST_CHANGED', jsonb_build_object('cause', 'host_left'));
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'room.host_transferred', 'room', _room_id,
          jsonb_build_object('cause', 'host_left', 'to', _successor));

  RETURN jsonb_build_object('ok', true, 'outcome', 'host_transferred');
END; $$;
REVOKE ALL ON FUNCTION public.leave_room(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_room(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_room_host(_room_id UUID, _to_user UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _current UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.is_room_host(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members
                  WHERE room_id = _room_id AND user_id = _to_user AND status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT owner_id INTO _current FROM public.rooms WHERE id = _room_id FOR UPDATE;

  UPDATE public.rooms SET owner_id = _to_user, host_id = _to_user WHERE id = _room_id;
  UPDATE public.room_members
     SET role = 'host', can_invite = true, can_moderate = true, can_control_playback = true
   WHERE room_id = _room_id AND user_id = _to_user;
  UPDATE public.room_members SET role = 'member'
   WHERE room_id = _room_id AND user_id = _current AND user_id <> _to_user;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room_id, _uid, 'HOST_CHANGED', jsonb_build_object('cause', 'manual'));
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'room.host_transferred', 'room', _room_id,
          jsonb_build_object('cause', 'manual', 'to', _to_user));

  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.transfer_room_host(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_room_host(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.end_room(_room_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.is_room_host(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  UPDATE public.rooms SET status = 'ended', ended_at = now()
   WHERE id = _room_id AND status <> 'ended';

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room_id, _uid, 'ROOM_ENDED', jsonb_build_object('cause', 'host_ended'));
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'room.ended', 'room', _room_id, jsonb_build_object('cause', 'host_ended'));

  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.end_room(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_room(UUID) TO authenticated;

-- ---------------------------------------------------------
-- 7. MEMBER IDENTITY (fix truncated UUID display without an RLS leak)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.room_member_directory(_room_id UUID)
RETURNS TABLE (
  user_id UUID, display_name TEXT, username TEXT, avatar_url TEXT,
  role public.room_member_role, status public.room_member_status, joined_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  IF NOT (public.is_room_member(_room_id, _uid)
          OR public.is_room_host(_room_id, _uid)
          OR public.is_staff(_uid)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.user_id,
         COALESCE(p.display_name, 'Member') AS display_name,
         CASE WHEN public.is_blocked_between(_uid, m.user_id) THEN NULL ELSE p.username END,
         CASE WHEN public.is_blocked_between(_uid, m.user_id) THEN NULL ELSE p.avatar_url END,
         m.role, m.status, m.joined_at
    FROM public.room_members m
    LEFT JOIN public.profiles p ON p.id = m.user_id
   WHERE m.room_id = _room_id AND m.status IN ('joined','invited')
   ORDER BY m.joined_at ASC;
END; $$;
REVOKE ALL ON FUNCTION public.room_member_directory(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.room_member_directory(UUID) TO authenticated;

-- ---------------------------------------------------------
-- 8. MODERATION FOUNDATION
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_report_status(_report_id UUID, _status public.report_status)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  UPDATE public.user_reports SET status = _status WHERE id = _report_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'report.status_changed', 'user_report', _report_id,
          jsonb_build_object('status', _status));
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.set_report_status(UUID, public.report_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_status(UUID, public.report_status) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_moderation_action(
  _action public.moderation_action_type, _report_id UUID, _room_id UUID,
  _target_user_id UUID, _reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _id UUID;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _reason IS NOT NULL AND char_length(_reason) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  INSERT INTO public.moderation_actions (report_id, room_id, target_user_id, actor_id, action, reason)
  VALUES (_report_id, _room_id, _target_user_id, _uid, _action, _reason)
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'moderation.action_created', 'moderation_action', _id,
          jsonb_build_object('action', _action, 'target_user_id', _target_user_id));
  RETURN jsonb_build_object('ok', true, 'id', _id);
END; $$;
REVOKE ALL ON FUNCTION public.create_moderation_action(public.moderation_action_type, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_moderation_action(public.moderation_action_type, UUID, UUID, UUID, TEXT) TO authenticated;

-- Staff role assignment: admin only, never reachable by a normal user.
CREATE OR REPLACE FUNCTION public.assign_app_role(_user_id UUID, _role public.app_role)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'role.assigned', 'user_role', _user_id, jsonb_build_object('role', _role));
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.assign_app_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_app_role(UUID, public.app_role) TO authenticated;

-- ---------------------------------------------------------
-- 9. DATA EXPORT
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_user_data()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _out JSONB;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'schema_version', 1,
    'user_id', _uid,
    'profile', (SELECT to_jsonb(p) - 'subscription_tier' FROM public.profiles p WHERE p.id = _uid),
    'settings', (SELECT to_jsonb(s) FROM public.user_settings s WHERE s.user_id = _uid),
    'privacy_settings', (SELECT to_jsonb(ps) FROM public.privacy_settings ps WHERE ps.user_id = _uid),
    'entitlement', (SELECT jsonb_build_object('plan', e.plan, 'status', e.status, 'expires_at', e.expires_at)
                      FROM public.entitlements e WHERE e.user_id = _uid),
    'rooms_owned', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'type', r.type, 'status', r.status,
        'created_at', r.created_at, 'ended_at', r.ended_at))
      FROM public.rooms r WHERE r.owner_id = _uid), '[]'::jsonb),
    'memberships', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'room_id', m.room_id, 'role', m.role, 'status', m.status,
        'joined_at', m.joined_at, 'left_at', m.left_at))
      FROM public.room_members m WHERE m.user_id = _uid), '[]'::jsonb),
    'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'blocked_id', b.blocked_id, 'created_at', b.created_at))
      FROM public.user_blocks b WHERE b.blocker_id = _uid), '[]'::jsonb),
    'reports_submitted', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', ur.id, 'target_type', ur.target_type, 'category', ur.category,
        'details', ur.details, 'status', ur.status, 'created_at', ur.created_at))
      FROM public.user_reports ur WHERE ur.reporter_id = _uid), '[]'::jsonb),
    'analytics_events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'name', ae.name, 'properties', ae.properties, 'created_at', ae.created_at))
      FROM public.analytics_events ae WHERE ae.user_id = _uid), '[]'::jsonb)
  ) INTO _out;

  RETURN _out;
END; $$;
REVOKE ALL ON FUNCTION public.export_user_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_user_data() TO authenticated;

-- ---------------------------------------------------------
-- 10. ACCOUNT DELETION
-- ---------------------------------------------------------
CREATE TYPE public.deletion_status AS ENUM ('requested','processing','completed','failed','cancelled');

CREATE TABLE public.account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.deletion_status NOT NULL DEFAULT 'requested',
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deletion_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500)
);
CREATE INDEX idx_deletion_requests_user ON public.account_deletion_requests(user_id);
GRANT SELECT ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deletion_requests_select_own" ON public.account_deletion_requests FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE TRIGGER trg_deletion_requests_updated BEFORE UPDATE ON public.account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.request_account_deletion(_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _id UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.consume_rate_limit('account_deletion', 3, 3600) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT id INTO _id FROM public.account_deletion_requests
   WHERE user_id = _uid AND status IN ('requested','processing') LIMIT 1;

  IF _id IS NULL THEN
    INSERT INTO public.account_deletion_requests (user_id, reason)
    VALUES (_uid, NULLIF(btrim(COALESCE(_reason, '')), '')) RETURNING id INTO _id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'account.deletion_requested', 'account_deletion_request', _id, '{}'::jsonb);

  RETURN jsonb_build_object('ok', true, 'request_id', _id);
END; $$;
REVOKE ALL ON FUNCTION public.request_account_deletion(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(TEXT) TO authenticated;

-- Server-side cleanup, called with the service role after the request is verified.
-- Hands over or ends every room the user hosts so no room is orphaned.
CREATE OR REPLACE FUNCTION public.purge_user_data(_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _room RECORD; _successor UUID;
BEGIN
  FOR _room IN SELECT id FROM public.rooms WHERE owner_id = _user_id OR host_id = _user_id LOOP
    _successor := public.pick_room_successor(_room.id, _user_id);
    IF _successor IS NULL THEN
      UPDATE public.rooms SET status = 'ended', ended_at = now(), host_id = NULL WHERE id = _room.id;
    ELSE
      UPDATE public.rooms SET owner_id = _successor, host_id = _successor WHERE id = _room.id;
      UPDATE public.room_members SET role = 'host', can_invite = true, can_moderate = true,
             can_control_playback = true
       WHERE room_id = _room.id AND user_id = _successor;
      INSERT INTO public.room_events (room_id, actor_id, type, payload)
      VALUES (_room.id, NULL, 'HOST_CHANGED', jsonb_build_object('cause', 'account_deleted'));
    END IF;
  END LOOP;

  UPDATE public.room_members SET status = 'left', left_at = now()
   WHERE user_id = _user_id AND status <> 'left';

  DELETE FROM public.analytics_events WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;
  DELETE FROM public.device_sessions WHERE user_id = _user_id;
  DELETE FROM public.user_blocks WHERE blocker_id = _user_id OR blocked_id = _user_id;
  DELETE FROM public.rate_limits WHERE user_id = _user_id;

  UPDATE public.profiles
     SET status = 'deleted', display_name = 'Deleted user', username = NULL,
         avatar_url = NULL, bio = NULL
   WHERE id = _user_id;

  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.purge_user_data(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------
-- 11. REALTIME
-- ---------------------------------------------------------
ALTER TABLE public.room_events REPLICA IDENTITY FULL;
ALTER TABLE public.room_members REPLICA IDENTITY FULL;
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;