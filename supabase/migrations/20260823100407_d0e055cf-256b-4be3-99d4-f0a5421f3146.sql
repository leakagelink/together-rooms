-- ============================================================
-- PHASE 7 — PRIVATE LOCAL MEDIA ROOMS
-- Temporary, room-authorized, ephemeral device media sharing.
-- No media binary, no URL, no device path is ever persisted.
-- ============================================================

CREATE TYPE public.local_media_kind AS ENUM ('image', 'video', 'audio');
CREATE TYPE public.local_media_session_status AS ENUM ('active', 'ended', 'expired');
CREATE TYPE public.local_media_transport_state AS ENUM ('direct', 'relay', 'unavailable');

-- ---------- settings ----------
CREATE TABLE public.room_local_media_settings (
  room_id UUID PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  share_mode public.room_queue_mode NOT NULL DEFAULT 'host_only',
  allow_relay BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- sessions ----------
CREATE TABLE public.room_local_media_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  controller_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  media_kind public.local_media_kind NOT NULL,
  mime_type TEXT,
  duration_seconds NUMERIC,
  item_count INTEGER NOT NULL DEFAULT 1,
  current_index INTEGER NOT NULL DEFAULT 0,
  status public.local_media_session_status NOT NULL DEFAULT 'active',
  transport_state public.local_media_transport_state NOT NULL DEFAULT 'unavailable',
  playback_status public.playback_status NOT NULL DEFAULT 'idle',
  position_seconds NUMERIC NOT NULL DEFAULT 0,
  playback_started_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 0,
  owner_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 hours',
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX room_local_media_sessions_room_idx
  ON public.room_local_media_sessions(room_id, status, created_at DESC);
-- At most one active local media session per room.
CREATE UNIQUE INDEX room_local_media_sessions_one_active
  ON public.room_local_media_sessions(room_id) WHERE status = 'active';

-- ---------- transport grants (short-lived) ----------
CREATE TABLE public.local_media_transport_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.room_local_media_sessions(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_role TEXT NOT NULL CHECK (grant_role IN ('owner', 'viewer')),
  token_hash TEXT NOT NULL,
  relay_allowed BOOLEAN NOT NULL DEFAULT true,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX local_media_transport_grants_session_idx
  ON public.local_media_transport_grants(session_id, user_id, expires_at DESC);

-- ---------- signaling (ephemeral) ----------
CREATE TABLE public.local_media_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.room_local_media_sessions(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'answer', 'ice', 'bye')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX local_media_signals_inbox_idx
  ON public.local_media_signals(session_id, recipient_id, created_at);

-- ---------- grants (least privilege: read-only for signed-in users) ----------
GRANT SELECT ON public.room_local_media_settings TO authenticated;
GRANT SELECT ON public.room_local_media_sessions TO authenticated;
GRANT ALL ON public.room_local_media_settings TO service_role;
GRANT ALL ON public.room_local_media_sessions TO service_role;
GRANT ALL ON public.local_media_transport_grants TO service_role;
GRANT ALL ON public.local_media_signals TO service_role;
-- Grants and signals are never readable through the Data API at all:
-- they are only reachable via SECURITY DEFINER routines.
REVOKE ALL ON public.local_media_transport_grants FROM anon, authenticated;
REVOKE ALL ON public.local_media_signals FROM anon, authenticated;
REVOKE ALL ON public.room_local_media_settings FROM anon;
REVOKE ALL ON public.room_local_media_sessions FROM anon;

ALTER TABLE public.room_local_media_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_local_media_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_media_transport_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_media_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "local media settings readable by room members"
  ON public.room_local_media_settings FOR SELECT TO authenticated
  USING (public.is_room_member(room_id, auth.uid()));

CREATE POLICY "local media sessions readable by room members"
  ON public.room_local_media_sessions FOR SELECT TO authenticated
  USING (public.is_room_member(room_id, auth.uid()));

-- ---------- write guard: no direct client DML, ever ----------
CREATE OR REPLACE FUNCTION public.guard_local_media_tables()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.local_media_ctx', true), '') = '1'
     OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'local_media_write_forbidden' USING ERRCODE = '42501';
END; $$;

CREATE TRIGGER guard_room_local_media_settings
  BEFORE INSERT OR UPDATE OR DELETE ON public.room_local_media_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_local_media_tables();
CREATE TRIGGER guard_room_local_media_sessions
  BEFORE INSERT OR UPDATE OR DELETE ON public.room_local_media_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_local_media_tables();
CREATE TRIGGER guard_local_media_transport_grants
  BEFORE INSERT OR UPDATE OR DELETE ON public.local_media_transport_grants
  FOR EACH ROW EXECUTE FUNCTION public.guard_local_media_tables();
CREATE TRIGGER guard_local_media_signals
  BEFORE INSERT OR UPDATE OR DELETE ON public.local_media_signals
  FOR EACH ROW EXECUTE FUNCTION public.guard_local_media_tables();

CREATE TRIGGER room_local_media_settings_updated_at
  BEFORE UPDATE ON public.room_local_media_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER room_local_media_sessions_updated_at
  BEFORE UPDATE ON public.room_local_media_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- shared helpers ----------

-- Housekeeping: expire timed-out sessions, drop dead grants and signals.
CREATE OR REPLACE FUNCTION public.sweep_local_media()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.local_media_ctx', '1', true);
  UPDATE public.room_local_media_sessions s
     SET status = 'expired', ended_at = now(), transport_state = 'unavailable',
         playback_status = 'idle', version = s.version + 1
   WHERE s.status = 'active'
     AND (s.expires_at <= now()
          OR EXISTS (SELECT 1 FROM public.rooms r
                      WHERE r.id = s.room_id AND public.room_is_joinable(r) <> 'ok'));
  UPDATE public.local_media_transport_grants g
     SET revoked_at = now()
   WHERE g.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM public.room_local_media_sessions s
                  WHERE s.id = g.session_id AND s.status <> 'active');
  DELETE FROM public.local_media_signals WHERE expires_at <= now();
  PERFORM set_config('app.local_media_ctx', '0', true);
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_local_media_settings(_room_id UUID)
RETURNS public.room_local_media_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.room_local_media_settings%ROWTYPE;
BEGIN
  SELECT * INTO _s FROM public.room_local_media_settings WHERE room_id = _room_id;
  IF NOT FOUND THEN
    PERFORM set_config('app.local_media_ctx', '1', true);
    INSERT INTO public.room_local_media_settings(room_id) VALUES (_room_id)
      ON CONFLICT (room_id) DO NOTHING;
    PERFORM set_config('app.local_media_ctx', '0', true);
    SELECT * INTO _s FROM public.room_local_media_settings WHERE room_id = _room_id;
  END IF;
  RETURN _s;
END; $$;

-- Membership + lifecycle + block + rate-limit precheck shared by every routine.
CREATE OR REPLACE FUNCTION public.local_media_precheck(
  _room_id UUID, _action TEXT, _limit INTEGER, _window INTEGER)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _room public.rooms%ROWTYPE; _life TEXT;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  SELECT * INTO _room FROM public.rooms WHERE id = _room_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = _room_id AND m.user_id = _uid AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  _life := public.room_is_joinable(_room);
  IF _life <> 'ok' THEN RETURN jsonb_build_object('ok', false, 'reason', _life); END IF;
  IF NOT public.consume_rate_limit(_action, _limit, _window) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  RETURN NULL;
END; $$;

-- ---------- settings mutation ----------
CREATE OR REPLACE FUNCTION public.set_local_media_settings(
  _room_id UUID, _share_mode TEXT DEFAULT NULL, _allow_relay BOOLEAN DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_local_media_settings%ROWTYPE;
BEGIN
  _pre := public.local_media_precheck(_room_id, 'local_media_settings', 20, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT public.is_room_host(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _share_mode IS NOT NULL AND _share_mode NOT IN ('host_only', 'collaborative') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  _s := public.ensure_local_media_settings(_room_id);
  PERFORM set_config('app.local_media_ctx', '1', true);
  UPDATE public.room_local_media_settings
     SET share_mode = coalesce(_share_mode::public.room_queue_mode, share_mode),
         allow_relay = coalesce(_allow_relay, allow_relay)
   WHERE room_id = _room_id;
  PERFORM set_config('app.local_media_ctx', '0', true);
  SELECT * INTO _s FROM public.room_local_media_settings WHERE room_id = _room_id;
  RETURN jsonb_build_object('ok', true, 'share_mode', _s.share_mode, 'allow_relay', _s.allow_relay);
END; $$;

-- ---------- session lifecycle ----------
CREATE OR REPLACE FUNCTION public.start_local_media_session(
  _room_id UUID, _media_kind TEXT, _mime_type TEXT DEFAULT NULL,
  _duration_seconds NUMERIC DEFAULT NULL, _item_count INTEGER DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_local_media_settings%ROWTYPE;
        _row public.room_local_media_sessions%ROWTYPE;
BEGIN
  PERFORM public.sweep_local_media();
  _pre := public.local_media_precheck(_room_id, 'local_media_start', 10, 300);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF _media_kind NOT IN ('image', 'video', 'audio') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _item_count IS NULL OR _item_count < 1 OR _item_count > 50 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _mime_type IS NOT NULL AND (length(_mime_type) > 100
      OR _mime_type !~ '^(image|video|audio)/[A-Za-z0-9.+_-]+$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  _s := public.ensure_local_media_settings(_room_id);
  IF _s.share_mode = 'host_only' AND NOT public.is_room_host(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF EXISTS (SELECT 1 FROM public.room_local_media_sessions
              WHERE room_id = _room_id AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  PERFORM set_config('app.local_media_ctx', '1', true);
  INSERT INTO public.room_local_media_sessions(
    room_id, owner_id, controller_id, media_kind, mime_type, duration_seconds, item_count)
  VALUES (_room_id, _uid, _uid, _media_kind::public.local_media_kind, _mime_type,
          _duration_seconds, _item_count)
  RETURNING * INTO _row;
  PERFORM set_config('app.local_media_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'session_id', _row.id, 'version', _row.version,
    'expires_at', _row.expires_at, 'media_kind', _row.media_kind);
END; $$;

CREATE OR REPLACE FUNCTION public.end_local_media_session(_session_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_local_media_sessions%ROWTYPE; _pre jsonb;
BEGIN
  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _row.owner_id <> _uid AND NOT public.can_moderate_room(_row.room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF NOT public.consume_rate_limit('local_media_end', 30, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  _pre := NULL;

  PERFORM set_config('app.local_media_ctx', '1', true);
  UPDATE public.room_local_media_sessions
     SET status = CASE WHEN status = 'active' THEN 'ended'::public.local_media_session_status
                       ELSE status END,
         ended_at = coalesce(ended_at, now()), transport_state = 'unavailable',
         playback_status = 'idle', version = version + 1
   WHERE id = _session_id;
  UPDATE public.local_media_transport_grants SET revoked_at = now()
   WHERE session_id = _session_id AND revoked_at IS NULL;
  DELETE FROM public.local_media_signals WHERE session_id = _session_id;
  PERFORM set_config('app.local_media_ctx', '0', true);

  RETURN jsonb_build_object('ok', true);
END; $$;

-- Owner heartbeat: extends the "owner is still here" marker without touching
-- authoritative playback state.
CREATE OR REPLACE FUNCTION public.local_media_owner_heartbeat(_session_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_local_media_sessions%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _uid IS NULL OR _row.owner_id <> _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF NOT public.consume_rate_limit('local_media_heartbeat', 120, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  PERFORM set_config('app.local_media_ctx', '1', true);
  UPDATE public.room_local_media_sessions SET owner_seen_at = now() WHERE id = _session_id;
  PERFORM set_config('app.local_media_ctx', '0', true);
  RETURN jsonb_build_object('ok', true);
END; $$;

-- Grace policy: an owner absent for more than 90 seconds ends the session.
CREATE OR REPLACE FUNCTION public.reap_local_media_owner_absence(_session_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.room_local_media_sessions%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF auth.uid() IS NULL OR NOT public.is_room_member(_row.room_id, auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _row.status = 'active' AND _row.owner_seen_at < now() - interval '90 seconds' THEN
    PERFORM set_config('app.local_media_ctx', '1', true);
    UPDATE public.room_local_media_sessions
       SET status = 'expired', ended_at = now(), transport_state = 'unavailable',
           playback_status = 'idle', version = version + 1
     WHERE id = _session_id;
    UPDATE public.local_media_transport_grants SET revoked_at = now()
     WHERE session_id = _session_id AND revoked_at IS NULL;
    DELETE FROM public.local_media_signals WHERE session_id = _session_id;
    PERFORM set_config('app.local_media_ctx', '0', true);
    RETURN jsonb_build_object('ok', true, 'ended', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'ended', false);
END; $$;

-- ---------- authoritative playback ----------
CREATE OR REPLACE FUNCTION public.control_local_media_playback(
  _session_id UUID, _action TEXT, _position_seconds NUMERIC DEFAULT NULL,
  _index INTEGER DEFAULT NULL, _expected_version INTEGER DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_local_media_sessions%ROWTYPE;
        _pre jsonb; _pos NUMERIC; _idx INTEGER;
BEGIN
  IF _action NOT IN ('play', 'pause', 'seek', 'set_index', 'transport') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _pre := public.local_media_precheck(_row.room_id, 'local_media_playback', 60, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;

  -- Only the session owner (or a room moderator/host) may mutate authoritative state.
  IF _row.owner_id <> _uid AND NOT public.can_moderate_room(_row.room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _row.status <> 'active' OR _row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;
  IF _expected_version IS NOT NULL AND _expected_version <> _row.version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'version_conflict', 'version', _row.version);
  END IF;

  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id FOR UPDATE;
  IF _expected_version IS NOT NULL AND _expected_version <> _row.version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'version_conflict', 'version', _row.version);
  END IF;

  PERFORM set_config('app.local_media_ctx', '1', true);
  IF _action = 'play' THEN
    UPDATE public.room_local_media_sessions
       SET playback_status = 'playing', playback_started_at = now(),
           position_seconds = coalesce(_position_seconds, position_seconds),
           controller_id = _uid, version = version + 1
     WHERE id = _session_id;
  ELSIF _action = 'pause' THEN
    _pos := CASE WHEN _row.playback_status = 'playing' AND _row.playback_started_at IS NOT NULL
                 THEN _row.position_seconds + extract(epoch FROM (now() - _row.playback_started_at))
                 ELSE _row.position_seconds END;
    UPDATE public.room_local_media_sessions
       SET playback_status = 'paused', position_seconds = greatest(0, _pos),
           playback_started_at = NULL, controller_id = _uid, version = version + 1
     WHERE id = _session_id;
  ELSIF _action = 'seek' THEN
    IF _position_seconds IS NULL OR _position_seconds < 0 OR _position_seconds > 86400 THEN
      PERFORM set_config('app.local_media_ctx', '0', true);
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
    UPDATE public.room_local_media_sessions
       SET position_seconds = _position_seconds,
           playback_started_at = CASE WHEN playback_status = 'playing' THEN now() ELSE NULL END,
           controller_id = _uid, version = version + 1
     WHERE id = _session_id;
  ELSIF _action = 'set_index' THEN
    _idx := coalesce(_index, 0);
    IF _idx < 0 OR _idx >= _row.item_count THEN
      PERFORM set_config('app.local_media_ctx', '0', true);
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
    UPDATE public.room_local_media_sessions
       SET current_index = _idx, controller_id = _uid, version = version + 1
     WHERE id = _session_id;
  ELSE
    UPDATE public.room_local_media_sessions
       SET transport_state = CASE WHEN _index = 1 THEN 'direct'::public.local_media_transport_state
                                  WHEN _index = 2 THEN 'relay'::public.local_media_transport_state
                                  ELSE 'unavailable'::public.local_media_transport_state END,
           version = version + 1
     WHERE id = _session_id;
  END IF;
  PERFORM set_config('app.local_media_ctx', '0', true);

  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id;
  RETURN jsonb_build_object('ok', true, 'version', _row.version,
    'playback_status', _row.playback_status, 'position_seconds', _row.position_seconds,
    'playback_started_at', _row.playback_started_at, 'current_index', _row.current_index,
    'transport_state', _row.transport_state);
END; $$;

-- ---------- transport credentials ----------
CREATE OR REPLACE FUNCTION public.issue_local_media_transport_grant(_session_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_local_media_sessions%ROWTYPE;
        _pre jsonb; _token TEXT; _role TEXT; _exp TIMESTAMPTZ;
        _settings public.room_local_media_settings%ROWTYPE;
BEGIN
  PERFORM public.sweep_local_media();
  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _pre := public.local_media_precheck(_row.room_id, 'local_media_grant', 30, 300);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;

  IF _row.status <> 'active' OR _row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;
  -- Blocked either way: no transport between the two users.
  IF public.is_blocked_between(_uid, _row.owner_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  _settings := public.ensure_local_media_settings(_row.room_id);
  _role := CASE WHEN _row.owner_id = _uid THEN 'owner' ELSE 'viewer' END;
  _token := encode(gen_random_bytes(32), 'hex');
  _exp := least(now() + interval '5 minutes', _row.expires_at);

  PERFORM set_config('app.local_media_ctx', '1', true);
  UPDATE public.local_media_transport_grants SET revoked_at = now()
   WHERE session_id = _session_id AND user_id = _uid AND revoked_at IS NULL;
  INSERT INTO public.local_media_transport_grants(
    session_id, room_id, user_id, grant_role, token_hash, relay_allowed, expires_at)
  VALUES (_session_id, _row.room_id, _uid, _role,
          encode(digest(_token, 'sha256'), 'hex'), _settings.allow_relay, _exp);
  PERFORM set_config('app.local_media_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'token', _token, 'role', _role,
    'relay_allowed', _settings.allow_relay, 'expires_at', _exp,
    'ttl_seconds', greatest(0, floor(extract(epoch FROM (_exp - now()))))::int);
END; $$;

-- Validates a credential for the calling user. Returns the grant row id.
CREATE OR REPLACE FUNCTION public.verify_local_media_grant(_session_id UUID, _token TEXT)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _id UUID;
BEGIN
  IF _uid IS NULL OR _token IS NULL OR length(_token) < 32 THEN RETURN NULL; END IF;
  SELECT g.id INTO _id
    FROM public.local_media_transport_grants g
    JOIN public.room_local_media_sessions s ON s.id = g.session_id
   WHERE g.session_id = _session_id
     AND g.user_id = _uid
     AND g.revoked_at IS NULL
     AND g.expires_at > now()
     AND g.token_hash = encode(digest(_token, 'sha256'), 'hex')
     AND s.status = 'active'
     AND s.expires_at > now()
     -- Membership is re-checked on every use, so revocation takes effect at once.
     AND EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = s.room_id AND m.user_id = _uid AND m.status = 'joined')
   LIMIT 1;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.redeem_local_media_transport_grant(
  _session_id UUID, _token TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _gid UUID; _g public.local_media_transport_grants%ROWTYPE;
BEGIN
  PERFORM public.sweep_local_media();
  IF NOT public.consume_rate_limit('local_media_redeem', 60, 300) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  _gid := public.verify_local_media_grant(_session_id, _token);
  IF _gid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  SELECT * INTO _g FROM public.local_media_transport_grants WHERE id = _gid;
  RETURN jsonb_build_object('ok', true, 'role', _g.grant_role,
    'relay_allowed', _g.relay_allowed, 'expires_at', _g.expires_at,
    'ttl_seconds', greatest(0, floor(extract(epoch FROM (_g.expires_at - now()))))::int);
END; $$;

-- ---------- signaling ----------
CREATE OR REPLACE FUNCTION public.post_local_media_signal(
  _session_id UUID, _token TEXT, _recipient_id UUID, _kind TEXT, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _gid UUID; _row public.room_local_media_sessions%ROWTYPE;
BEGIN
  IF _kind NOT IN ('offer', 'answer', 'ice', 'bye') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _payload IS NULL OR length(_payload::text) > 20000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF NOT public.consume_rate_limit('local_media_signal', 300, 300) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  -- A session id alone grants nothing: a live credential is mandatory.
  _gid := public.verify_local_media_grant(_session_id, _token);
  IF _gid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id;
  IF NOT EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = _row.room_id AND m.user_id = _recipient_id
                    AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF public.is_blocked_between(_uid, _recipient_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  PERFORM set_config('app.local_media_ctx', '1', true);
  DELETE FROM public.local_media_signals WHERE expires_at <= now();
  INSERT INTO public.local_media_signals(
    session_id, room_id, sender_id, recipient_id, kind, payload)
  VALUES (_session_id, _row.room_id, _uid, _recipient_id, _kind, _payload);
  PERFORM set_config('app.local_media_ctx', '0', true);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.fetch_local_media_signals(_session_id UUID, _token TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _gid UUID; _out jsonb;
BEGIN
  IF NOT public.consume_rate_limit('local_media_poll', 600, 300) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  _gid := public.verify_local_media_grant(_session_id, _token);
  IF _gid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  PERFORM set_config('app.local_media_ctx', '1', true);
  WITH taken AS (
    DELETE FROM public.local_media_signals
     WHERE session_id = _session_id AND recipient_id = _uid AND expires_at > now()
    RETURNING sender_id, kind, payload, created_at
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sender_id', sender_id, 'kind', kind, 'payload', payload, 'created_at', created_at)
         ORDER BY created_at), '[]'::jsonb) INTO _out FROM taken;
  PERFORM set_config('app.local_media_ctx', '0', true);
  RETURN jsonb_build_object('ok', true, 'signals', _out);
END; $$;

-- ---------- snapshot ----------
CREATE OR REPLACE FUNCTION public.local_media_snapshot(_room_id UUID)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _sess jsonb; _mode TEXT; _relay BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = _room_id AND m.user_id = _uid AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  SELECT s.share_mode::text, s.allow_relay INTO _mode, _relay
    FROM public.room_local_media_settings s WHERE s.room_id = _room_id;

  SELECT to_jsonb(x) INTO _sess FROM (
    SELECT id, room_id, owner_id, controller_id, media_kind, mime_type, duration_seconds,
           item_count, current_index, status, transport_state, playback_status,
           position_seconds, playback_started_at, version, expires_at, created_at
      FROM public.room_local_media_sessions
     WHERE room_id = _room_id AND status = 'active' AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1) x;

  RETURN jsonb_build_object('ok', true, 'session', coalesce(_sess, 'null'::jsonb),
    'share_mode', coalesce(_mode, 'host_only'), 'allow_relay', coalesce(_relay, true),
    'server_time', now());
END; $$;

-- ---------- execution privileges: signed-in users only ----------
REVOKE EXECUTE ON FUNCTION public.guard_local_media_tables() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sweep_local_media() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_local_media_settings(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.local_media_precheck(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_local_media_grant(uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.set_local_media_settings(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_local_media_session(uuid, text, text, numeric, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_local_media_session(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.local_media_owner_heartbeat(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reap_local_media_owner_absence(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.control_local_media_playback(uuid, text, numeric, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.issue_local_media_transport_grant(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_local_media_transport_grant(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.post_local_media_signal(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fetch_local_media_signals(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.local_media_snapshot(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_local_media_settings(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_local_media_session(uuid, text, text, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_local_media_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.local_media_owner_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reap_local_media_owner_absence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.control_local_media_playback(uuid, text, numeric, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_local_media_transport_grant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_local_media_transport_grant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_local_media_signal(uuid, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_local_media_signals(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.local_media_snapshot(uuid) TO authenticated;

-- Realtime: session state only. Grants and signals are never broadcast.
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_local_media_sessions;