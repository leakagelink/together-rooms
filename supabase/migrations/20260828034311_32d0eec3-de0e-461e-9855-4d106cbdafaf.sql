-- PHASE 15 — fail-closed enforcement of account suspensions at the data layer.
-- Content RPCs are SECURITY DEFINER and bypass RLS, so enforcement lives in a
-- trigger on every user-writable content table. Service-role/background work
-- (auth.uid() IS NULL) is intentionally exempt.

CREATE OR REPLACE FUNCTION public.account_is_active(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN true
    ELSE COALESCE(
      (SELECT p.status = 'active' FROM public.profiles p WHERE p.id = _user_id),
      false)
  END;
$$;

REVOKE ALL ON FUNCTION public.account_is_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_is_active(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.deny_suspended_accounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND coalesce(current_setting('app.moderation_ctx', true), '0') <> '1'
     AND NOT public.account_is_active(auth.uid())
  THEN
    RAISE EXCEPTION 'account_suspended' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.deny_suspended_accounts() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'rooms','room_members','room_messages','message_reactions','room_events',
    'room_resources','room_notes','room_note_revisions','room_tasks',
    'room_focus_timer','room_media_queue','room_playback_state','room_queue_settings',
    'room_study_settings','room_invites','room_sessions','playlists','playlist_items',
    'room_local_media_sessions','room_local_media_settings','local_media_signals',
    'local_media_transport_grants','user_reports','user_blocks'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS deny_suspended_%1$s ON public.%1$I', t);
      EXECUTE format(
        'CREATE TRIGGER deny_suspended_%1$s BEFORE INSERT OR UPDATE OR DELETE ON public.%1$I
           FOR EACH ROW EXECUTE FUNCTION public.deny_suspended_accounts()', t);
    END IF;
  END LOOP;
END $$;
