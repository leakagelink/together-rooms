REVOKE ALL ON public.room_resources FROM anon, authenticated;
REVOKE ALL ON public.room_notes FROM anon, authenticated;
REVOKE ALL ON public.room_note_revisions FROM anon, authenticated;
REVOKE ALL ON public.room_tasks FROM anon, authenticated;
REVOKE ALL ON public.room_focus_timer FROM anon, authenticated;
REVOKE ALL ON public.room_study_settings FROM anon, authenticated;

GRANT SELECT ON public.room_resources TO authenticated;
GRANT SELECT ON public.room_notes TO authenticated;
GRANT SELECT ON public.room_note_revisions TO authenticated;
GRANT SELECT ON public.room_tasks TO authenticated;
GRANT SELECT ON public.room_focus_timer TO authenticated;
GRANT SELECT ON public.room_study_settings TO authenticated;

GRANT ALL ON public.room_resources TO service_role;
GRANT ALL ON public.room_notes TO service_role;
GRANT ALL ON public.room_note_revisions TO service_role;
GRANT ALL ON public.room_tasks TO service_role;
GRANT ALL ON public.room_focus_timer TO service_role;
GRANT ALL ON public.room_study_settings TO service_role;