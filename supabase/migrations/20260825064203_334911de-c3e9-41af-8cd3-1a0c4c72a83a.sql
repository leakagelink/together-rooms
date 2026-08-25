-- Trigger-only helper: nothing should be able to call it directly.
REVOKE EXECUTE ON FUNCTION public.guard_room_capacity() FROM anon, authenticated;