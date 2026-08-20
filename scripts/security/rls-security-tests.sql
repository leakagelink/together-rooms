-- Phase 2.1 database security tests. Runs inside a transaction and rolls back.
-- Executed with: psql "$SUPABASE_DB_URL" -f scripts/security/rls-security-tests.sql
\set ON_ERROR_STOP off
\timing off
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END; $$;

CREATE OR REPLACE FUNCTION pg_temp.as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END; $$;

CREATE TEMP TABLE results(name text, passed boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.record(_name text, _passed boolean, _detail text DEFAULT '')
RETURNS void LANGUAGE sql AS $$ INSERT INTO results VALUES (_name, _passed, _detail); $$;

DO $outer$
DECLARE
  host_id UUID := gen_random_uuid();
  member_id UUID := gen_random_uuid();
  outsider_id UUID := gen_random_uuid();
  room_id UUID;
  ended_room UUID;
  code TEXT := 'TSTCODE1';
  ended_code TEXT := 'TSTCODE2';
  res JSONB;
  ok BOOLEAN;
  tok TEXT := repeat('a', 64);
  invite JSONB;
BEGIN
  -- seed auth users (triggers profile/role/settings bootstrap)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u::text || '@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM unnest(ARRAY[host_id, member_id, outsider_id]) u;

  -- host creates a room (authorized path)
  PERFORM pg_temp.act_as(host_id);
  INSERT INTO public.rooms (owner_id, host_id, name, type, status, privacy, max_members, join_code)
  VALUES (host_id, host_id, 'Test room', 'friends', 'active', 'private', 2, code)
  RETURNING id INTO room_id;
  PERFORM pg_temp.record('T0 room creation seeds host membership',
    EXISTS (SELECT 1 FROM public.room_members WHERE room_id = room_id AND user_id = host_id AND role='host'));

  -- TEST 1: non-member direct INSERT
  PERFORM pg_temp.act_as(outsider_id);
  BEGIN
    INSERT INTO public.room_members (room_id, user_id, role, status)
    VALUES (room_id, outsider_id, 'member', 'joined');
    PERFORM pg_temp.record('T1 non-member direct INSERT blocked', false, 'insert succeeded');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record('T1 non-member direct INSERT blocked', true, SQLERRM);
  END;

  -- TEST 7: join_room_by_code succeeds for a joinable room
  PERFORM pg_temp.act_as(member_id);
  res := public.join_room_by_code(code);
  PERFORM pg_temp.record('T7 join_room_by_code succeeds', (res->>'ok')::boolean, res::text);

  -- TEST 8: direct insert fails while RPC succeeds
  PERFORM pg_temp.act_as(outsider_id);
  BEGIN
    INSERT INTO public.room_members (room_id, user_id, role, status, can_moderate)
    VALUES (room_id, outsider_id, 'host', 'joined', true);
    PERFORM pg_temp.record('T8 direct insert vs RPC', false, 'arbitrary insert succeeded');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record('T8 direct insert vs RPC', true, SQLERRM);
  END;

  -- TEST 9: capacity cannot be exceeded (max_members = 2, host + member already joined)
  res := public.join_room_by_code(code);
  PERFORM pg_temp.record('T9 capacity enforced',
    (res->>'ok')::boolean IS FALSE AND res->>'reason' = 'room_full', res::text);

  -- TESTS 2-5: member cannot escalate own privileges
  PERFORM pg_temp.act_as(member_id);
  BEGIN
    UPDATE public.room_members SET role = 'host' WHERE room_id = room_id AND user_id = member_id;
    PERFORM pg_temp.record('T2 member cannot promote own role',
      NOT EXISTS (SELECT 1 FROM public.room_members WHERE room_id=room_id AND user_id=member_id AND role='host'),
      'update did not raise');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record('T2 member cannot promote own role', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.room_members SET can_moderate = true WHERE room_id = room_id AND user_id = member_id;
    PERFORM pg_temp.record('T3 member cannot enable can_moderate',
      NOT (SELECT can_moderate FROM public.room_members WHERE room_id=room_id AND user_id=member_id),
      'update did not raise');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record('T3 member cannot enable can_moderate', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.room_members SET can_invite = true WHERE room_id = room_id AND user_id = member_id;
    PERFORM pg_temp.record('T4 member cannot enable can_invite',
      NOT (SELECT can_invite FROM public.room_members WHERE room_id=room_id AND user_id=member_id),
      'update did not raise');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record('T4 member cannot enable can_invite', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.room_members SET can_control_playback = true WHERE room_id = room_id AND user_id = member_id;
    PERFORM pg_temp.record('T5 member cannot enable can_control_playback',
      NOT (SELECT can_control_playback FROM public.room_members WHERE room_id=room_id AND user_id=member_id),
      'update did not raise');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record('T5 member cannot enable can_control_playback', true, SQLERRM);
  END;

  -- TEST 6: member cannot DELETE membership / cannot self-write status
  BEGIN
    DELETE FROM public.room_members WHERE room_id = room_id AND user_id = member_id;
    PERFORM pg_temp.record('T6 member cannot delete membership',
      EXISTS (SELECT 1 FROM public.room_members WHERE room_id=room_id AND user_id=member_id),
      'delete did not raise');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record('T6 member cannot delete membership', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.room_members SET status = 'left' WHERE room_id = room_id AND user_id = member_id;
    PERFORM pg_temp.record('T6b member cannot self-write status',
      (SELECT status FROM public.room_members WHERE room_id=room_id AND user_id=member_id) = 'joined',
      'update did not raise');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record('T6b member cannot self-write status', true, SQLERRM);
  END;

  -- TEST 12: non-member cannot authorize private realtime access
  PERFORM pg_temp.act_as(outsider_id);
  PERFORM pg_temp.record('T12a non-member realtime authorization denied',
    public.authorize_room_channel(room_id) IS FALSE);
  PERFORM pg_temp.act_as(member_id);
  PERFORM pg_temp.record('T12b member realtime authorization granted',
    public.authorize_room_channel(room_id) IS TRUE);

  -- TEST 10: ended room cannot be joined
  PERFORM pg_temp.act_as(host_id);
  INSERT INTO public.rooms (owner_id, host_id, name, type, status, privacy, max_members, join_code)
  VALUES (host_id, host_id, 'Ended room', 'friends', 'ended', 'private', 10, ended_code)
  RETURNING id INTO ended_room;
  PERFORM pg_temp.act_as(outsider_id);
  res := public.join_room_by_code(ended_code);
  PERFORM pg_temp.record('T10 ended room rejected',
    (res->>'ok')::boolean IS FALSE AND res->>'reason' = 'room_ended', res::text);

  -- expired room rejection
  PERFORM pg_temp.as_postgres();
  UPDATE public.rooms SET status='active', expires_at = now() - interval '1 hour' WHERE id = ended_room;
  PERFORM pg_temp.act_as(outsider_id);
  res := public.join_room_by_code(ended_code);
  PERFORM pg_temp.record('T10b expired room rejected',
    (res->>'ok')::boolean IS FALSE AND res->>'reason' = 'room_expired', res::text);

  -- TEST 11: single-use invite cannot be redeemed twice
  PERFORM pg_temp.as_postgres();
  UPDATE public.rooms SET expires_at = NULL, max_members = 10 WHERE id = ended_room;
  PERFORM pg_temp.act_as(host_id);
  invite := public.create_room_invite(ended_room, tok, 1, 24);
  PERFORM pg_temp.record('T11a invite created', (invite->>'ok')::boolean, invite::text);
  PERFORM pg_temp.act_as(outsider_id);
  res := public.redeem_room_invite(tok);
  PERFORM pg_temp.record('T11b first redemption succeeds', (res->>'ok')::boolean, res::text);
  PERFORM pg_temp.act_as(member_id);
  res := public.redeem_room_invite(tok);
  PERFORM pg_temp.record('T11c second redemption rejected',
    (res->>'ok')::boolean IS FALSE AND res->>'reason' = 'invalid_invite', res::text);

  -- leave_room lifecycle: host leaves with a member -> deterministic successor
  PERFORM pg_temp.act_as(host_id);
  res := public.leave_room(room_id);
  PERFORM pg_temp.record('T13 host leave transfers host',
    res->>'outcome' = 'host_transferred'
    AND (SELECT owner_id FROM public.rooms WHERE id = room_id) = member_id, res::text);
  PERFORM pg_temp.act_as(member_id);
  res := public.leave_room(room_id);
  PERFORM pg_temp.record('T14 last host leave ends room',
    res->>'outcome' = 'room_ended'
    AND (SELECT status FROM public.rooms WHERE id = room_id) = 'ended', res::text);

  PERFORM pg_temp.as_postgres();
END $outer$;

\echo '--- PHASE 2.1 DATABASE SECURITY TEST RESULTS ---'
SELECT CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status, name, left(detail, 90) AS detail FROM results;
SELECT count(*) FILTER (WHERE passed) AS passed, count(*) FILTER (WHERE NOT passed) AS failed FROM results;

ROLLBACK;
