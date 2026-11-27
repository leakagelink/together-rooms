-- These three configuration/cache tables are read only by server-side code
-- (service role) and SECURITY DEFINER functions. End users have no table
-- grants on them, so the blanket USING (true) read policies are removed to
-- keep them default-deny for every app user.
DROP POLICY IF EXISTS "ad_config_select" ON public.ad_config;
DROP POLICY IF EXISTS "Authenticated read media cache" ON public.media_metadata_cache;
DROP POLICY IF EXISTS "plan_limits_select" ON public.plan_limits;

REVOKE ALL ON public.ad_config FROM anon, authenticated;
REVOKE ALL ON public.media_metadata_cache FROM anon, authenticated;
REVOKE ALL ON public.plan_limits FROM anon, authenticated;