ALTER TABLE public.room_playback_state
  ADD COLUMN IF NOT EXISTS watch_mode text NOT NULL DEFAULT 'video';

ALTER TABLE public.room_playback_state
  DROP CONSTRAINT IF EXISTS room_playback_state_watch_mode_check;
ALTER TABLE public.room_playback_state
  ADD CONSTRAINT room_playback_state_watch_mode_check
  CHECK (watch_mode IN ('video', 'shorts'));

CREATE OR REPLACE FUNCTION public.room_playback_snapshot(_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(s) FROM (
    SELECT room_id, provider, provider_media_id, title, thumbnail_url, playback_status,
           position_seconds, playback_started_at, version, controlled_by, updated_at,
           policy_check_result, watch_mode
      FROM public.room_playback_state WHERE room_id = _room_id
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.set_room_watch_mode(_room_id uuid, _mode text, _expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID := auth.uid();
  _fail JSONB;
BEGIN
  IF _mode IS NULL OR _mode NOT IN ('video', 'shorts') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  _fail := public.playback_precheck(_room_id, _expected_version, 'playback_cmd', 30, 10);
  IF _fail IS NOT NULL THEN RETURN _fail; END IF;

  PERFORM set_config('app.playback_ctx', '1', true);
  INSERT INTO public.room_playback_state AS s (room_id, watch_mode, version, controlled_by)
  VALUES (_room_id, _mode, 1, _uid)
  ON CONFLICT (room_id) DO UPDATE
     SET watch_mode = EXCLUDED.watch_mode,
         version = s.version + 1,
         controlled_by = _uid;
  PERFORM set_config('app.playback_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'state', public.room_playback_snapshot(_room_id));
END; $function$;

REVOKE ALL ON FUNCTION public.set_room_watch_mode(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_room_watch_mode(uuid, text, integer) TO authenticated;