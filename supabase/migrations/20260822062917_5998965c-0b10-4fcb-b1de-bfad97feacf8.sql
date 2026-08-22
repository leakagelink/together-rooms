-- Phase 4.1: never persist caller-supplied provider metadata.
-- Title/thumbnail are resolved per-client from the provider's official oEmbed
-- endpoint at render time. The database stores provider + media id only, so a
-- direct RPC call cannot inject misleading "verified" metadata.

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

  -- _title / _thumbnail_url are accepted for call-signature compatibility and
  -- deliberately ignored: caller-supplied metadata is never trusted or stored.
  PERFORM set_config('app.playback_ctx', '1', true);
  INSERT INTO public.room_playback_state AS s
    (room_id, provider, provider_media_id, title, thumbnail_url, playback_status,
     position_seconds, playback_started_at, version, controlled_by)
  VALUES (_room_id, 'youtube', _media_id, NULL, NULL, 'ready', 0, NULL, 1, _uid)
  ON CONFLICT (room_id) DO UPDATE SET
    provider = 'youtube',
    provider_media_id = EXCLUDED.provider_media_id,
    title = NULL,
    thumbnail_url = NULL,
    playback_status = 'ready',
    position_seconds = 0,
    playback_started_at = NULL,
    version = s.version + 1,
    controlled_by = _uid;
  PERFORM set_config('app.playback_ctx', '0', true);

  PERFORM public.emit_playback_system_message(_room_id, 'PLAYBACK_MEDIA_CHANGED', 'Video changed.');

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_room_media(uuid, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_room_media(uuid, text, text, text, text, integer) TO authenticated;

-- Drop metadata captured before this change.
DO $$
BEGIN
  PERFORM set_config('app.playback_ctx', '1', true);
  UPDATE public.room_playback_state
     SET title = NULL, thumbnail_url = NULL
   WHERE title IS NOT NULL OR thumbnail_url IS NOT NULL;
  PERFORM set_config('app.playback_ctx', '0', true);
END $$;