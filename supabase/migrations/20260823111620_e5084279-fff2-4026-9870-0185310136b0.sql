-- Realtime with RLS needs the full old/new row to evaluate visibility.
ALTER TABLE public.room_local_media_sessions REPLICA IDENTITY FULL;