-- 1. Every room gets a hard 24h lifetime at creation time.
CREATE OR REPLACE FUNCTION public.set_room_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE _cap timestamptz := COALESCE(NEW.created_at, now()) + interval '24 hours';
BEGIN
  IF NEW.expires_at IS NULL OR NEW.expires_at > _cap THEN
    NEW.expires_at := _cap;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS set_room_expiry_before_insert ON public.rooms;
CREATE TRIGGER set_room_expiry_before_insert
BEFORE INSERT ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.set_room_expiry();

-- 2. Sweeper: end every room whose 24 hours are up.
CREATE OR REPLACE FUNCTION public.expire_due_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _ids uuid[];
BEGIN
  UPDATE public.rooms
     SET status = 'ended', ended_at = now()
   WHERE status <> 'ended'
     AND expires_at IS NOT NULL
     AND expires_at <= now()
  RETURNING id INTO _ids;

  SELECT array_agg(id) INTO _ids
    FROM public.rooms
   WHERE status = 'ended' AND ended_at >= now() - interval '1 minute';

  IF _ids IS NOT NULL THEN
    INSERT INTO public.room_events (room_id, actor_id, type, payload)
    SELECT r.id, NULL, 'ROOM_ENDED', jsonb_build_object('cause', 'expired')
      FROM public.rooms r
     WHERE r.id = ANY(_ids)
       AND NOT EXISTS (
         SELECT 1 FROM public.room_events e
          WHERE e.room_id = r.id AND e.type = 'ROOM_ENDED'
            AND e.payload->>'cause' = 'expired');
  END IF;

  RETURN COALESCE(array_length(_ids, 1), 0);
END; $$;

REVOKE ALL ON FUNCTION public.expire_due_rooms() FROM public, anon, authenticated;

-- 3. Backfill existing open rooms and schedule the sweep.
UPDATE public.rooms
   SET expires_at = created_at + interval '24 hours'
 WHERE status <> 'ended'
   AND (expires_at IS NULL OR expires_at > created_at + interval '24 hours');

SELECT cron.unschedule('synctogether-expire-rooms')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'synctogether-expire-rooms');

SELECT cron.schedule('synctogether-expire-rooms', '*/5 * * * *', $cron$SELECT public.expire_due_rooms();$cron$);
