REVOKE ALL ON public.room_media_queue FROM anon, authenticated;
REVOKE ALL ON public.room_queue_settings FROM anon, authenticated;
REVOKE ALL ON public.playlists FROM anon, authenticated;
REVOKE ALL ON public.playlist_items FROM anon, authenticated;

GRANT SELECT ON public.room_media_queue TO authenticated;
GRANT SELECT ON public.room_queue_settings TO authenticated;
GRANT SELECT ON public.playlists TO authenticated;
GRANT SELECT ON public.playlist_items TO authenticated;

GRANT ALL ON public.room_media_queue TO service_role;
GRANT ALL ON public.room_queue_settings TO service_role;
GRANT ALL ON public.playlists TO service_role;
GRANT ALL ON public.playlist_items TO service_role;