DROP POLICY IF EXISTS "avatars_read_authenticated" ON storage.objects;

CREATE POLICY "avatars_read_owner_or_visible_profile" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = (select auth.uid())::text
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id::text = (storage.foldername(objects.name))[1]
          AND p.avatar_url = 'storage:avatars/' || objects.name
      )
    )
  );