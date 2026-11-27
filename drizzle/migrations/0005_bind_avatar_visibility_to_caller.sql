CREATE OR REPLACE FUNCTION public.can_view_profile_avatar(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id::text = split_part(_name, '/', 1)
      AND p.avatar_url = 'storage:avatars/' || _name
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_profile_avatar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_profile_avatar(text) TO authenticated;

ALTER POLICY "avatars_read_owner_or_visible_profile" ON storage.objects
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_view_profile_avatar(name)
  )
);