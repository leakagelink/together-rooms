-- ============================================================
-- PHASE 5 — Collaborative music queue & playlists
-- ============================================================

CREATE TYPE public.room_queue_mode AS ENUM ('host_only', 'collaborative', 'host_approval');
CREATE TYPE public.queue_item_status AS ENUM ('suggested', 'queued', 'playing', 'played', 'removed', 'rejected');
CREATE TYPE public.room_repeat_mode AS ENUM ('off', 'repeat_one', 'repeat_queue');
CREATE TYPE public.playlist_visibility AS ENUM ('private', 'shared_with_room');

-- ---------- room queue settings (authoritative room music state) ----------
CREATE TABLE public.room_queue_settings (
  room_id UUID PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  queue_mode public.room_queue_mode NOT NULL DEFAULT 'collaborative',
  repeat_mode public.room_repeat_mode NOT NULL DEFAULT 'off',
  shuffle_enabled BOOLEAN NOT NULL DEFAULT false,
  shuffle_seed BIGINT NOT NULL DEFAULT (floor(random() * 1000000000)::bigint),
  queue_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.room_queue_settings TO authenticated;
GRANT ALL ON public.room_queue_settings TO service_role;
ALTER TABLE public.room_queue_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room members read queue settings"
  ON public.room_queue_settings FOR SELECT TO authenticated
  USING (public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid()));

-- ---------- room media queue ----------
CREATE TABLE public.room_media_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  provider public.playback_provider NOT NULL DEFAULT 'youtube',
  provider_media_id TEXT NOT NULL,
  title TEXT,
  thumbnail_url TEXT,
  policy_check_result JSONB,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  position NUMERIC(20,6) NOT NULL,
  status public.queue_item_status NOT NULL DEFAULT 'queued',
  played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX room_media_queue_room_order_idx
  ON public.room_media_queue (room_id, status, position, created_at, id);

GRANT SELECT ON public.room_media_queue TO authenticated;
GRANT ALL ON public.room_media_queue TO service_role;
ALTER TABLE public.room_media_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room members read the queue"
  ON public.room_media_queue FOR SELECT TO authenticated
  USING (public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid()));

-- ---------- playlists ----------
CREATE TABLE public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  visibility public.playlist_visibility NOT NULL DEFAULT 'private',
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.playlists TO authenticated;
GRANT ALL ON public.playlists TO service_role;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and shared-room members read playlists"
  ON public.playlists FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (visibility = 'shared_with_room' AND room_id IS NOT NULL
        AND (public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid())))
  );

CREATE TABLE public.playlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  provider public.playback_provider NOT NULL DEFAULT 'youtube',
  provider_media_id TEXT NOT NULL,
  title TEXT,
  thumbnail_url TEXT,
  position NUMERIC(20,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX playlist_items_order_idx ON public.playlist_items (playlist_id, position, created_at, id);

GRANT SELECT ON public.playlist_items TO authenticated;
GRANT ALL ON public.playlist_items TO service_role;
ALTER TABLE public.playlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readable when the parent playlist is readable"
  ON public.playlist_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.playlists p
     WHERE p.id = playlist_id
       AND (p.owner_id = auth.uid()
            OR (p.visibility = 'shared_with_room' AND p.room_id IS NOT NULL
                AND (public.is_room_member(p.room_id, auth.uid())
                     OR public.is_room_host(p.room_id, auth.uid()))))
  ));

-- ---------- write guards: RPC-only mutations ----------
CREATE OR REPLACE FUNCTION public.guard_queue_tables()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('app.queue_ctx', true), '') = '1'
     OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'queue_write_forbidden' USING ERRCODE = '42501';
END; $$;

CREATE TRIGGER guard_room_media_queue
  BEFORE INSERT OR UPDATE OR DELETE ON public.room_media_queue
  FOR EACH ROW EXECUTE FUNCTION public.guard_queue_tables();
CREATE TRIGGER guard_room_queue_settings
  BEFORE INSERT OR UPDATE OR DELETE ON public.room_queue_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_queue_tables();
CREATE TRIGGER guard_playlists
  BEFORE INSERT OR UPDATE OR DELETE ON public.playlists
  FOR EACH ROW EXECUTE FUNCTION public.guard_queue_tables();
CREATE TRIGGER guard_playlist_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.playlist_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_queue_tables();

CREATE TRIGGER set_room_media_queue_updated_at BEFORE UPDATE ON public.room_media_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_room_queue_settings_updated_at BEFORE UPDATE ON public.room_queue_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_playlists_updated_at BEFORE UPDATE ON public.playlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_playlist_items_updated_at BEFORE UPDATE ON public.playlist_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Helpers
-- ============================================================

-- Ensures a settings row exists and returns it locked for update.
CREATE OR REPLACE FUNCTION public.lock_queue_settings(_room_id UUID)
RETURNS public.room_queue_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _row public.room_queue_settings%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.room_queue_settings WHERE room_id = _room_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('app.queue_ctx', '1', true);
    INSERT INTO public.room_queue_settings (room_id) VALUES (_room_id)
      ON CONFLICT (room_id) DO NOTHING;
    PERFORM set_config('app.queue_ctx', '0', true);
    SELECT * INTO _row FROM public.room_queue_settings WHERE room_id = _room_id FOR UPDATE;
  END IF;
  RETURN _row;
END; $$;

CREATE OR REPLACE FUNCTION public.bump_queue_version(_room_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _v INTEGER;
BEGIN
  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_queue_settings SET queue_version = queue_version + 1
   WHERE room_id = _room_id RETURNING queue_version INTO _v;
  PERFORM set_config('app.queue_ctx', '0', true);
  RETURN coalesce(_v, 0);
END; $$;

-- Common gate for every queue mutation: auth, room lifecycle, membership,
-- optional queue-version check and rate limiting.
CREATE OR REPLACE FUNCTION public.queue_precheck(
  _room_id UUID, _action TEXT, _limit INTEGER, _window_seconds INTEGER,
  _expected_queue_version INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _reason TEXT;
  _settings public.room_queue_settings%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _room_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _reason := public.room_is_joinable(_room);
  IF _reason <> 'ok' THEN RETURN jsonb_build_object('ok', false, 'reason', _reason); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = _room_id AND m.user_id = _uid AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF NOT public.consume_rate_limit(_action, _limit, _window_seconds) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  _settings := public.lock_queue_settings(_room_id);
  IF _expected_queue_version IS NOT NULL AND _expected_queue_version <> _settings.queue_version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'version_conflict',
                              'queue_version', _settings.queue_version);
  END IF;

  RETURN NULL;
END; $$;

-- Authoritative, trusted policy snapshot for a media id. NULL when the
-- trusted cache cannot authorize the embed (fail closed).
CREATE OR REPLACE FUNCTION public.verified_media_snapshot(_media_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _policy public.media_metadata_cache%ROWTYPE;
  _title TEXT;
  _thumb TEXT;
  _reason TEXT;
BEGIN
  IF _media_id IS NULL OR _media_id !~ '^[A-Za-z0-9_-]{11}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO _policy FROM public.media_metadata_cache
   WHERE provider = 'youtube' AND media_id = _media_id LIMIT 1;

  IF NOT FOUND OR _policy.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'provider_verification_failed');
  END IF;

  IF NOT (_policy.status IN ('ok', 'made_for_kids')
          AND _policy.embeddable
          AND coalesce(_policy.privacy_status, 'unknown') <> 'private') THEN
    IF NOT _policy.embeddable THEN _reason := 'not_embeddable';
    ELSIF _policy.privacy_status = 'private' THEN _reason := 'privacy_blocked';
    ELSE _reason := _policy.status;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', _reason);
  END IF;

  _title := left(btrim(coalesce(_policy.title, '')), 200);
  IF _title = '' THEN _title := NULL; END IF;

  _thumb := left(btrim(coalesce(_policy.thumbnail_url, '')), 500);
  IF _thumb IS NULL OR _thumb !~ '^https://i\.ytimg\.com/vi/[A-Za-z0-9_-]{11}/' THEN
    _thumb := 'https://i.ytimg.com/vi/' || _media_id || '/hqdefault.jpg';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'title', _title,
    'thumbnail_url', _thumb,
    'policy', jsonb_build_object(
      'provider', 'youtube', 'media_id', _media_id, 'status', _policy.status,
      'playable', true, 'tracking_restricted', _policy.made_for_kids,
      'made_for_kids', _policy.made_for_kids, 'embeddable', _policy.embeddable,
      'privacy_status', _policy.privacy_status, 'title', _title,
      'thumbnail_url', _thumb, 'checked_at', _policy.recorded_at::text
    )
  );
END; $$;

CREATE OR REPLACE FUNCTION public.can_manage_queue(_room_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.can_control_playback(_room_id, _user_id)
      OR public.is_room_host(_room_id, _user_id);
$$;

CREATE OR REPLACE FUNCTION public.queue_snapshot(_room_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'room_id', _room_id,
    'queue_version', coalesce((SELECT queue_version FROM public.room_queue_settings WHERE room_id = _room_id), 0),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id, 'provider', q.provider, 'provider_media_id', q.provider_media_id,
        'title', q.title, 'thumbnail_url', q.thumbnail_url, 'status', q.status,
        'position', q.position, 'added_by', q.added_by, 'created_at', q.created_at
      ) ORDER BY q.position, q.created_at, q.id)
        FROM public.room_media_queue q
       WHERE q.room_id = _room_id AND q.status IN ('suggested', 'queued', 'playing')
    ), '[]'::jsonb)
  );
$$;

-- Writes a verified queue item into the authoritative playback state.
CREATE OR REPLACE FUNCTION public.apply_queue_item(_room_id UUID, _item public.room_media_queue, _uid UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('app.playback_ctx', '1', true);
  INSERT INTO public.room_playback_state AS s
    (room_id, provider, provider_media_id, title, thumbnail_url, playback_status,
     position_seconds, playback_started_at, version, controlled_by, policy_check_result)
  VALUES (_room_id, 'youtube', _item.provider_media_id, _item.title, _item.thumbnail_url,
          'playing', 0, now(), 1, _uid, _item.policy_check_result)
  ON CONFLICT (room_id) DO UPDATE SET
    provider = 'youtube',
    provider_media_id = EXCLUDED.provider_media_id,
    title = EXCLUDED.title,
    thumbnail_url = EXCLUDED.thumbnail_url,
    playback_status = 'playing',
    position_seconds = 0,
    playback_started_at = now(),
    version = s.version + 1,
    controlled_by = _uid,
    policy_check_result = EXCLUDED.policy_check_result;
  PERFORM set_config('app.playback_ctx', '0', true);

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_media_queue SET status = 'played', played_at = now()
   WHERE room_id = _room_id AND status = 'playing' AND id <> _item.id;
  UPDATE public.room_media_queue SET status = 'playing', played_at = now()
   WHERE id = _item.id;
  PERFORM set_config('app.queue_ctx', '0', true);
END; $$;

-- ============================================================
-- Queue mutations
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_to_queue(
  _room_id UUID, _provider TEXT, _media_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail JSONB;
  _settings public.room_queue_settings%ROWTYPE;
  _snapshot JSONB;
  _status public.queue_item_status;
  _pos NUMERIC;
  _id UUID;
BEGIN
  _fail := public.queue_precheck(_room_id, 'queue_add', 20, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF _provider IS DISTINCT FROM 'youtube' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO _settings FROM public.room_queue_settings WHERE room_id = _room_id FOR UPDATE;

  IF _settings.queue_mode = 'host_only' AND NOT public.can_manage_queue(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- Server-side policy verification. Client metadata is never accepted.
  _snapshot := public.verified_media_snapshot(_media_id);
  IF NOT (_snapshot->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', _snapshot->>'reason');
  END IF;

  IF EXISTS (SELECT 1 FROM public.room_media_queue
              WHERE room_id = _room_id AND provider_media_id = _media_id
                AND status IN ('suggested', 'queued', 'playing')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_item');
  END IF;

  IF _settings.queue_mode = 'host_approval' AND NOT public.can_manage_queue(_room_id, _uid) THEN
    _status := 'suggested';
  ELSE
    _status := 'queued';
  END IF;

  SELECT coalesce(max(position), 0) + 1024 INTO _pos
    FROM public.room_media_queue WHERE room_id = _room_id;

  PERFORM set_config('app.queue_ctx', '1', true);
  INSERT INTO public.room_media_queue
    (room_id, provider, provider_media_id, title, thumbnail_url, policy_check_result,
     added_by, position, status)
  VALUES (_room_id, 'youtube', _media_id, _snapshot->>'title', _snapshot->>'thumbnail_url',
          _snapshot->'policy', _uid, _pos, _status)
  RETURNING id INTO _id;
  PERFORM set_config('app.queue_ctx', '0', true);

  IF _status = 'queued' THEN
    PERFORM public.emit_playback_system_message(_room_id, 'QUEUE_TRACK_ADDED', 'Track added to the queue.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', _id, 'status', _status,
                            'queue_version', public.bump_queue_version(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.remove_from_queue(_item_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _item public.room_media_queue%ROWTYPE;
  _fail JSONB;
BEGIN
  SELECT * INTO _item FROM public.room_media_queue WHERE id = _item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _fail := public.queue_precheck(_item.room_id, 'queue_mutate', 40, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF NOT (public.can_manage_queue(_item.room_id, _uid) OR _item.added_by = _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _item.status NOT IN ('suggested', 'queued') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_media_queue SET status = 'removed' WHERE id = _item_id;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'queue_version', public.bump_queue_version(_item.room_id));
END; $$;

-- Reorder. `_target_index` is a 0-based index inside the queued list. The
-- server recomputes the position from the current authoritative order, so a
-- stale client array can never dictate the outcome.
CREATE OR REPLACE FUNCTION public.move_queue_item(
  _item_id UUID, _target_index INTEGER, _expected_queue_version INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _item public.room_media_queue%ROWTYPE;
  _fail JSONB;
  _ids UUID[];
  _new_ids UUID[];
  _i INTEGER;
  _idx INTEGER;
BEGIN
  SELECT * INTO _item FROM public.room_media_queue WHERE id = _item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _fail := public.queue_precheck(_item.room_id, 'queue_mutate', 40, 60, _expected_queue_version);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF NOT public.can_manage_queue(_item.room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _item.status <> 'queued' OR _target_index IS NULL OR _target_index < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT array_agg(id ORDER BY position, created_at, id) INTO _ids
    FROM public.room_media_queue
   WHERE room_id = _item.room_id AND status = 'queued';

  _ids := array_remove(_ids, _item_id);
  _idx := least(_target_index, coalesce(array_length(_ids, 1), 0));
  _new_ids := (CASE WHEN _idx = 0 THEN ARRAY[]::UUID[] ELSE _ids[1:_idx] END)
              || ARRAY[_item_id]
              || (CASE WHEN _idx >= coalesce(array_length(_ids, 1), 0)
                       THEN ARRAY[]::UUID[] ELSE _ids[_idx+1:] END);

  -- Full renumber inside the transaction: deterministic and gap-free.
  PERFORM set_config('app.queue_ctx', '1', true);
  FOR _i IN 1..array_length(_new_ids, 1) LOOP
    UPDATE public.room_media_queue SET position = _i * 1024 WHERE id = _new_ids[_i];
  END LOOP;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'queue_version', public.bump_queue_version(_item.room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.approve_queue_item(_item_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _item public.room_media_queue%ROWTYPE;
  _fail JSONB;
  _snapshot JSONB;
BEGIN
  SELECT * INTO _item FROM public.room_media_queue WHERE id = _item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _fail := public.queue_precheck(_item.room_id, 'queue_mutate', 40, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF NOT public.can_manage_queue(_item.room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _item.status <> 'suggested' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  -- Re-verify at approval time: an expired policy must not slip in.
  _snapshot := public.verified_media_snapshot(_item.provider_media_id);
  IF NOT (_snapshot->>'ok')::boolean THEN
    PERFORM set_config('app.queue_ctx', '1', true);
    UPDATE public.room_media_queue SET status = 'removed' WHERE id = _item_id;
    PERFORM set_config('app.queue_ctx', '0', true);
    RETURN jsonb_build_object('ok', false, 'reason', _snapshot->>'reason');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_media_queue
     SET status = 'queued', title = _snapshot->>'title',
         thumbnail_url = _snapshot->>'thumbnail_url',
         policy_check_result = _snapshot->'policy'
   WHERE id = _item_id;
  PERFORM set_config('app.queue_ctx', '0', true);

  PERFORM public.emit_playback_system_message(_item.room_id, 'QUEUE_TRACK_ADDED', 'Track added to the queue.');
  RETURN jsonb_build_object('ok', true, 'queue_version', public.bump_queue_version(_item.room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.reject_queue_item(_item_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _item public.room_media_queue%ROWTYPE;
  _fail JSONB;
BEGIN
  SELECT * INTO _item FROM public.room_media_queue WHERE id = _item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _fail := public.queue_precheck(_item.room_id, 'queue_mutate', 40, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF NOT public.can_manage_queue(_item.room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _item.status <> 'suggested' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_media_queue SET status = 'rejected' WHERE id = _item_id;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'queue_version', public.bump_queue_version(_item.room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.clear_queue(_room_id UUID, _expected_queue_version INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail JSONB;
BEGIN
  _fail := public.queue_precheck(_room_id, 'queue_mutate', 40, 60, _expected_queue_version);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;
  IF NOT public.can_manage_queue(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_media_queue SET status = 'removed'
   WHERE room_id = _room_id AND status IN ('suggested', 'queued');
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'queue_version', public.bump_queue_version(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.set_queue_mode(_room_id UUID, _mode TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid(); _fail JSONB;
BEGIN
  _fail := public.queue_precheck(_room_id, 'queue_mutate', 40, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;
  IF NOT public.is_room_host(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _mode NOT IN ('host_only', 'collaborative', 'host_approval') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_queue_settings SET queue_mode = _mode::public.room_queue_mode
   WHERE room_id = _room_id;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'queue_version', public.bump_queue_version(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.set_repeat_mode(_room_id UUID, _mode TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid(); _fail JSONB;
BEGIN
  _fail := public.queue_precheck(_room_id, 'queue_mutate', 40, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;
  IF NOT public.can_manage_queue(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _mode NOT IN ('off', 'repeat_one', 'repeat_queue') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_queue_settings SET repeat_mode = _mode::public.room_repeat_mode
   WHERE room_id = _room_id;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'queue_version', public.bump_queue_version(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.set_shuffle_enabled(_room_id UUID, _enabled BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid(); _fail JSONB;
BEGIN
  _fail := public.queue_precheck(_room_id, 'queue_mutate', 40, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;
  IF NOT public.can_manage_queue(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.room_queue_settings
     SET shuffle_enabled = coalesce(_enabled, false),
         -- A fresh seed per activation; the seed itself is authoritative so
         -- every member derives the identical progression.
         shuffle_seed = CASE WHEN coalesce(_enabled, false) AND NOT shuffle_enabled
                             THEN floor(random() * 1000000000)::bigint ELSE shuffle_seed END
   WHERE room_id = _room_id;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'queue_version', public.bump_queue_version(_room_id));
END; $$;

-- ============================================================
-- Authoritative track transitions
-- ============================================================

-- Picks the next eligible item. Shuffle uses a deterministic server-held seed
-- (md5(seed || id)) rather than client randomness, so the progression is
-- identical for every member and the stored queue order is never rewritten.
CREATE OR REPLACE FUNCTION public.pick_next_queue_item(_room_id UUID, _exclude UUID)
RETURNS public.room_media_queue
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _settings public.room_queue_settings%ROWTYPE;
  _item public.room_media_queue%ROWTYPE;
BEGIN
  SELECT * INTO _settings FROM public.room_queue_settings WHERE room_id = _room_id;

  IF coalesce(_settings.shuffle_enabled, false) THEN
    SELECT * INTO _item FROM public.room_media_queue
     WHERE room_id = _room_id AND status = 'queued' AND id IS DISTINCT FROM _exclude
     ORDER BY md5(coalesce(_settings.shuffle_seed, 0)::text || id::text), id
     LIMIT 1;
  ELSE
    SELECT * INTO _item FROM public.room_media_queue
     WHERE room_id = _room_id AND status = 'queued' AND id IS DISTINCT FROM _exclude
     ORDER BY position, created_at, id
     LIMIT 1;
  END IF;

  RETURN _item;
END; $$;

CREATE OR REPLACE FUNCTION public.advance_queue(
  _room_id UUID, _expected_version INTEGER DEFAULT NULL, _cause TEXT DEFAULT 'ended'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail JSONB;
  _settings public.room_queue_settings%ROWTYPE;
  _current public.room_media_queue%ROWTYPE;
  _next public.room_media_queue%ROWTYPE;
  _snapshot JSONB;
  _guard INTEGER := 0;
BEGIN
  IF _cause NOT IN ('ended', 'next') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  -- playback_precheck owns the version check, so only the first client whose
  -- expected version matches can advance; every other simultaneous ENDED
  -- report loses with version_conflict.
  _fail := public.playback_precheck(_room_id, _expected_version, 'queue_advance', 30, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  _settings := public.lock_queue_settings(_room_id);

  SELECT * INTO _current FROM public.room_media_queue
   WHERE room_id = _room_id AND status = 'playing' LIMIT 1;

  IF _cause = 'ended' AND _settings.repeat_mode = 'repeat_one' AND _current.id IS NOT NULL THEN
    PERFORM public.apply_queue_item(_room_id, _current, _uid);
    RETURN jsonb_build_object('ok', true, 'outcome', 'repeat_one',
                              'state', public.room_playback_snapshot(_room_id));
  END IF;

  LOOP
    _guard := _guard + 1;
    EXIT WHEN _guard > 25;

    _next := public.pick_next_queue_item(_room_id, _current.id);

    IF _next.id IS NULL AND _settings.repeat_mode = 'repeat_queue' THEN
      -- One controlled recycle pass: played items become queued again. No new
      -- rows are ever inserted, so the queue cannot grow without bound.
      PERFORM set_config('app.queue_ctx', '1', true);
      UPDATE public.room_media_queue SET status = 'queued'
       WHERE room_id = _room_id AND status = 'played';
      PERFORM set_config('app.queue_ctx', '0', true);
      _next := public.pick_next_queue_item(_room_id, NULL);
    END IF;

    IF _next.id IS NULL THEN
      IF _current.id IS NOT NULL THEN
        PERFORM set_config('app.queue_ctx', '1', true);
        UPDATE public.room_media_queue SET status = 'played', played_at = now()
         WHERE id = _current.id;
        PERFORM set_config('app.queue_ctx', '0', true);
      END IF;
      PERFORM set_config('app.playback_ctx', '1', true);
      UPDATE public.room_playback_state
         SET playback_status = 'ended', playback_started_at = NULL,
             version = version + 1, controlled_by = _uid
       WHERE room_id = _room_id;
      PERFORM set_config('app.playback_ctx', '0', true);
      PERFORM public.bump_queue_version(_room_id);
      RETURN jsonb_build_object('ok', true, 'outcome', 'queue_exhausted',
                                'state', public.room_playback_snapshot(_room_id));
    END IF;

    -- Fail closed: an item whose policy has expired or turned unplayable is
    -- dropped from the queue instead of being played.
    _snapshot := public.verified_media_snapshot(_next.provider_media_id);
    IF (_snapshot->>'ok')::boolean THEN
      PERFORM set_config('app.queue_ctx', '1', true);
      UPDATE public.room_media_queue
         SET title = _snapshot->>'title', thumbnail_url = _snapshot->>'thumbnail_url',
             policy_check_result = _snapshot->'policy'
       WHERE id = _next.id;
      PERFORM set_config('app.queue_ctx', '0', true);
      SELECT * INTO _next FROM public.room_media_queue WHERE id = _next.id;
      EXIT;
    END IF;

    PERFORM set_config('app.queue_ctx', '1', true);
    UPDATE public.room_media_queue SET status = 'removed' WHERE id = _next.id;
    PERFORM set_config('app.queue_ctx', '0', true);
  END LOOP;

  IF _next.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'queue_exhausted',
                              'state', public.room_playback_snapshot(_room_id));
  END IF;

  PERFORM public.apply_queue_item(_room_id, _next, _uid);
  PERFORM public.bump_queue_version(_room_id);

  IF _cause = 'next' THEN
    PERFORM public.emit_playback_system_message(_room_id, 'QUEUE_TRACK_SKIPPED', 'Skipped to the next track.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'outcome', 'advanced', 'item_id', _next.id,
                            'state', public.room_playback_snapshot(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.previous_queue_item(_room_id UUID, _expected_version INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail JSONB;
  _current public.room_media_queue%ROWTYPE;
  _prev public.room_media_queue%ROWTYPE;
  _snapshot JSONB;
BEGIN
  _fail := public.playback_precheck(_room_id, _expected_version, 'queue_advance', 30, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  PERFORM public.lock_queue_settings(_room_id);

  SELECT * INTO _current FROM public.room_media_queue
   WHERE room_id = _room_id AND status = 'playing' LIMIT 1;

  SELECT * INTO _prev FROM public.room_media_queue
   WHERE room_id = _room_id AND status = 'played'
   ORDER BY played_at DESC NULLS LAST, position DESC LIMIT 1;

  IF _prev.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  _snapshot := public.verified_media_snapshot(_prev.provider_media_id);
  IF NOT (_snapshot->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', _snapshot->>'reason');
  END IF;

  IF _current.id IS NOT NULL THEN
    PERFORM set_config('app.queue_ctx', '1', true);
    UPDATE public.room_media_queue SET status = 'queued' WHERE id = _current.id;
    PERFORM set_config('app.queue_ctx', '0', true);
  END IF;

  PERFORM public.apply_queue_item(_room_id, _prev, _uid);
  PERFORM public.bump_queue_version(_room_id);

  RETURN jsonb_build_object('ok', true, 'outcome', 'previous', 'item_id', _prev.id,
                            'state', public.room_playback_snapshot(_room_id));
END; $$;

CREATE OR REPLACE FUNCTION public.restart_current_item(_room_id UUID, _expected_version INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail JSONB;
BEGIN
  _fail := public.playback_precheck(_room_id, _expected_version, 'queue_advance', 30, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.room_playback_state
                  WHERE room_id = _room_id AND provider_media_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  UPDATE public.room_playback_state
     SET position_seconds = 0,
         playback_started_at = CASE WHEN playback_status = 'playing' THEN now() ELSE NULL END,
         version = version + 1, controlled_by = _uid
   WHERE room_id = _room_id;
  PERFORM set_config('app.playback_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END; $$;

-- Starts playback from the queue explicitly (first eligible item).
CREATE OR REPLACE FUNCTION public.start_queue(_room_id UUID, _expected_version INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN public.advance_queue(_room_id, _expected_version, 'next');
END; $$;

-- ============================================================
-- Playlists
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_playlist(_name TEXT, _description TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid(); _id UUID; _clean TEXT := btrim(coalesce(_name, ''));
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF char_length(_clean) < 1 OR char_length(_clean) > 80
     OR (_description IS NOT NULL AND char_length(_description) > 500) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF NOT public.consume_rate_limit('playlist_create', 10, 3600) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  INSERT INTO public.playlists (owner_id, name, description)
  VALUES (_uid, _clean, nullif(btrim(coalesce(_description, '')), ''))
  RETURNING id INTO _id;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'playlist_id', _id);
END; $$;

CREATE OR REPLACE FUNCTION public.update_playlist(
  _playlist_id UUID, _name TEXT DEFAULT NULL, _description TEXT DEFAULT NULL,
  _visibility TEXT DEFAULT NULL, _room_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid(); _pl public.playlists%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  SELECT * INTO _pl FROM public.playlists WHERE id = _playlist_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _pl.owner_id <> _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  IF _visibility IS NOT NULL AND _visibility NOT IN ('private', 'shared_with_room') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _visibility = 'shared_with_room' THEN
    IF _room_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.room_members
        WHERE room_id = _room_id AND user_id = _uid AND status = 'joined') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
  END IF;
  IF NOT public.consume_rate_limit('playlist_mutate', 60, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  UPDATE public.playlists
     SET name = coalesce(nullif(btrim(coalesce(_name, '')), ''), name),
         description = coalesce(nullif(btrim(coalesce(_description, '')), ''), description),
         visibility = coalesce(_visibility::public.playlist_visibility, visibility),
         room_id = CASE WHEN _visibility = 'shared_with_room' THEN _room_id
                        WHEN _visibility = 'private' THEN NULL ELSE room_id END,
         version = version + 1
   WHERE id = _playlist_id;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.delete_playlist(_playlist_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid(); _pl public.playlists%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  SELECT * INTO _pl FROM public.playlists WHERE id = _playlist_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _pl.owner_id <> _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  DELETE FROM public.playlist_items WHERE playlist_id = _playlist_id;
  DELETE FROM public.playlists WHERE id = _playlist_id;
  PERFORM set_config('app.queue_ctx', '0', true);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.add_playlist_item(_playlist_id UUID, _provider TEXT, _media_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid(); _pl public.playlists%ROWTYPE;
  _snapshot JSONB; _pos NUMERIC; _id UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _provider IS DISTINCT FROM 'youtube' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO _pl FROM public.playlists WHERE id = _playlist_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _pl.owner_id <> _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  IF NOT public.consume_rate_limit('playlist_mutate', 60, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  _snapshot := public.verified_media_snapshot(_media_id);
  IF NOT (_snapshot->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', _snapshot->>'reason');
  END IF;

  SELECT coalesce(max(position), 0) + 1024 INTO _pos
    FROM public.playlist_items WHERE playlist_id = _playlist_id;

  PERFORM set_config('app.queue_ctx', '1', true);
  INSERT INTO public.playlist_items (playlist_id, provider, provider_media_id, title, thumbnail_url, position)
  VALUES (_playlist_id, 'youtube', _media_id, _snapshot->>'title', _snapshot->>'thumbnail_url', _pos)
  RETURNING id INTO _id;
  UPDATE public.playlists SET version = version + 1 WHERE id = _playlist_id;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'item_id', _id);
END; $$;

CREATE OR REPLACE FUNCTION public.remove_playlist_item(_item_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid(); _pl public.playlists%ROWTYPE; _plid UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  SELECT playlist_id INTO _plid FROM public.playlist_items WHERE id = _item_id;
  IF _plid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO _pl FROM public.playlists WHERE id = _plid FOR UPDATE;
  IF _pl.owner_id <> _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  PERFORM set_config('app.queue_ctx', '1', true);
  DELETE FROM public.playlist_items WHERE id = _item_id;
  UPDATE public.playlists SET version = version + 1 WHERE id = _plid;
  PERFORM set_config('app.queue_ctx', '0', true);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.move_playlist_item(
  _item_id UUID, _target_index INTEGER, _expected_version INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid(); _pl public.playlists%ROWTYPE; _plid UUID;
  _ids UUID[]; _new_ids UUID[]; _i INTEGER; _idx INTEGER;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  SELECT playlist_id INTO _plid FROM public.playlist_items WHERE id = _item_id;
  IF _plid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO _pl FROM public.playlists WHERE id = _plid FOR UPDATE;
  IF _pl.owner_id <> _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  IF _expected_version IS NOT NULL AND _expected_version <> _pl.version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'version_conflict', 'version', _pl.version);
  END IF;
  IF _target_index IS NULL OR _target_index < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT array_agg(id ORDER BY position, created_at, id) INTO _ids
    FROM public.playlist_items WHERE playlist_id = _plid;
  _ids := array_remove(_ids, _item_id);
  _idx := least(_target_index, coalesce(array_length(_ids, 1), 0));
  _new_ids := (CASE WHEN _idx = 0 THEN ARRAY[]::UUID[] ELSE _ids[1:_idx] END)
              || ARRAY[_item_id]
              || (CASE WHEN _idx >= coalesce(array_length(_ids, 1), 0)
                       THEN ARRAY[]::UUID[] ELSE _ids[_idx+1:] END);

  PERFORM set_config('app.queue_ctx', '1', true);
  FOR _i IN 1..array_length(_new_ids, 1) LOOP
    UPDATE public.playlist_items SET position = _i * 1024 WHERE id = _new_ids[_i];
  END LOOP;
  UPDATE public.playlists SET version = version + 1 WHERE id = _plid;
  PERFORM set_config('app.queue_ctx', '0', true);

  RETURN jsonb_build_object('ok', true);
END; $$;

-- Loads a playlist into a room queue through the authoritative queue path.
CREATE OR REPLACE FUNCTION public.start_room_from_playlist(_room_id UUID, _playlist_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail JSONB;
  _pl public.playlists%ROWTYPE;
  _item public.playlist_items%ROWTYPE;
  _snapshot JSONB;
  _pos NUMERIC;
  _added INTEGER := 0;
  _skipped INTEGER := 0;
BEGIN
  _fail := public.queue_precheck(_room_id, 'playlist_start', 5, 600);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF NOT public.can_manage_queue(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO _pl FROM public.playlists WHERE id = _playlist_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT (_pl.owner_id = _uid
          OR (_pl.visibility = 'shared_with_room' AND _pl.room_id = _room_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT coalesce(max(position), 0) INTO _pos FROM public.room_media_queue WHERE room_id = _room_id;

  FOR _item IN
    SELECT * FROM public.playlist_items WHERE playlist_id = _playlist_id
     ORDER BY position, created_at, id LIMIT 200
  LOOP
    _snapshot := public.verified_media_snapshot(_item.provider_media_id);
    IF NOT (_snapshot->>'ok')::boolean THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.room_media_queue
                WHERE room_id = _room_id AND provider_media_id = _item.provider_media_id
                  AND status IN ('suggested', 'queued', 'playing')) THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    _pos := _pos + 1024;
    PERFORM set_config('app.queue_ctx', '1', true);
    INSERT INTO public.room_media_queue
      (room_id, provider, provider_media_id, title, thumbnail_url, policy_check_result,
       added_by, position, status)
    VALUES (_room_id, 'youtube', _item.provider_media_id, _snapshot->>'title',
            _snapshot->>'thumbnail_url', _snapshot->'policy', _uid, _pos, 'queued');
    PERFORM set_config('app.queue_ctx', '0', true);
    _added := _added + 1;
  END LOOP;

  PERFORM public.emit_playback_system_message(_room_id, 'QUEUE_PLAYLIST_STARTED', 'A playlist was added to the queue.');

  RETURN jsonb_build_object('ok', true, 'added', _added, 'skipped', _skipped,
                            'queue_version', public.bump_queue_version(_room_id));
END; $$;

-- ============================================================
-- Execute grants (authenticated only; anon has no access)
-- ============================================================
REVOKE EXECUTE ON FUNCTION
  public.add_to_queue(UUID, TEXT, TEXT),
  public.remove_from_queue(UUID),
  public.move_queue_item(UUID, INTEGER, INTEGER),
  public.approve_queue_item(UUID),
  public.reject_queue_item(UUID),
  public.clear_queue(UUID, INTEGER),
  public.set_queue_mode(UUID, TEXT),
  public.set_repeat_mode(UUID, TEXT),
  public.set_shuffle_enabled(UUID, BOOLEAN),
  public.advance_queue(UUID, INTEGER, TEXT),
  public.previous_queue_item(UUID, INTEGER),
  public.restart_current_item(UUID, INTEGER),
  public.start_queue(UUID, INTEGER),
  public.queue_snapshot(UUID),
  public.create_playlist(TEXT, TEXT),
  public.update_playlist(UUID, TEXT, TEXT, TEXT, UUID),
  public.delete_playlist(UUID),
  public.add_playlist_item(UUID, TEXT, TEXT),
  public.remove_playlist_item(UUID),
  public.move_playlist_item(UUID, INTEGER, INTEGER),
  public.start_room_from_playlist(UUID, UUID)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.add_to_queue(UUID, TEXT, TEXT),
  public.remove_from_queue(UUID),
  public.move_queue_item(UUID, INTEGER, INTEGER),
  public.approve_queue_item(UUID),
  public.reject_queue_item(UUID),
  public.clear_queue(UUID, INTEGER),
  public.set_queue_mode(UUID, TEXT),
  public.set_repeat_mode(UUID, TEXT),
  public.set_shuffle_enabled(UUID, BOOLEAN),
  public.advance_queue(UUID, INTEGER, TEXT),
  public.previous_queue_item(UUID, INTEGER),
  public.restart_current_item(UUID, INTEGER),
  public.start_queue(UUID, INTEGER),
  public.queue_snapshot(UUID),
  public.create_playlist(TEXT, TEXT),
  public.update_playlist(UUID, TEXT, TEXT, TEXT, UUID),
  public.delete_playlist(UUID),
  public.add_playlist_item(UUID, TEXT, TEXT),
  public.remove_playlist_item(UUID),
  public.move_playlist_item(UUID, INTEGER, INTEGER),
  public.start_room_from_playlist(UUID, UUID)
TO authenticated, service_role;

-- Internal helpers must never be callable by end users.
REVOKE EXECUTE ON FUNCTION
  public.lock_queue_settings(UUID),
  public.bump_queue_version(UUID),
  public.queue_precheck(UUID, TEXT, INTEGER, INTEGER, INTEGER),
  public.verified_media_snapshot(TEXT),
  public.apply_queue_item(UUID, public.room_media_queue, UUID),
  public.pick_next_queue_item(UUID, UUID),
  public.guard_queue_tables()
FROM PUBLIC, anon, authenticated;

-- Realtime for the queue uses the same postgres_changes + RLS pipeline.
ALTER TABLE public.room_media_queue REPLICA IDENTITY FULL;
ALTER TABLE public.room_queue_settings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_media_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_queue_settings;
