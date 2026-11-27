-- Run with psql -v ON_ERROR_STOP=1 against the database.
-- A failed assertion raises division by zero.
SELECT 1 / CASE WHEN NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
    AND tablename = 'objects' AND policyname = 'avatars_read_authenticated'
) THEN 1 ELSE 0 END AS unrestricted_photo_read_removed;

SELECT 1 / CASE WHEN NOT has_function_privilege(
  'anon', 'public.can_view_profile_avatar(text)', 'EXECUTE'
) THEN 1 ELSE 0 END AS anonymous_visibility_check_denied;

SELECT 1 / CASE WHEN has_function_privilege(
  'authenticated', 'public.can_view_profile_avatar(text)', 'EXECUTE'
) THEN 1 ELSE 0 END AS signed_in_visibility_check_allowed;

SELECT 1 / CASE WHEN NOT prosecdef THEN 1 ELSE 0 END
  AS visibility_check_preserves_profile_permissions
FROM pg_proc WHERE oid = 'public.can_view_profile_avatar(text)'::regprocedure;