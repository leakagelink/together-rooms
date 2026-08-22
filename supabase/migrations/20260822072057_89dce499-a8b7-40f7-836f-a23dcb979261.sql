REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.room_playback_state FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.room_playback_state FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.room_playback_state FROM PUBLIC;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.media_metadata_cache FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.media_metadata_cache FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.media_metadata_cache FROM PUBLIC;

GRANT SELECT ON public.media_metadata_cache TO authenticated;
GRANT SELECT ON public.room_playback_state TO authenticated;

GRANT ALL ON public.media_metadata_cache TO service_role;
GRANT ALL ON public.room_playback_state TO service_role;
