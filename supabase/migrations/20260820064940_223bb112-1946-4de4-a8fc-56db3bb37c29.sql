-- 1. Correct volatility: room_is_joinable() calls now(), so it is STABLE, not IMMUTABLE.
CREATE OR REPLACE FUNCTION public.room_is_joinable(_room public.rooms)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _room.status IN ('ended','archived') THEN 'room_ended'
    WHEN _room.status = 'draft' THEN 'room_not_open'
    WHEN _room.expires_at IS NOT NULL AND _room.expires_at <= now() THEN 'room_expired'
    ELSE 'ok'
  END;
$$;

-- 2. Membership guard trigger: only the room engine (SECURITY DEFINER RPCs that
--    set app.membership_ctx) may create/remove memberships or touch privileged
--    columns. Moderators may toggle is_muted only.
CREATE OR REPLACE FUNCTION public.guard_room_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _engine BOOLEAN := coalesce(current_setting('app.membership_ctx', true), '') = '1';
BEGIN
  IF _engine OR auth.uid() IS NULL THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'membership_insert_forbidden' USING ERRCODE = '42501';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'membership_delete_forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_moderate_room(OLD.room_id, auth.uid()) THEN
    RAISE EXCEPTION 'membership_update_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Freeze every privilege-bearing column; only is_muted may change.
  NEW.id := OLD.id;
  NEW.room_id := OLD.room_id;
  NEW.user_id := OLD.user_id;
  NEW.role := OLD.role;
  NEW.status := OLD.status;
  NEW.can_invite := OLD.can_invite;
  NEW.can_moderate := OLD.can_moderate;
  NEW.can_control_playback := OLD.can_control_playback;
  NEW.joined_at := OLD.joined_at;
  NEW.left_at := OLD.left_at;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_room_members_guard ON public.room_members;
CREATE TRIGGER trg_room_members_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.room_members
FOR EACH ROW EXECUTE FUNCTION public.guard_room_members();

-- 3. Room engine flag inside every authorized membership path.
CREATE OR REPLACE FUNCTION public.handle_new_room()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('app.membership_ctx', '1', true);
  INSERT INTO public.room_members (room_id, user_id, role, status, can_invite, can_moderate, can_control_playback)
  VALUES (NEW.id, NEW.owner_id, 'host', 'joined', true, true, true)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (NEW.id, NEW.owner_id, 'ROOM_CREATED', jsonb_build_object('type', NEW.type, 'privacy', NEW.privacy));
  PERFORM set_config('app.membership_ctx', '0', true);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.admit_member(_room public.rooms, _uid uuid, _via text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _reason TEXT;
  _existing public.room_members%ROWTYPE;
  _joined INTEGER;
BEGIN
  _reason := public.room_is_joinable(_room);
  IF _reason <> 'ok' THEN RETURN jsonb_build_object('ok', false, 'reason', _reason); END IF;

  SELECT * INTO _existing FROM public.room_members
   WHERE room_id = _room.id AND user_id = _uid FOR UPDATE;

  IF FOUND AND _existing.status = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF FOUND AND _existing.status = 'joined' THEN
    RETURN jsonb_build_object('ok', true, 'room_id', _room.id, 'already_member', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_members m
     WHERE m.room_id = _room.id AND m.status = 'joined' AND m.user_id <> _uid
       AND public.is_blocked_between(m.user_id, _uid)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT count(*) INTO _joined FROM public.room_members
   WHERE room_id = _room.id AND status = 'joined';
  IF _joined >= _room.max_members THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_full');
  END IF;

  PERFORM set_config('app.membership_ctx', '1', true);
  INSERT INTO public.room_members (room_id, user_id, role, status, joined_at, left_at)
  VALUES (_room.id, _uid, 'member', 'joined', now(), NULL)
  ON CONFLICT (room_id, user_id) DO UPDATE
    SET status = 'joined', role = 'member', joined_at = now(), left_at = NULL;
  PERFORM set_config('app.membership_ctx', '0', true);

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room.id, _uid, 'USER_JOINED', jsonb_build_object('via', _via));

  RETURN jsonb_build_object('ok', true, 'room_id', _room.id, 'already_member', false);
END; $$;

CREATE OR REPLACE FUNCTION public.leave_room(_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _was_host BOOLEAN;
  _successor UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.room_members
                  WHERE room_id = _room_id AND user_id = _uid AND status = 'joined') THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'not_a_member');
  END IF;

  _was_host := (_room.owner_id = _uid) OR (_room.host_id = _uid)
    OR EXISTS (SELECT 1 FROM public.room_members
                WHERE room_id = _room_id AND user_id = _uid AND role = 'host' AND status = 'joined');

  PERFORM set_config('app.membership_ctx', '1', true);
  UPDATE public.room_members
     SET status = 'left', left_at = now(), role = 'member',
         can_invite = false, can_moderate = false, can_control_playback = false
   WHERE room_id = _room_id AND user_id = _uid;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room_id, _uid, 'USER_LEFT', '{}'::jsonb);

  IF NOT _was_host THEN
    PERFORM set_config('app.membership_ctx', '0', true);
    RETURN jsonb_build_object('ok', true, 'outcome', 'left');
  END IF;

  _successor := public.pick_room_successor(_room_id, _uid);

  IF _successor IS NULL THEN
    UPDATE public.rooms SET status = 'ended', ended_at = now(), host_id = NULL
     WHERE id = _room_id;
    INSERT INTO public.room_events (room_id, actor_id, type, payload)
    VALUES (_room_id, _uid, 'ROOM_ENDED', jsonb_build_object('cause', 'host_left_no_successor'));
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (_uid, 'room.ended', 'room', _room_id, jsonb_build_object('cause', 'host_left_no_successor'));
    PERFORM set_config('app.membership_ctx', '0', true);
    RETURN jsonb_build_object('ok', true, 'outcome', 'room_ended');
  END IF;

  UPDATE public.rooms SET owner_id = _successor, host_id = _successor WHERE id = _room_id;
  UPDATE public.room_members
     SET role = 'host', can_invite = true, can_moderate = true, can_control_playback = true
   WHERE room_id = _room_id AND user_id = _successor;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room_id, _uid, 'HOST_CHANGED', jsonb_build_object('cause', 'host_left'));
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'room.host_transferred', 'room', _room_id,
          jsonb_build_object('cause', 'host_left', 'to', _successor));
  PERFORM set_config('app.membership_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'outcome', 'host_transferred');
END; $$;

CREATE OR REPLACE FUNCTION public.transfer_room_host(_room_id uuid, _to_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _current UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.is_room_host(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members
                  WHERE room_id = _room_id AND user_id = _to_user AND status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT owner_id INTO _current FROM public.rooms WHERE id = _room_id FOR UPDATE;

  PERFORM set_config('app.membership_ctx', '1', true);
  UPDATE public.rooms SET owner_id = _to_user, host_id = _to_user WHERE id = _room_id;
  UPDATE public.room_members
     SET role = 'host', can_invite = true, can_moderate = true, can_control_playback = true
   WHERE room_id = _room_id AND user_id = _to_user;
  UPDATE public.room_members SET role = 'member'
   WHERE room_id = _room_id AND user_id = _current AND user_id <> _to_user;
  PERFORM set_config('app.membership_ctx', '0', true);

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room_id, _uid, 'HOST_CHANGED', jsonb_build_object('cause', 'manual'));
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'room.host_transferred', 'room', _room_id,
          jsonb_build_object('cause', 'manual', 'to', _to_user));

  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.purge_user_data(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _room RECORD; _successor UUID;
BEGIN
  PERFORM set_config('app.membership_ctx', '1', true);
  FOR _room IN SELECT id FROM public.rooms WHERE owner_id = _user_id OR host_id = _user_id LOOP
    _successor := public.pick_room_successor(_room.id, _user_id);
    IF _successor IS NULL THEN
      UPDATE public.rooms SET status = 'ended', ended_at = now(), host_id = NULL WHERE id = _room.id;
    ELSE
      UPDATE public.rooms SET owner_id = _successor, host_id = _successor WHERE id = _room.id;
      UPDATE public.room_members SET role = 'host', can_invite = true, can_moderate = true,
             can_control_playback = true
       WHERE room_id = _room.id AND user_id = _successor;
      INSERT INTO public.room_events (room_id, actor_id, type, payload)
      VALUES (_room.id, NULL, 'HOST_CHANGED', jsonb_build_object('cause', 'account_deleted'));
    END IF;
  END LOOP;

  UPDATE public.room_members SET status = 'left', left_at = now()
   WHERE user_id = _user_id AND status <> 'left';
  PERFORM set_config('app.membership_ctx', '0', true);

  DELETE FROM public.analytics_events WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;
  DELETE FROM public.device_sessions WHERE user_id = _user_id;
  DELETE FROM public.user_blocks WHERE blocker_id = _user_id OR blocked_id = _user_id;
  DELETE FROM public.rate_limits WHERE user_id = _user_id;

  UPDATE public.profiles
     SET status = 'deleted', display_name = 'Deleted user', username = NULL,
         avatar_url = NULL, bio = NULL
   WHERE id = _user_id;

  RETURN jsonb_build_object('ok', true);
END; $$;

-- 4. RLS: remove self-service INSERT/DELETE; UPDATE limited to moderators/hosts.
DROP POLICY IF EXISTS room_members_insert ON public.room_members;
DROP POLICY IF EXISTS room_members_delete ON public.room_members;
DROP POLICY IF EXISTS room_members_update ON public.room_members;

CREATE POLICY room_members_update_moderator ON public.room_members
  FOR UPDATE TO authenticated
  USING (public.can_moderate_room(room_id, auth.uid()))
  WITH CHECK (public.can_moderate_room(room_id, auth.uid()));

-- 5. Grants: least privilege. No INSERT/DELETE for app users; UPDATE only on is_muted.
REVOKE ALL ON public.room_members FROM anon;
REVOKE ALL ON public.room_members FROM authenticated;
GRANT SELECT ON public.room_members TO authenticated;
GRANT UPDATE (is_muted, updated_at) ON public.room_members TO authenticated;
GRANT ALL ON public.room_members TO service_role;

REVOKE ALL ON public.rooms FROM anon;
REVOKE ALL ON public.room_invites FROM anon;
REVOKE ALL ON public.room_events FROM anon;