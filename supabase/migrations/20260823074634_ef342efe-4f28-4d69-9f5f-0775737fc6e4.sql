
REVOKE EXECUTE ON FUNCTION public.can_control_study(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_study_settings(uuid, text, text, text, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_room_resource(uuid, text, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_room_resource(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_resource_status(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_resource_pinned(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.remove_room_resource(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_focused_resource(uuid, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_room_note(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_room_note(uuid, integer, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_room_note(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_room_task(uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_room_task(uuid, text, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_room_task(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.control_focus_timer(uuid, text, text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.study_session_summary(uuid) FROM anon;
