-- Trigger functions must never be directly callable from the API.
REVOKE ALL ON FUNCTION public.guard_entitlement_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_room_entitlement_limits() FROM PUBLIC, anon, authenticated;