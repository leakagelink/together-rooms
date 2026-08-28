-- H2: remove the fully removed voice/video calling surface.
DROP FUNCTION IF EXISTS public.call_block_conflict(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.call_heartbeat(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.call_precheck(uuid, text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.call_snapshot(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.end_call_session(uuid, integer) CASCADE;
DROP FUNCTION IF EXISTS public.ensure_call_settings(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.fetch_call_signals(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.issue_call_transport_grant(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.join_call_session(uuid, boolean, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.leave_call_session(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.post_call_signal(uuid, text, uuid, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.redeem_call_transport_grant(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.set_call_media_state(uuid, boolean, boolean, text) CASCADE;
DROP FUNCTION IF EXISTS public.set_call_settings(uuid, text, boolean, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.start_call_session(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.sweep_calls() CASCADE;
DROP FUNCTION IF EXISTS public.verify_call_grant(uuid, text) CASCADE;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.room_call_sessions;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.room_call_participants;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.call_signals;
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

DROP TABLE IF EXISTS public.call_signals CASCADE;
DROP TABLE IF EXISTS public.call_transport_grants CASCADE;
DROP TABLE IF EXISTS public.room_call_participants CASCADE;
DROP TABLE IF EXISTS public.room_call_settings CASCADE;
DROP TABLE IF EXISTS public.room_call_sessions CASCADE;
DROP FUNCTION IF EXISTS public.guard_call_tables() CASCADE;

DROP TYPE IF EXISTS public.call_connection_state;
DROP TYPE IF EXISTS public.call_session_status;
DROP TYPE IF EXISTS public.call_mode;
DROP TYPE IF EXISTS public.call_admission;

-- H1: defence in depth — signed-out visitors keep read access only where a
-- policy allows it, and never hold write privileges on any public table.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT DISTINCT table_name
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'anon'
      AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES')
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.%I FROM anon',
      t.table_name
    );
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES FROM anon;