-- ============================================================
-- PHASE 8 — REAL-TIME VOICE & VIDEO DISCUSSION
-- Room-private, authenticated, membership-aware, temporary, revocable.
-- No recording, no transcription, no media persistence of any kind:
-- the database stores call *control* state only.
-- ============================================================

CREATE TYPE public.call_mode AS ENUM ('voice', 'video');
CREATE TYPE public.call_session_status AS ENUM ('starting', 'active', 'ended', 'expired');
CREATE TYPE public.call_admission AS ENUM ('open_to_room', 'host_approval');
CREATE TYPE public.call_connection_state AS ENUM ('connecting', 'connected', 'reconnecting', 'failed');

CREATE TABLE public.room_call_settings (
  room_id UUID PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  control_mode public.room_queue_mode NOT NULL DEFAULT 'host_only',
  admission public.call_admission NOT NULL DEFAULT 'open_to_room',
  allow_relay BOOLEAN NOT NULL DEFAULT true,
  max_voice_participants INTEGER NOT NULL DEFAULT 8,
  max_video_participants INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.room_call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  started_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  call_mode public.call_mode NOT NULL DEFAULT 'voice',
  session_status public.call_session_status NOT NULL DEFAULT 'active',
  allow_relay BOOLEAN NOT NULL DEFAULT true,
  max_participants INTEGER NOT NULL DEFAULT 8,
  version INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '4 hours',
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX room_call_sessions_room_idx
  ON public.room_call_sessions(room_id, session_status, created_at DESC);
CREATE UNIQUE INDEX room_call_sessions_one_live
  ON public.room_call_sessions(room_id)
  WHERE session_status IN ('starting', 'active');

CREATE TABLE public.room_call_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.room_call_sessions(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mic_enabled BOOLEAN NOT NULL DEFAULT true,
  camera_enabled BOOLEAN NOT NULL DEFAULT false,
  connection_state public.call_connection_state NOT NULL DEFAULT 'connecting',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX room_call_participants_session_idx
  ON public.room_call_participants(session_id, left_at, joined_at);

CREATE TABLE public.call_transport_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.room_call_sessions(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  relay_allowed BOOLEAN NOT NULL DEFAULT true,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX call_transport_grants_session_idx
  ON public.call_transport_grants(session_id, user_id, expires_at DESC);

CREATE TABLE public.call_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.room_call_sessions(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'answer', 'ice', 'bye', 'renegotiate')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX call_signals_inbox_idx
  ON public.call_signals(session_id, recipient_id, created_at);

GRANT SELECT ON public.room_call_settings TO authenticated;
GRANT SELECT ON public.room_call_sessions TO authenticated;
GRANT SELECT ON public.room_call_participants TO authenticated;
GRANT ALL ON public.room_call_settings TO service_role;
GRANT ALL ON public.room_call_sessions TO service_role;
GRANT ALL ON public.room_call_participants TO service_role;
GRANT ALL ON public.call_transport_grants TO service_role;
GRANT ALL ON public.call_signals TO service_role;
REVOKE ALL ON public.call_transport_grants FROM anon, authenticated;
REVOKE ALL ON public.call_signals FROM anon, authenticated;
REVOKE ALL ON public.room_call_settings FROM anon;
REVOKE ALL ON public.room_call_sessions FROM anon;
REVOKE ALL ON public.room_call_participants FROM anon;

ALTER TABLE public.room_call_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_call_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_transport_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "call settings readable by room members"
  ON public.room_call_settings FOR SELECT TO authenticated
  USING (public.is_room_member(room_id, auth.uid()));
CREATE POLICY "call sessions readable by room members"
  ON public.room_call_sessions FOR SELECT TO authenticated
  USING (public.is_room_member(room_id, auth.uid()));
CREATE POLICY "call participants readable by room members"
  ON public.room_call_participants FOR SELECT TO authenticated
  USING (public.is_room_member(room_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_call_tables()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.call_ctx', true), '') = '1'
     OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'call_write_forbidden' USING ERRCODE = '42501';
END; $$;

CREATE TRIGGER guard_room_call_settings
  BEFORE INSERT OR UPDATE OR DELETE ON public.room_call_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_call_tables();
CREATE TRIGGER guard_room_call_sessions
  BEFORE INSERT OR UPDATE OR DELETE ON public.room_call_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_call_tables();
CREATE TRIGGER guard_room_call_participants
  BEFORE INSERT OR UPDATE OR DELETE ON public.room_call_participants
  FOR EACH ROW EXECUTE FUNCTION public.guard_call_tables();
CREATE TRIGGER guard_call_transport_grants
  BEFORE INSERT OR UPDATE OR DELETE ON public.call_transport_grants
  FOR EACH ROW EXECUTE FUNCTION public.guard_call_tables();
CREATE TRIGGER guard_call_signals
  BEFORE INSERT OR UPDATE OR DELETE ON public.call_signals
  FOR EACH ROW EXECUTE FUNCTION public.guard_call_tables();

CREATE TRIGGER room_call_settings_updated_at
  BEFORE UPDATE ON public.room_call_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER room_call_sessions_updated_at
  BEFORE UPDATE ON public.room_call_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER room_call_participants_updated_at
  BEFORE UPDATE ON public.room_call_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.sweep_calls()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.call_ctx', '1', true);

  UPDATE public.room_call_participants p
     SET left_at = now(), connection_state = 'failed'
   WHERE p.left_at IS NULL
     AND p.last_seen_at < now() - interval '90 seconds';

  UPDATE public.room_call_participants p
     SET left_at = now()
   WHERE p.left_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.room_members m
                      WHERE m.room_id = p.room_id AND m.user_id = p.user_id
                        AND m.status = 'joined');

  UPDATE public.room_call_sessions s
     SET session_status = 'expired', ended_at = now(), version = s.version + 1
   WHERE s.session_status IN ('starting', 'active')
     AND (s.expires_at <= now()
          OR EXISTS (SELECT 1 FROM public.rooms r
                      WHERE r.id = s.room_id AND public.room_is_joinable(r) <> 'ok')
          OR (s.created_at < now() - interval '3 minutes'
              AND NOT EXISTS (SELECT 1 FROM public.room_call_participants p
                               WHERE p.session_id = s.id AND p.left_at IS NULL)));

  UPDATE public.call_transport_grants g
     SET revoked_at = now()
   WHERE g.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM public.room_call_sessions s
                  WHERE s.id = g.session_id AND s.session_status NOT IN ('starting', 'active'));

  DELETE FROM public.call_signals WHERE expires_at <= now();

  PERFORM set_config('app.call_ctx', '0', true);
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_call_settings(_room_id UUID)
RETURNS public.room_call_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.room_call_settings%ROWTYPE;
BEGIN
  SELECT * INTO _s FROM public.room_call_settings WHERE room_id = _room_id;
  IF NOT FOUND THEN
    PERFORM set_config('app.call_ctx', '1', true);
    INSERT INTO public.room_call_settings(room_id) VALUES (_room_id)
      ON CONFLICT (room_id) DO NOTHING;
    PERFORM set_config('app.call_ctx', '0', true);
    SELECT * INTO _s FROM public.room_call_settings WHERE room_id = _room_id;
  END IF;
  RETURN _s;
END; $$;

CREATE OR REPLACE FUNCTION public.call_precheck(
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

CREATE OR REPLACE FUNCTION public.call_block_conflict(_session_id UUID, _user_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.room_call_participants p
     WHERE p.session_id = _session_id
       AND p.left_at IS NULL
       AND p.user_id <> _user_id
       AND p.joined_at <= coalesce(
             (SELECT q.joined_at FROM public.room_call_participants q
               WHERE q.session_id = _session_id AND q.user_id = _user_id), now())
       AND public.is_blocked_between(p.user_id, _user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.call_snapshot(_room_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _sess jsonb; _parts jsonb;
        _settings public.room_call_settings%ROWTYPE; _sid UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = _room_id AND m.user_id = _uid AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  PERFORM public.sweep_calls();
  _settings := public.ensure_call_settings(_room_id);

  SELECT to_jsonb(x), x.id INTO _sess, _sid FROM (
    SELECT id, room_id, started_by, call_mode::text AS call_mode,
           session_status::text AS session_status, allow_relay, max_participants,
           version, expires_at, created_at
      FROM public.room_call_sessions
     WHERE room_id = _room_id AND session_status IN ('starting', 'active')
       AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.user_id, 'mic_enabled', p.mic_enabled,
           'camera_enabled', p.camera_enabled,
           'connection_state', p.connection_state::text,
           'joined_at', p.joined_at) ORDER BY p.joined_at), '[]'::jsonb)
    INTO _parts
    FROM public.room_call_participants p
   WHERE p.session_id = _sid AND p.left_at IS NULL;

  RETURN jsonb_build_object('ok', true,
    'session', coalesce(_sess, 'null'::jsonb),
    'participants', coalesce(_parts, '[]'::jsonb),
    'control_mode', _settings.control_mode::text,
    'admission', _settings.admission::text,
    'allow_relay', _settings.allow_relay,
    'max_voice_participants', _settings.max_voice_participants,
    'max_video_participants', _settings.max_video_participants,
    'server_time', now());
END; $$;

CREATE OR REPLACE FUNCTION public.set_call_settings(
  _room_id UUID, _control_mode TEXT DEFAULT NULL, _allow_relay BOOLEAN DEFAULT NULL,
  _max_voice INTEGER DEFAULT NULL, _max_video INTEGER DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_call_settings%ROWTYPE;
BEGIN
  _pre := public.call_precheck(_room_id, 'call_settings', 30, 300);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT public.can_moderate_room(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _control_mode IS NOT NULL AND _control_mode NOT IN ('host_only', 'collaborative') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  PERFORM public.ensure_call_settings(_room_id);
  PERFORM set_config('app.call_ctx', '1', true);
  UPDATE public.room_call_settings
     SET control_mode = coalesce(_control_mode::public.room_queue_mode, control_mode),
         allow_relay = coalesce(_allow_relay, allow_relay),
         max_voice_participants = least(greatest(coalesce(_max_voice, max_voice_participants), 2), 8),
         max_video_participants = least(greatest(coalesce(_max_video, max_video_participants), 2), 4)
   WHERE room_id = _room_id;
  PERFORM set_config('app.call_ctx', '0', true);
  SELECT * INTO _s FROM public.room_call_settings WHERE room_id = _room_id;
  RETURN jsonb_build_object('ok', true, 'control_mode', _s.control_mode::text,
    'allow_relay', _s.allow_relay, 'max_voice_participants', _s.max_voice_participants,
    'max_video_participants', _s.max_video_participants);
END; $$;

CREATE OR REPLACE FUNCTION public.start_call_session(_room_id UUID, _call_mode TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_call_settings%ROWTYPE;
        _room public.rooms%ROWTYPE; _existing public.room_call_sessions%ROWTYPE;
        _id UUID; _exp TIMESTAMPTZ; _max INTEGER;
BEGIN
  IF _call_mode NOT IN ('voice', 'video') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  PERFORM public.sweep_calls();
  _pre := public.call_precheck(_room_id, 'call_start', 10, 600);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;

  _s := public.ensure_call_settings(_room_id);
  IF _s.control_mode = 'host_only' AND NOT public.can_moderate_room(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO _existing FROM public.room_call_sessions
   WHERE room_id = _room_id AND session_status IN ('starting', 'active')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'session_id', _existing.id,
      'call_mode', _existing.call_mode::text, 'version', _existing.version,
      'expires_at', _existing.expires_at, 'existing', true);
  END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _room_id;
  _exp := least(now() + interval '4 hours', coalesce(_room.expires_at, now() + interval '4 hours'));
  _max := CASE WHEN _call_mode = 'video' THEN _s.max_video_participants
               ELSE _s.max_voice_participants END;

  PERFORM set_config('app.call_ctx', '1', true);
  BEGIN
    INSERT INTO public.room_call_sessions(
      room_id, started_by, call_mode, session_status, allow_relay, max_participants, expires_at)
    VALUES (_room_id, _uid, _call_mode::public.call_mode, 'active', _s.allow_relay, _max, _exp)
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('app.call_ctx', '0', true);
    SELECT * INTO _existing FROM public.room_call_sessions
     WHERE room_id = _room_id AND session_status IN ('starting', 'active')
     ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'session_id', _existing.id,
      'call_mode', _existing.call_mode::text, 'version', _existing.version,
      'expires_at', _existing.expires_at, 'existing', true);
  END;
  PERFORM set_config('app.call_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'session_id', _id, 'call_mode', _call_mode,
    'version', 0, 'expires_at', _exp, 'existing', false);
END; $$;

CREATE OR REPLACE FUNCTION public.end_call_session(
  _session_id UUID, _expected_version INTEGER DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_call_sessions%ROWTYPE; _pre jsonb;
BEGIN
  SELECT * INTO _row FROM public.room_call_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _pre := public.call_precheck(_row.room_id, 'call_end', 20, 600);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;

  IF _row.started_by IS DISTINCT FROM _uid AND NOT public.can_moderate_room(_row.room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _row.session_status NOT IN ('starting', 'active') THEN
    RETURN jsonb_build_object('ok', true, 'already_ended', true);
  END IF;
  IF _expected_version IS NOT NULL AND _expected_version <> _row.version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'version_conflict', 'version', _row.version);
  END IF;

  PERFORM set_config('app.call_ctx', '1', true);
  UPDATE public.room_call_sessions
     SET session_status = 'ended', ended_at = now(), version = version + 1
   WHERE id = _session_id;
  UPDATE public.room_call_participants SET left_at = now()
   WHERE session_id = _session_id AND left_at IS NULL;
  UPDATE public.call_transport_grants SET revoked_at = now()
   WHERE session_id = _session_id AND revoked_at IS NULL;
  DELETE FROM public.call_signals WHERE session_id = _session_id;
  PERFORM set_config('app.call_ctx', '0', true);

  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.join_call_session(
  _session_id UUID, _mic BOOLEAN DEFAULT true, _camera BOOLEAN DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_call_sessions%ROWTYPE; _pre jsonb;
        _active INTEGER;
BEGIN
  PERFORM public.sweep_calls();
  SELECT * INTO _row FROM public.room_call_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _pre := public.call_precheck(_row.room_id, 'call_join', 30, 300);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;

  IF _row.session_status NOT IN ('starting', 'active') OR _row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;
  IF public.call_block_conflict(_session_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT count(*) INTO _active FROM public.room_call_participants
   WHERE session_id = _session_id AND left_at IS NULL AND user_id <> _uid;
  IF _active >= _row.max_participants THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_full');
  END IF;

  PERFORM set_config('app.call_ctx', '1', true);
  INSERT INTO public.room_call_participants(
    session_id, room_id, user_id, mic_enabled, camera_enabled, connection_state)
  VALUES (_session_id, _row.room_id, _uid, coalesce(_mic, true),
          coalesce(_camera, false) AND _row.call_mode = 'video', 'connecting')
  ON CONFLICT (session_id, user_id) DO UPDATE
    SET left_at = NULL,
        joined_at = CASE WHEN room_call_participants.left_at IS NULL
                         THEN room_call_participants.joined_at ELSE now() END,
        last_seen_at = now(), connection_state = 'connecting',
        mic_enabled = coalesce(_mic, true),
        camera_enabled = coalesce(_camera, false) AND _row.call_mode = 'video';
  UPDATE public.room_call_sessions SET version = version + 1 WHERE id = _session_id;
  PERFORM set_config('app.call_ctx', '0', true);

  SELECT * INTO _row FROM public.room_call_sessions WHERE id = _session_id;
  RETURN jsonb_build_object('ok', true, 'session_id', _session_id,
    'call_mode', _row.call_mode::text, 'version', _row.version,
    'max_participants', _row.max_participants, 'expires_at', _row.expires_at);
END; $$;

CREATE OR REPLACE FUNCTION public.leave_call_session(_session_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.consume_rate_limit('call_leave', 60, 300) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  PERFORM set_config('app.call_ctx', '1', true);
  UPDATE public.room_call_participants
     SET left_at = now(), connection_state = 'failed'
   WHERE session_id = _session_id AND user_id = _uid AND left_at IS NULL;
  UPDATE public.call_transport_grants SET revoked_at = now()
   WHERE session_id = _session_id AND user_id = _uid AND revoked_at IS NULL;
  DELETE FROM public.call_signals
   WHERE session_id = _session_id AND (sender_id = _uid OR recipient_id = _uid);
  UPDATE public.room_call_sessions SET version = version + 1 WHERE id = _session_id;
  PERFORM set_config('app.call_ctx', '0', true);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.set_call_media_state(
  _session_id UUID, _mic BOOLEAN DEFAULT NULL, _camera BOOLEAN DEFAULT NULL,
  _connection_state TEXT DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_call_sessions%ROWTYPE;
        _p public.room_call_participants%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _connection_state IS NOT NULL
     AND _connection_state NOT IN ('connecting', 'connected', 'reconnecting', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF NOT public.consume_rate_limit('call_state', 180, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  SELECT * INTO _row FROM public.room_call_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _row.session_status NOT IN ('starting', 'active') OR _row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = _row.room_id AND m.user_id = _uid AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  SELECT * INTO _p FROM public.room_call_participants
   WHERE session_id = _session_id AND user_id = _uid AND left_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  PERFORM set_config('app.call_ctx', '1', true);
  UPDATE public.room_call_participants
     SET mic_enabled = coalesce(_mic, mic_enabled),
         camera_enabled = CASE WHEN _row.call_mode = 'video'
                               THEN coalesce(_camera, camera_enabled) ELSE false END,
         connection_state = coalesce(_connection_state::public.call_connection_state,
                                     connection_state),
         last_seen_at = now()
   WHERE session_id = _session_id AND user_id = _uid;
  PERFORM set_config('app.call_ctx', '0', true);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.call_heartbeat(_session_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _n INTEGER;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.consume_rate_limit('call_heartbeat', 180, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  PERFORM set_config('app.call_ctx', '1', true);
  UPDATE public.room_call_participants p
     SET last_seen_at = now()
   WHERE p.session_id = _session_id AND p.user_id = _uid AND p.left_at IS NULL
     AND EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = p.room_id AND m.user_id = _uid AND m.status = 'joined');
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.call_ctx', '0', true);
  IF _n > 0 THEN RETURN jsonb_build_object('ok', true); END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
END; $$;

CREATE OR REPLACE FUNCTION public.issue_call_transport_grant(_session_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_call_sessions%ROWTYPE; _pre jsonb;
        _token TEXT; _exp TIMESTAMPTZ;
BEGIN
  PERFORM public.sweep_calls();
  SELECT * INTO _row FROM public.room_call_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _pre := public.call_precheck(_row.room_id, 'call_grant', 90, 300);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;

  IF _row.session_status NOT IN ('starting', 'active') OR _row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_call_participants p
                  WHERE p.session_id = _session_id AND p.user_id = _uid AND p.left_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF public.call_block_conflict(_session_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  _exp := least(now() + interval '2 minutes', _row.expires_at);

  PERFORM set_config('app.call_ctx', '1', true);
  UPDATE public.call_transport_grants SET revoked_at = now()
   WHERE session_id = _session_id AND user_id = _uid AND revoked_at IS NULL;
  INSERT INTO public.call_transport_grants(
    session_id, room_id, user_id, token_hash, relay_allowed, expires_at)
  VALUES (_session_id, _row.room_id, _uid,
          encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _row.allow_relay, _exp);
  PERFORM set_config('app.call_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'token', _token,
    'relay_allowed', _row.allow_relay, 'expires_at', _exp,
    'ttl_seconds', greatest(0, floor(extract(epoch FROM (_exp - now()))))::int);
END; $$;

CREATE OR REPLACE FUNCTION public.verify_call_grant(_session_id UUID, _token TEXT)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _id UUID;
BEGIN
  IF _uid IS NULL OR _token IS NULL OR length(_token) < 32 THEN RETURN NULL; END IF;
  SELECT g.id INTO _id
    FROM public.call_transport_grants g
    JOIN public.room_call_sessions s ON s.id = g.session_id
   WHERE g.session_id = _session_id
     AND g.user_id = _uid
     AND g.revoked_at IS NULL
     AND g.expires_at > now()
     AND g.token_hash = encode(sha256(convert_to(_token, 'UTF8')), 'hex')
     AND s.session_status IN ('starting', 'active')
     AND s.expires_at > now()
     AND EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = s.room_id AND m.user_id = _uid AND m.status = 'joined')
     AND EXISTS (SELECT 1 FROM public.room_call_participants p
                  WHERE p.session_id = s.id AND p.user_id = _uid AND p.left_at IS NULL)
   LIMIT 1;
  RETURN _id;
END; $$;

CREATE OR REPLACE FUNCTION public.redeem_call_transport_grant(_session_id UUID, _token TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _gid UUID; _g public.call_transport_grants%ROWTYPE;
BEGIN
  PERFORM public.sweep_calls();
  IF NOT public.consume_rate_limit('call_redeem', 150, 300) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  _gid := public.verify_call_grant(_session_id, _token);
  IF _gid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  SELECT * INTO _g FROM public.call_transport_grants WHERE id = _gid;
  RETURN jsonb_build_object('ok', true, 'relay_allowed', _g.relay_allowed,
    'expires_at', _g.expires_at,
    'ttl_seconds', greatest(0, floor(extract(epoch FROM (_g.expires_at - now()))))::int);
END; $$;

CREATE OR REPLACE FUNCTION public.post_call_signal(
  _session_id UUID, _token TEXT, _recipient_id UUID, _kind TEXT, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _gid UUID; _row public.room_call_sessions%ROWTYPE;
BEGIN
  IF _kind NOT IN ('offer', 'answer', 'ice', 'bye', 'renegotiate') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _payload IS NULL OR length(_payload::text) > 30000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF NOT public.consume_rate_limit('call_signal', 600, 300) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  _gid := public.verify_call_grant(_session_id, _token);
  IF _gid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  SELECT * INTO _row FROM public.room_call_sessions WHERE id = _session_id;
  IF NOT EXISTS (SELECT 1 FROM public.room_call_participants p
                  WHERE p.session_id = _session_id AND p.user_id = _recipient_id
                    AND p.left_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = _row.room_id AND m.user_id = _recipient_id
                    AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF public.is_blocked_between(_uid, _recipient_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  PERFORM set_config('app.call_ctx', '1', true);
  DELETE FROM public.call_signals WHERE expires_at <= now();
  INSERT INTO public.call_signals(session_id, room_id, sender_id, recipient_id, kind, payload)
  VALUES (_session_id, _row.room_id, _uid, _recipient_id, _kind, _payload);
  PERFORM set_config('app.call_ctx', '0', true);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.fetch_call_signals(_session_id UUID, _token TEXT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _gid UUID; _out jsonb;
BEGIN
  IF NOT public.consume_rate_limit('call_poll', 900, 300) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  _gid := public.verify_call_grant(_session_id, _token);
  IF _gid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  PERFORM set_config('app.call_ctx', '1', true);
  WITH taken AS (
    DELETE FROM public.call_signals
     WHERE session_id = _session_id AND recipient_id = _uid AND expires_at > now()
    RETURNING sender_id, kind, payload, created_at
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sender_id', sender_id, 'kind', kind, 'payload', payload, 'created_at', created_at)
         ORDER BY created_at), '[]'::jsonb) INTO _out FROM taken;
  PERFORM set_config('app.call_ctx', '0', true);
  RETURN jsonb_build_object('ok', true, 'signals', _out);
END; $$;

REVOKE EXECUTE ON FUNCTION public.guard_call_tables() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sweep_calls() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_call_settings(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.call_precheck(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.call_block_conflict(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_call_grant(uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.call_snapshot(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_call_settings(uuid, text, boolean, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_call_session(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_call_session(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.join_call_session(uuid, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_call_session(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_call_media_state(uuid, boolean, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.call_heartbeat(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.issue_call_transport_grant(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_call_transport_grant(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.post_call_signal(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fetch_call_signals(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.call_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_call_settings(uuid, text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_call_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_call_session(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_call_session(uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_call_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_call_media_state(uuid, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_call_transport_grant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_call_transport_grant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_call_signal(uuid, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_call_signals(uuid, text) TO authenticated;

ALTER TABLE public.room_call_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.room_call_participants REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_call_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_call_participants;