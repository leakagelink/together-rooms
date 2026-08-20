-- Lock down all SECURITY DEFINER / helper functions
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_room_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_room_host(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_moderate_room(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shares_room_with(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_blocked_between(uuid, uuid) FROM PUBLIC, anon;

-- RLS policies evaluate these as the signed-in role, so authenticated must keep EXECUTE
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_room_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_room_host(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_moderate_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_room_with(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_between(uuid, uuid) TO authenticated;

-- Trigger-only functions: nobody may call them directly
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_room_expiry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_room() FROM PUBLIC, anon, authenticated;