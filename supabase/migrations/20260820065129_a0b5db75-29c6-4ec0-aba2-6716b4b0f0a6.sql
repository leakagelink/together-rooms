CREATE OR REPLACE FUNCTION public.authorize_room_channel(_room_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.room_members m
       WHERE m.room_id = _room_id AND m.user_id = auth.uid() AND m.status = 'joined'
    )
    OR public.is_room_host(_room_id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.authorize_room_channel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_room_channel(uuid) TO authenticated;