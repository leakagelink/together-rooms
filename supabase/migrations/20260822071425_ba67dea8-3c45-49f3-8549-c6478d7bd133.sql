CREATE TABLE IF NOT EXISTS public.media_metadata_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  media_id TEXT NOT NULL,
  title TEXT,
  thumbnail_url TEXT,
  made_for_kids BOOLEAN NOT NULL DEFAULT false,
  embeddable BOOLEAN NOT NULL DEFAULT false,
  privacy_status TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL DEFAULT 'data_api',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE(provider, media_id)
);

GRANT SELECT ON public.media_metadata_cache TO authenticated;
GRANT ALL ON public.media_metadata_cache TO service_role;

ALTER TABLE public.media_metadata_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read media cache" ON public.media_metadata_cache;
CREATE POLICY "Authenticated read media cache"
  ON public.media_metadata_cache
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.room_playback_state
  ADD COLUMN IF NOT EXISTS policy_check_result JSONB;

CREATE OR REPLACE FUNCTION public.upsert_media_metadata_cache(
  _provider TEXT,
  _media_id TEXT,
  _title TEXT DEFAULT NULL,
  _thumbnail_url TEXT DEFAULT NULL,
  _made_for_kids BOOLEAN DEFAULT false,
  _embeddable BOOLEAN DEFAULT false,
  _privacy_status TEXT DEFAULT NULL,
  _status TEXT DEFAULT 'unknown',
  _source TEXT DEFAULT 'data_api',
  _ttl_hours INTEGER DEFAULT 24
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id UUID;
BEGIN
  IF _provider IS DISTINCT FROM 'youtube' THEN
    RAISE EXCEPTION 'unsupported provider' USING ERRCODE = '22023';
  END IF;
  IF _media_id IS NULL OR _media_id !~ '^[A-Za-z0-9_-]{11}$' THEN
    RAISE EXCEPTION 'invalid media id' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.media_metadata_cache
    (provider, media_id, title, thumbnail_url, made_for_kids, embeddable,
     privacy_status, status, source, recorded_at, expires_at)
  VALUES (_provider, _media_id, left(btrim(coalesce(_title,'')), 200),
          left(btrim(coalesce(_thumbnail_url,'')), 500), _made_for_kids,
          _embeddable, _privacy_status, _status, _source, now(),
          now() + make_interval(hours => coalesce(_ttl_hours, 24)))
  ON CONFLICT (provider, media_id) DO UPDATE SET
    title = EXCLUDED.title,
    thumbnail_url = EXCLUDED.thumbnail_url,
    made_for_kids = EXCLUDED.made_for_kids,
    embeddable = EXCLUDED.embeddable,
    privacy_status = EXCLUDED.privacy_status,
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    recorded_at = EXCLUDED.recorded_at,
    expires_at = EXCLUDED.expires_at
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_media_metadata_cache(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_media_metadata_cache(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_room_media(
  _room_id UUID,
  _provider TEXT,
  _media_id TEXT,
  _title TEXT DEFAULT NULL,
  _thumbnail_url TEXT DEFAULT NULL,
  _expected_version INTEGER DEFAULT NULL,
  _policy_check_result JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _fail JSONB;
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
     position_seconds, playback_started_at, version, controlled_by, policy_check_result)
  VALUES (_room_id, 'youtube', _media_id, NULL, NULL, 'ready', 0, NULL, 1, _uid,
          _policy_check_result)
  ON CONFLICT (room_id) DO UPDATE SET
    provider = 'youtube',
    provider_media_id = EXCLUDED.provider_media_id,
    title = NULL,
    thumbnail_url = NULL,
    playback_status = 'ready',
    position_seconds = 0,
    playback_started_at = NULL,
    version = s.version + 1,
    controlled_by = _uid,
    policy_check_result = EXCLUDED.policy_check_result;
  PERFORM set_config('app.playback_ctx', '0', true);

  PERFORM public.emit_playback_system_message(_room_id, 'PLAYBACK_MEDIA_CHANGED', 'Video changed.');

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_room_media(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_room_media(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.room_playback_snapshot(_room_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(s) FROM (
    SELECT room_id, provider, provider_media_id, title, thumbnail_url, playback_status,
           position_seconds, playback_started_at, version, controlled_by, updated_at,
           policy_check_result
      FROM public.room_playback_state WHERE room_id = _room_id
  ) s;
$$;

REVOKE EXECUTE ON FUNCTION public.room_playback_snapshot(UUID) FROM PUBLIC, anon, authenticated;