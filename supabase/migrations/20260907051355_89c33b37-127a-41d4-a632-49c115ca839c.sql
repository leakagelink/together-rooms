CREATE OR REPLACE FUNCTION public.delete_room(_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _room_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _room.owner_id <> _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  -- Cascading deletes touch guarded child tables; mark this as a trusted context.
  PERFORM set_config('app.membership_ctx', '1', true);
  PERFORM set_config('app.message_ctx', '1', true);
  PERFORM set_config('app.playback_ctx', '1', true);
  PERFORM set_config('app.queue_ctx', '1', true);
  PERFORM set_config('app.study_ctx', '1', true);
  PERFORM set_config('app.local_media_ctx', '1', true);
  PERFORM set_config('app.room_capacity_write', '1', true);

  DELETE FROM public.rooms WHERE id = _room_id;

  PERFORM set_config('app.membership_ctx', '', true);
  PERFORM set_config('app.message_ctx', '', true);
  PERFORM set_config('app.playback_ctx', '', true);
  PERFORM set_config('app.queue_ctx', '', true);
  PERFORM set_config('app.study_ctx', '', true);
  PERFORM set_config('app.local_media_ctx', '', true);
  PERFORM set_config('app.room_capacity_write', '', true);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'room.deleted', 'room', _room_id,
          jsonb_build_object('name', _room.name, 'type', _room.type));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_room(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_room(uuid) TO authenticated;