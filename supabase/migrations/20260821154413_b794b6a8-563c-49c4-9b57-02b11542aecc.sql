-- ============================================================
-- PHASE 3: Secure room chat, reactions, moderation foundation
-- ============================================================

CREATE TYPE public.message_content_type AS ENUM ('text','system');
CREATE TYPE public.message_status AS ENUM ('active','deleted','moderated');
CREATE TYPE public.message_reaction AS ENUM ('thumbs_up','heart','joy','wow','sad','fire');
CREATE TYPE public.chat_retention AS ENUM ('persistent','room_expiry','24h','7d');

ALTER TABLE public.rooms
  ADD COLUMN chat_retention public.chat_retention NOT NULL DEFAULT 'persistent';

-- ------------------------------------------------------------
-- room_messages
-- ------------------------------------------------------------
CREATE TABLE public.room_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_message_id UUID REFERENCES public.room_messages(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  content_type public.message_content_type NOT NULL DEFAULT 'text',
  status public.message_status NOT NULL DEFAULT 'active',
  system_code TEXT,
  original_content TEXT,
  moderated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT room_messages_len CHECK (char_length(content) <= 2000),
  CONSTRAINT room_messages_sender_required
    CHECK ((content_type = 'system' AND sender_id IS NULL) OR content_type <> 'system'),
  CONSTRAINT room_messages_active_not_empty
    CHECK (status <> 'active' OR char_length(btrim(content)) > 0),
  CONSTRAINT room_messages_no_self_parent CHECK (parent_message_id IS NULL OR parent_message_id <> id)
);

CREATE INDEX idx_room_messages_room_created ON public.room_messages(room_id, created_at DESC, id DESC);
CREATE INDEX idx_room_messages_sender ON public.room_messages(sender_id);
CREATE INDEX idx_room_messages_parent ON public.room_messages(parent_message_id);

-- Column-level SELECT: original_content is moderation-only and never granted to app users.
GRANT SELECT (id, room_id, sender_id, parent_message_id, content, content_type, status,
              system_code, moderated_at, edited_at, deleted_at, created_at, updated_at)
  ON public.room_messages TO authenticated;
GRANT ALL ON public.room_messages TO service_role;
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY room_messages_select_member ON public.room_messages FOR SELECT TO authenticated
USING (public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid()));

-- Documented intent: only active, unmuted members may create messages as themselves.
-- Direct PostgREST writes are additionally revoked and blocked by the guard trigger,
-- so this policy is defense in depth rather than the sole control.
CREATE POLICY room_messages_insert_member ON public.room_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND content_type = 'text'
  AND EXISTS (
    SELECT 1 FROM public.room_members m
     WHERE m.room_id = room_messages.room_id AND m.user_id = auth.uid()
       AND m.status = 'joined' AND m.is_muted = false
  )
);

CREATE POLICY room_messages_update_own ON public.room_messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid() AND status = 'active')
WITH CHECK (sender_id = auth.uid());

-- ------------------------------------------------------------
-- message_reactions
-- ------------------------------------------------------------
CREATE TABLE public.message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.room_messages(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction public.message_reaction NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX idx_message_reactions_message ON public.message_reactions(message_id);
CREATE INDEX idx_message_reactions_room ON public.message_reactions(room_id);

GRANT SELECT ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_reactions_select_member ON public.message_reactions FOR SELECT TO authenticated
USING (public.is_room_member(room_id, auth.uid()) OR public.is_room_host(room_id, auth.uid()));

-- ------------------------------------------------------------
-- Guard triggers: all writes must originate from the chat engine
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_room_messages()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _engine BOOLEAN := coalesce(current_setting('app.message_ctx', true), '') = '1';
BEGIN
  IF _engine OR auth.uid() IS NULL THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'message_write_forbidden' USING ERRCODE = '42501';
END; $$;
REVOKE ALL ON FUNCTION public.guard_room_messages() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_room_messages_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.room_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_room_messages();

CREATE OR REPLACE FUNCTION public.guard_message_reactions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _engine BOOLEAN := coalesce(current_setting('app.message_ctx', true), '') = '1';
BEGIN
  IF _engine OR auth.uid() IS NULL THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'reaction_write_forbidden' USING ERRCODE = '42501';
END; $$;
REVOKE ALL ON FUNCTION public.guard_message_reactions() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_message_reactions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_reactions();

CREATE TRIGGER trg_room_messages_updated_at
  BEFORE UPDATE ON public.room_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- System messages: generated from the trusted room_events stream
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_system_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.type NOT IN ('USER_JOINED','USER_LEFT','HOST_CHANGED','ROOM_ENDED') THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.message_ctx', '1', true);
  INSERT INTO public.room_messages (room_id, sender_id, content, content_type, system_code)
  VALUES (NEW.room_id, NULL, NEW.type::text, 'system', NEW.type::text);
  PERFORM set_config('app.message_ctx', '0', true);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.emit_system_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_room_events_system_message
  AFTER INSERT ON public.room_events
  FOR EACH ROW EXECUTE FUNCTION public.emit_system_message();

-- ------------------------------------------------------------
-- Chat engine RPCs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_room_message(
  _room_id uuid, _content text, _parent_message_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _member public.room_members%ROWTYPE;
  _text TEXT := btrim(coalesce(_content, ''));
  _reason TEXT;
  _id UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF char_length(_text) = 0 OR char_length(_text) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _room_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  SELECT * INTO _member FROM public.room_members
   WHERE room_id = _room_id AND user_id = _uid AND status = 'joined';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;

  _reason := public.room_is_joinable(_room);
  IF _reason <> 'ok' THEN RETURN jsonb_build_object('ok', false, 'reason', _reason); END IF;

  IF _member.is_muted THEN RETURN jsonb_build_object('ok', false, 'reason', 'muted'); END IF;

  IF NOT public.consume_rate_limit('chat_send', 15, 20) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  IF _parent_message_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.room_messages
                    WHERE id = _parent_message_id AND room_id = _room_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.room_messages
     WHERE room_id = _room_id AND sender_id = _uid AND status = 'active'
       AND content = _text AND created_at > now() - interval '30 seconds'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_message');
  END IF;

  PERFORM set_config('app.message_ctx', '1', true);
  INSERT INTO public.room_messages (room_id, sender_id, parent_message_id, content, content_type)
  VALUES (_room_id, _uid, _parent_message_id, _text, 'text')
  RETURNING id INTO _id;
  PERFORM set_config('app.message_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'message_id', _id);
END; $$;

CREATE OR REPLACE FUNCTION public.edit_room_message(_message_id uuid, _content text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _msg public.room_messages%ROWTYPE;
  _text TEXT := btrim(coalesce(_content, ''));
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF char_length(_text) = 0 OR char_length(_text) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO _msg FROM public.room_messages WHERE id = _message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _msg.sender_id IS DISTINCT FROM _uid OR _msg.content_type <> 'text' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _msg.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'message_not_editable');
  END IF;
  IF _msg.created_at < now() - interval '15 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'edit_window_expired');
  END IF;
  IF NOT public.consume_rate_limit('chat_edit', 20, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  PERFORM set_config('app.message_ctx', '1', true);
  UPDATE public.room_messages SET content = _text, edited_at = now() WHERE id = _message_id;
  PERFORM set_config('app.message_ctx', '0', true);

  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.delete_room_message(_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _msg public.room_messages%ROWTYPE;
  _is_mod BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  SELECT * INTO _msg FROM public.room_messages WHERE id = _message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _msg.status <> 'active' THEN RETURN jsonb_build_object('ok', true, 'outcome', 'already_removed'); END IF;

  _is_mod := public.can_moderate_room(_msg.room_id, _uid) OR public.is_room_host(_msg.room_id, _uid);

  IF _msg.sender_id IS DISTINCT FROM _uid AND NOT _is_mod THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _msg.content_type = 'system' AND NOT _is_mod THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  PERFORM set_config('app.message_ctx', '1', true);
  IF _msg.sender_id IS NOT DISTINCT FROM _uid THEN
    UPDATE public.room_messages
       SET status = 'deleted', deleted_at = now(),
           original_content = coalesce(original_content, content), content = ''
     WHERE id = _message_id;
  ELSE
    UPDATE public.room_messages
       SET status = 'moderated', deleted_at = now(), moderated_by = _uid, moderated_at = now(),
           original_content = coalesce(original_content, content), content = ''
     WHERE id = _message_id;
    INSERT INTO public.moderation_actions (actor_id, target_user_id, room_id, action, reason)
    VALUES (_uid, _msg.sender_id, _msg.room_id, 'content_removed', 'message removed by room moderator');
  END IF;
  PERFORM set_config('app.message_ctx', '0', true);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'message.removed', 'room_message', _message_id,
          jsonb_build_object('room_id', _msg.room_id, 'moderator', _is_mod AND _msg.sender_id IS DISTINCT FROM _uid));

  RETURN jsonb_build_object('ok', true, 'outcome', 'removed');
END; $$;

CREATE OR REPLACE FUNCTION public.toggle_message_reaction(_message_id uuid, _reaction text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _msg public.room_messages%ROWTYPE;
  _room public.rooms%ROWTYPE;
  _member public.room_members%ROWTYPE;
  _r public.message_reaction;
  _existing public.message_reactions%ROWTYPE;
  _lifecycle TEXT;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  BEGIN
    _r := _reaction::public.message_reaction;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END;

  SELECT * INTO _msg FROM public.room_messages WHERE id = _message_id;
  IF NOT FOUND OR _msg.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO _member FROM public.room_members
   WHERE room_id = _msg.room_id AND user_id = _uid AND status = 'joined';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  IF _member.is_muted THEN RETURN jsonb_build_object('ok', false, 'reason', 'muted'); END IF;

  SELECT * INTO _room FROM public.rooms WHERE id = _msg.room_id;
  _lifecycle := public.room_is_joinable(_room);
  IF _lifecycle <> 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'reason', _lifecycle);
  END IF;

  IF NOT public.consume_rate_limit('chat_react', 30, 60) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT * INTO _existing FROM public.message_reactions
   WHERE message_id = _message_id AND user_id = _uid FOR UPDATE;

  PERFORM set_config('app.message_ctx', '1', true);
  IF FOUND AND _existing.reaction = _r THEN
    DELETE FROM public.message_reactions WHERE id = _existing.id;
    PERFORM set_config('app.message_ctx', '0', true);
    RETURN jsonb_build_object('ok', true, 'outcome', 'removed');
  ELSIF FOUND THEN
    UPDATE public.message_reactions SET reaction = _r, created_at = now() WHERE id = _existing.id;
  ELSE
    INSERT INTO public.message_reactions (message_id, room_id, user_id, reaction)
    VALUES (_message_id, _msg.room_id, _uid, _r);
  END IF;
  PERFORM set_config('app.message_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'outcome', 'set');
END; $$;

CREATE OR REPLACE FUNCTION public.set_member_mute(_room_id uuid, _user_id uuid, _muted boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _target public.room_members%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT (public.can_moderate_room(_room_id, _uid) OR public.is_room_host(_room_id, _uid)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _user_id = _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request'); END IF;

  SELECT * INTO _target FROM public.room_members
   WHERE room_id = _room_id AND user_id = _user_id AND status = 'joined' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _target.role = 'host' OR public.is_room_host(_room_id, _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  PERFORM set_config('app.membership_ctx', '1', true);
  UPDATE public.room_members SET is_muted = _muted
   WHERE room_id = _room_id AND user_id = _user_id;
  PERFORM set_config('app.membership_ctx', '0', true);

  INSERT INTO public.moderation_actions (actor_id, target_user_id, room_id, action, reason)
  VALUES (_uid, _user_id, _room_id, 'mute', CASE WHEN _muted THEN 'muted in room' ELSE 'unmuted in room' END);

  RETURN jsonb_build_object('ok', true, 'muted', _muted);
END; $$;

-- ------------------------------------------------------------
-- Message reporting (extends the existing report architecture)
-- ------------------------------------------------------------
ALTER TABLE public.user_reports
  ADD COLUMN target_message_id UUID REFERENCES public.room_messages(id) ON DELETE SET NULL;
CREATE INDEX idx_reports_target_message ON public.user_reports(target_message_id);

CREATE OR REPLACE FUNCTION public.report_message(_message_id uuid, _category text, _details text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _msg public.room_messages%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _category IS NULL OR char_length(btrim(_category)) < 2 OR char_length(_category) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _details IS NOT NULL AND char_length(_details) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO _msg FROM public.room_messages WHERE id = _message_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT (public.is_room_member(_msg.room_id, _uid) OR public.is_room_host(_msg.room_id, _uid)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _msg.sender_id IS NOT DISTINCT FROM _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_reports
              WHERE reporter_id = _uid AND target_message_id = _message_id) THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'already_reported');
  END IF;
  IF NOT public.consume_rate_limit('report_message', 5, 3600) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.user_reports (reporter_id, target_type, target_user_id, target_room_id,
                                   target_message_id, category, details)
  VALUES (_uid, 'message', _msg.sender_id, _msg.room_id, _message_id, btrim(_category), _details);

  RETURN jsonb_build_object('ok', true, 'outcome', 'reported');
END; $$;

-- ------------------------------------------------------------
-- Retention cleanup
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_chat()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _deleted INTEGER := 0;
BEGIN
  PERFORM set_config('app.message_ctx', '1', true);
  WITH victims AS (
    SELECT m.id FROM public.room_messages m
      JOIN public.rooms r ON r.id = m.room_id
     WHERE (r.chat_retention = '24h' AND m.created_at < now() - interval '24 hours')
        OR (r.chat_retention = '7d' AND m.created_at < now() - interval '7 days')
        OR (r.chat_retention = 'room_expiry'
            AND ((r.expires_at IS NOT NULL AND r.expires_at <= now())
                 OR (r.ended_at IS NOT NULL AND r.ended_at <= now())))
  )
  DELETE FROM public.room_messages m USING victims v WHERE m.id = v.id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  PERFORM set_config('app.message_ctx', '0', true);
  RETURN _deleted;
END; $$;

-- ------------------------------------------------------------
-- Function grants
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.send_room_message(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_room_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_room_message(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_message_reaction(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_member_mute(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_message(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_expired_chat() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.send_room_message(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_room_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_room_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_message_reaction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_mute(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_message(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------
-- Realtime (postgres_changes only)
-- ------------------------------------------------------------
ALTER TABLE public.room_messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
