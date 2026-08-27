REVOKE ALL ON FUNCTION public.tg_notify_room_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_membership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_playback() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_queue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_task() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_moderation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_entitlement() FROM PUBLIC, anon, authenticated;