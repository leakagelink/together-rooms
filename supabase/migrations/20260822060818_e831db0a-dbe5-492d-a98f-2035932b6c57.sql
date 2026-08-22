-- ============ Phase 4: YouTube watch-together playback ============

DO $$ BEGIN
  CREATE TYPE public.playback_provider AS ENUM ('youtube');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.playback_status AS ENUM ('idle','ready','playing','paused','ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.room_playback_state (
  room_id UUID PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  provider public.playback_provider,
  provider_media_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  playback_status public.playback_status NOT NULL DEFAULT 'idle',
  position_seconds NUMERIC(12,3) NOT NULL DEFAULT 0,
  playback_started_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 0,
  controlled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reads only; every write is owned by a SECURITY DEFINER RPC below.
GRANT SELECT ON public.room_playback_state TO authenticated;
GRANT ALL ON public.room_playback_state TO service_role;

ALTER TABLE public.room_playback_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read room playback state" ON public.room_playback_state;
CREATE POLICY "Members read room playback state"
ON public.room_playback_state
FOR SELECT
TO authenticated
USING (
  public.is_room_member(room_id, auth.uid())
  OR public.is_room_host(room_id, auth.uid())
);

-- ---- guard trigger: no direct writes, even for a role that somehow has grants
CREATE OR REPLACE FUNCTION public.guard_room_playback_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.playback_ctx', true) = '1'
     OR current_user IN ('postgres','supabase_admin','service_role') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'direct writes to room_playback_state are not permitted'
    USING ERRCODE = '42501';
END; $$;

DROP TRIGGER IF EXISTS guard_room_playback_state ON public.room_playback_state;
CREATE TRIGGER guard_room_playback_state
BEFORE INSERT OR UPDATE OR DELETE ON public.room_playback_state
FOR EACH ROW EXECUTE FUNCTION public.guard_room_playback_state();

DROP TRIGGER IF EXISTS set_room_playback_state_updated_at ON public.room_playback_state;
CREATE TRIGGER set_room_playback_state_updated_at
BEFORE UPDATE ON public.room_playback_state
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- authorization helper (reuses the existing room permission model)
CREATE OR REPLACE FUNCTION public.can_control_playback(_room_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.is_room_host(_room_id, _user_id)
    OR EXISTS (
      SELECT 1 FROM public.room_members m
       WHERE m.room_id = _room_id AND m.user_id = _user_id
         AND m.status = 'joined' AND m.can_control_playback
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_control_playback(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_control_playback(uuid, uuid) TO authenticated;

-- ---- shared precheck: returns NULL when allowed, else a failure jsonb
CREATE OR REPLACE FUNCTION public.playback_precheck(
  _room_id uuid,
  _expected_version integer,
  _action text,
  _limit integer,
  _window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _reason TEXT;
  _current INTEGER;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _room_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _reason := public.room_is_joinable(_room);
  IF _reason <> 'ok' THEN RETURN jsonb_build_object('ok', false, 'reason', _reason); END IF;

  IF NOT public.can_control_playback(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF NOT public.consume_rate_limit(_action, _limit, _window_seconds) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT version INTO _current FROM public.room_playback_state WHERE room_id = _room_id FOR UPDATE;
  IF NOT FOUND THEN _current := 0; END IF;

  IF _expected_version IS NOT NULL AND _expected_version <> _current THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'version_conflict',
      'state', public.room_playback_snapshot(_room_id)
    );
  END IF;

  RETURN NULL;
END; $$;

REVOKE EXECUTE ON FUNCTION public.playback_precheck(uuid, integer, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ---- snapshot helper (authoritative state as jsonb, no extra data)
CREATE OR REPLACE FUNCTION public.room_playback_snapshot(_room_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(s) FROM (
    SELECT room_id, provider, provider_media_id, title, thumbnail_url, playback_status,
           position_seconds, playback_started_at, version, controlled_by, updated_at
      FROM public.room_playback_state WHERE room_id = _room_id
  ) s;
$$;

REVOKE EXECUTE ON FUNCTION public.room_playback_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- ---- current authoritative position (server clock only)
CREATE OR REPLACE FUNCTION public.playback_current_position(_state public.room_playback_state)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _state.playback_status = 'playing' AND _state.playback_started_at IS NOT NULL
      THEN _state.position_seconds + EXTRACT(EPOCH FROM (now() - _state.playback_started_at))::numeric
    ELSE _state.position_seconds
  END;
$$;

-- ---- system chat message helper (video changes only, never per seek)
CREATE OR REPLACE FUNCTION public.emit_playback_system_message(_room_id uuid, _code text, _text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.message_ctx', '1', true);
  INSERT INTO public.room_messages (room_id, sender_id, content, content_type, system_code)
  VALUES (_room_id, NULL, _text, 'system', _code);
  PERFORM set_config('app.message_ctx', '0', true);
END; $$;

REVOKE EXECUTE ON FUNCTION public.emit_playback_system_message(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ============ playback RPCs ============

CREATE OR REPLACE FUNCTION public.set_room_media(
  _room_id uuid,
  _provider text,
  _media_id text,
  _title text DEFAULT NULL,
  _thumbnail_url text DEFAULT NULL,
  _expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail jsonb;
BEGIN
  _fail := public.playback_precheck(_room_id, _expected_version, 'playback_media', 10, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF _provider IS DISTINCT FROM 'youtube' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _media_id IS NULL OR _media_id !~ '^[A-Za-z0-9_-]{11}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  INSERT INTO public.room_playback_state AS s
    (room_id, provider, provider_media_id, title, thumbnail_url, playback_status,
     position_seconds, playback_started_at, version, controlled_by)
  VALUES (_room_id, 'youtube', _media_id, left(btrim(coalesce(_title,'')), 200),
          left(btrim(coalesce(_thumbnail_url,'')), 500), 'ready', 0, NULL, 1, _uid)
  ON CONFLICT (room_id) DO UPDATE SET
    provider = 'youtube',
    provider_media_id = EXCLUDED.provider_media_id,
    title = NULLIF(EXCLUDED.title, ''),
    thumbnail_url = NULLIF(EXCLUDED.thumbnail_url, ''),
    playback_status = 'ready',
    position_seconds = 0,
    playback_started_at = NULL,
    version = s.version + 1,
    controlled_by = _uid;
  PERFORM set_config('app.playback_ctx', '0', true);

  PERFORM public.emit_playback_system_message(_room_id, 'PLAYBACK_MEDIA_CHANGED', 'Video changed.');

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.play_room_media(_room_id uuid, _expected_version integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail jsonb;
  _state public.room_playback_state%ROWTYPE;
BEGIN
  _fail := public.playback_precheck(_room_id, _expected_version, 'playback_cmd', 30, 10);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  SELECT * INTO _state FROM public.room_playback_state WHERE room_id = _room_id;
  IF NOT FOUND OR _state.provider_media_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  UPDATE public.room_playback_state
     SET playback_status = 'playing',
         position_seconds = public.playback_current_position(_state),
         playback_started_at = now(),
         version = version + 1,
         controlled_by = _uid
   WHERE room_id = _room_id;
  PERFORM set_config('app.playback_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.pause_room_media(_room_id uuid, _expected_version integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail jsonb;
  _state public.room_playback_state%ROWTYPE;
BEGIN
  _fail := public.playback_precheck(_room_id, _expected_version, 'playback_cmd', 30, 10);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  SELECT * INTO _state FROM public.room_playback_state WHERE room_id = _room_id;
  IF NOT FOUND OR _state.provider_media_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  UPDATE public.room_playback_state
     SET playback_status = 'paused',
         position_seconds = public.playback_current_position(_state),
         playback_started_at = NULL,
         version = version + 1,
         controlled_by = _uid
   WHERE room_id = _room_id;
  PERFORM set_config('app.playback_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.seek_room_media(
  _room_id uuid,
  _position_seconds numeric,
  _expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail jsonb;
  _state public.room_playback_state%ROWTYPE;
BEGIN
  _fail := public.playback_precheck(_room_id, _expected_version, 'playback_seek', 15, 10);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF _position_seconds IS NULL OR _position_seconds < 0 OR _position_seconds > 86400 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO _state FROM public.room_playback_state WHERE room_id = _room_id;
  IF NOT FOUND OR _state.provider_media_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  UPDATE public.room_playback_state
     SET position_seconds = round(_position_seconds, 3),
         playback_started_at = CASE WHEN playback_status = 'playing' THEN now() ELSE NULL END,
         version = version + 1,
         controlled_by = _uid
   WHERE room_id = _room_id;
  PERFORM set_config('app.playback_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.clear_room_media(_room_id uuid, _expected_version integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail jsonb;
BEGIN
  _fail := public.playback_precheck(_room_id, _expected_version, 'playback_media', 10, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  UPDATE public.room_playback_state
     SET provider = NULL, provider_media_id = NULL, title = NULL, thumbnail_url = NULL,
         playback_status = 'idle', position_seconds = 0, playback_started_at = NULL,
         version = version + 1, controlled_by = _uid
   WHERE room_id = _room_id;
  PERFORM set_config('app.playback_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END; $$;

-- ---- least-privilege EXECUTE on the user-facing RPCs
REVOKE EXECUTE ON FUNCTION public.set_room_media(uuid, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_room_media(uuid, text, text, text, text, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.play_room_media(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.play_room_media(uuid, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pause_room_media(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pause_room_media(uuid, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.seek_room_media(uuid, numeric, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.seek_room_media(uuid, numeric, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_room_media(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clear_room_media(uuid, integer) TO authenticated;

-- ---- realtime
ALTER TABLE public.room_playback_state REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_playback_state;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
