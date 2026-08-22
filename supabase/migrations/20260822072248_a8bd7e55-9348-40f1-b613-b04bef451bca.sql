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
  _policy_media_id TEXT;
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

  -- Only trust metadata that is embedded inside the signed policy result
  -- and is for the same media id. Caller-supplied _title / _thumbnail_url
  -- are otherwise ignored to prevent spoofing.
  IF _policy_check_result IS NOT NULL THEN
    _policy_media_id := _policy_check_result ->> 'media_id';
    IF _policy_media_id IS NOT NULL AND _policy_media_id = _media_id THEN
      _stored_title := left(btrim(_policy_check_result ->> 'title'), 200);
      _stored_thumb := left(btrim(_policy_check_result ->> 'thumbnail_url'), 500);
      -- Defensive thumbnail host check; should already be canonical from policy.
      IF _stored_thumb IS NOT NULL AND _stored_thumb !~ '^https://i\.ytimg\.com/vi/' THEN
        _stored_thumb := NULL;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  INSERT INTO public.room_playback_state AS s
    (room_id, provider, provider_media_id, title, thumbnail_url, playback_status,
     position_seconds, playback_started_at, version, controlled_by, policy_check_result)
  VALUES (_room_id, 'youtube', _media_id, _stored_title, _stored_thumb, 'ready', 0, NULL, 1, _uid,
          _policy_check_result)
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
