REVOKE EXECUTE ON FUNCTION public.can_manage_queue(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_queue(UUID, UUID) TO authenticated, service_role;