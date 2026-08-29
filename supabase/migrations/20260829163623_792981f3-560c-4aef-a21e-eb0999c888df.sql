CREATE OR REPLACE FUNCTION public.expire_due_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _count integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.rooms
       SET status = 'ended', ended_at = now()
     WHERE status <> 'ended'
       AND expires_at IS NOT NULL
       AND expires_at <= now()
    RETURNING id
  ), logged AS (
    INSERT INTO public.room_events (room_id, actor_id, type, payload)
    SELECT id, NULL, 'ROOM_ENDED', jsonb_build_object('cause', 'expired') FROM expired
    RETURNING 1
  )
  SELECT count(*)::int INTO _count FROM logged;

  RETURN _count;
END; $$;

REVOKE ALL ON FUNCTION public.expire_due_rooms() FROM public, anon, authenticated;
