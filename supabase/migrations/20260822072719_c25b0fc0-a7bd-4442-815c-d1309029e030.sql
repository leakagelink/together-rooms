-- Remove the stale 6-parameter overload so PostgREST can resolve the current signature.
DROP FUNCTION IF EXISTS public.set_room_media(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER);

-- The cache is only populated by the server-side Data API resolver. End users
-- must not be able to inject fake policy rows.
REVOKE EXECUTE ON FUNCTION public.upsert_media_metadata_cache(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_media_metadata_cache(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- Enforce the policy from the server-side cache. Direct callers cannot bypass
-- Made for Kids, embeddability, privacy, or TTL checks by omitting or faking
-- the policy result.
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
  _policy public.media_metadata_cache%ROWTYPE;
  _stored_title TEXT;
  _stored_thumb TEXT;
BEGIN
  _fail := public.playback_precheck(_room_id, _expected_version, 'playback_media', 10, 60);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  IF _provider IS DISTINCT FROM 'youtube' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _media_id IS NULL OR _media_id !~ '^[A-Za-z0-9_-]{11}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  -- Authoritative policy lives in the server-side cache. The caller cannot
  -- override it: the supplied _policy_check_result is ignored.
  SELECT * INTO _policy
    FROM public.media_metadata_cache
   WHERE provider = 'youtube' AND media_id = _media_id
   ORDER BY recorded_at DESC
   LIMIT 1;

  IF NOT FOUND OR _policy.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  IF _policy.status <> 'ok' OR _policy.made_for_kids OR NOT _policy.embeddable THEN
    RETURN jsonb_build_object('ok', false, 'reason', _policy.status);
  END IF;

  _stored_title := left(btrim(_policy.title), 200);
  _stored_thumb := left(btrim(_policy.thumbnail_url), 500);
  IF _stored_thumb IS NOT NULL AND _stored_thumb !~ '^https://i\.ytimg\.com/vi/' THEN
    _stored_thumb := NULL;
  END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  INSERT INTO public.room_playback_state AS s
    (room_id, provider, provider_media_id, title, thumbnail_url, playback_status,
     position_seconds, playback_started_at, version, controlled_by, policy_check_result)
  VALUES (_room_id, 'youtube', _media_id, _stored_title, _stored_thumb, 'ready', 0, NULL, 1, _uid,
          jsonb_build_object(
            'provider', 'youtube',
            'media_id', _media_id,
            'status', _policy.status,
            'made_for_kids', _policy.made_for_kids,
            'embeddable', _policy.embeddable,
            'privacy_status', _policy.privacy_status,
            'title', _stored_title,
            'thumbnail_url', _stored_thumb,
            'checked_at', now()::text
          ))
  ON CONFLICT (room_id) DO UPDATE SET
    provider = 'youtube',
    provider_media_id = EXCLUDED.provider_media_id,
    title = EXCLUDED.title,
    thumbnail_url = EXCLUDED.thumbnail_url,
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
