DROP POLICY IF EXISTS "Service role access to moderation archive" ON public.message_moderation_archive;
CREATE POLICY "Service role access to moderation archive"
  ON public.message_moderation_archive
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);