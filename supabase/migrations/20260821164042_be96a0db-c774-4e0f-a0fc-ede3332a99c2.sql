-- ============================================================
-- PHASE 3.1 — CHAT SECURITY, DATA PRIVACY & LEAST PRIVILEGE
-- ============================================================

-- ------------------------------------------------------------
-- 1. STAFF-ONLY MODERATION ARCHIVE (replaces room_messages.original_content)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_moderation_archive (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID NOT NULL REFERENCES public.room_messages(id) ON DELETE CASCADE,
  room_id       UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id     UUID,
  original_content TEXT NOT NULL,
  removal_kind  TEXT NOT NULL CHECK (removal_kind IN ('self_deleted','moderated')),
  removed_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_moderation_archive_message_key
  ON public.message_moderation_archive(message_id);

-- No anon access. No general authenticated access. Staff read only through the
-- audited RPC below, which is SECURITY DEFINER and bypasses these grants.
REVOKE ALL ON public.message_moderation_archive FROM PUBLIC;
REVOKE ALL ON public.message_moderation_archive FROM anon;
REVOKE ALL ON public.message_moderation_archive FROM authenticated;
GRANT ALL ON public.message_moderation_archive TO service_role;

ALTER TABLE public.message_moderation_archive ENABLE ROW LEVEL SECURITY;
-- Intentionally zero policies: PostgREST access is impossible for anon and
-- authenticated regardless of claims.

-- Migrate any retained plaintext off the hot table, then drop the column so it
-- can never appear in SELECT, PostgREST projections or REPLICA IDENTITY FULL
-- realtime payloads again.
INSERT INTO public.message_moderation_archive
  (message_id, room_id, sender_id, original_content, removal_kind, removed_by)
SELECT m.id, m.room_id, m.sender_id, m.original_content,
       CASE WHEN m.status = 'moderated' THEN 'moderated' ELSE 'self_deleted' END,
       m.moderated_by
  FROM public.room_messages m
 WHERE m.original_content IS NOT NULL
ON CONFLICT (message_id) DO NOTHING;

ALTER TABLE public.room_messages DROP COLUMN IF EXISTS original_content;

-- Audited staff retrieval path.
CREATE OR REPLACE FUNCTION public.staff_get_removed_message(_message_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _row public.message_moderation_archive%ROWTYPE;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO _row FROM public.message_moderation_archive WHERE message_id = _message_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'moderation.removed_content_viewed', 'room_message', _message_id,
          jsonb_build_object('room_id', _row.room_id));

  RETURN jsonb_build_object('ok', true, 'content', _row.original_content,
                            'room_id', _row.room_id, 'sender_id', _row.sender_id,
                            'removal_kind', _row.removal_kind, 'removed_at', _row.created_at);
END; $$;

REVOKE ALL ON FUNCTION public.staff_get_removed_message(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_get_removed_message(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 2. REACTION TOGGLE FIX (FOUND clobbered by PERFORM set_config)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_message_reaction(_message_id uuid, _reaction text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _msg public.room_messages%ROWTYPE;
  _room public.rooms%ROWTYPE;
  _member public.room_members%ROWTYPE;
  _r public.message_reaction;
  _existing public.message_reactions%ROWTYPE;
  _existing_found BOOLEAN;
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

  -- Capture the lookup outcome BEFORE any other statement: PERFORM/INSERT/etc.
  -- all reset FOUND, which is what silently broke this function.
  SELECT * INTO _existing FROM public.message_reactions
   WHERE message_id = _message_id AND user_id = _uid FOR UPDATE;
  _existing_found := FOUND;

  PERFORM set_config('app.message_ctx', '1', true);

  IF _existing_found AND _existing.reaction = _r THEN
    DELETE FROM public.message_reactions WHERE id = _existing.id;
    PERFORM set_config('app.message_ctx', '0', true);
    RETURN jsonb_build_object('ok', true, 'outcome', 'removed');
  ELSIF _existing_found THEN
    UPDATE public.message_reactions SET reaction = _r, created_at = now()
     WHERE id = _existing.id;
    PERFORM set_config('app.message_ctx', '0', true);
    RETURN jsonb_build_object('ok', true, 'outcome', 'replaced');
  ELSE
    INSERT INTO public.message_reactions (message_id, room_id, user_id, reaction)
    VALUES (_message_id, _msg.room_id, _uid, _r);
    PERFORM set_config('app.message_ctx', '0', true);
    RETURN jsonb_build_object('ok', true, 'outcome', 'set');
  END IF;
END; $$;

-- ------------------------------------------------------------
-- 3. delete_room_message: archive plaintext instead of retaining it inline
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_room_message(_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _msg public.room_messages%ROWTYPE;
  _is_mod BOOLEAN;
  _self BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;

  SELECT * INTO _msg FROM public.room_messages WHERE id = _message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _msg.status <> 'active' THEN RETURN jsonb_build_object('ok', true, 'outcome', 'already_removed'); END IF;

  _is_mod := public.can_moderate_room(_msg.room_id, _uid) OR public.is_room_host(_msg.room_id, _uid);
  _self := _msg.sender_id IS NOT DISTINCT FROM _uid;

  IF NOT _self AND NOT _is_mod THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _msg.content_type = 'system' AND NOT _is_mod THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  INSERT INTO public.message_moderation_archive
    (message_id, room_id, sender_id, original_content, removal_kind, removed_by)
  VALUES (_message_id, _msg.room_id, _msg.sender_id, _msg.content,
          CASE WHEN _self THEN 'self_deleted' ELSE 'moderated' END, _uid)
  ON CONFLICT (message_id) DO NOTHING;

  PERFORM set_config('app.message_ctx', '1', true);
  IF _self THEN
    UPDATE public.room_messages
       SET status = 'deleted', deleted_at = now(), content = ''
     WHERE id = _message_id;
  ELSE
    UPDATE public.room_messages
       SET status = 'moderated', deleted_at = now(), moderated_by = _uid,
           moderated_at = now(), content = ''
     WHERE id = _message_id;
    INSERT INTO public.moderation_actions (actor_id, target_user_id, room_id, action, reason)
    VALUES (_uid, _msg.sender_id, _msg.room_id, 'content_removed', 'message removed by room moderator');
  END IF;
  PERFORM set_config('app.message_ctx', '0', true);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'message.removed', 'room_message', _message_id,
          jsonb_build_object('room_id', _msg.room_id, 'moderator', NOT _self));

  RETURN jsonb_build_object('ok', true, 'outcome', 'removed');
END; $$;

-- ------------------------------------------------------------
-- 4. GUARD TRIGGERS — remove the anonymous bypass path
-- ------------------------------------------------------------
-- Trusted execution = (a) the app.*_ctx flag set inside a SECURITY DEFINER RPC,
-- or (b) an actually privileged database role. auth.uid() IS NULL is no longer
-- treated as permission to write.
CREATE OR REPLACE FUNCTION public.guard_room_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _trusted BOOLEAN := coalesce(current_setting('app.message_ctx', true), '') = '1'
                      OR current_user IN ('postgres', 'supabase_admin', 'service_role');
BEGIN
  IF _trusted THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'message_write_forbidden' USING ERRCODE = '42501';
END; $$;

CREATE OR REPLACE FUNCTION public.guard_message_reactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _trusted BOOLEAN := coalesce(current_setting('app.message_ctx', true), '') = '1'
                      OR current_user IN ('postgres', 'supabase_admin', 'service_role');
BEGIN
  IF _trusted THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'reaction_write_forbidden' USING ERRCODE = '42501';
END; $$;

CREATE OR REPLACE FUNCTION public.guard_room_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _trusted BOOLEAN := coalesce(current_setting('app.membership_ctx', true), '') = '1'
                      OR current_user IN ('postgres', 'supabase_admin', 'service_role');
BEGIN
  IF _trusted THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'membership_insert_forbidden' USING ERRCODE = '42501';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'membership_delete_forbidden' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL OR NOT public.can_moderate_room(OLD.room_id, auth.uid()) THEN
    RAISE EXCEPTION 'membership_update_forbidden' USING ERRCODE = '42501';
  END IF;

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

-- ------------------------------------------------------------
-- 5. LEAST-PRIVILEGE TABLE GRANTS
-- ------------------------------------------------------------
-- room_messages: read-only for signed-in members (RLS scoped), nothing for anon.
DROP POLICY IF EXISTS room_messages_insert_member ON public.room_messages;
DROP POLICY IF EXISTS room_messages_update_own ON public.room_messages;
REVOKE ALL ON public.room_messages FROM PUBLIC;
REVOKE ALL ON public.room_messages FROM anon;
REVOKE ALL ON public.room_messages FROM authenticated;
GRANT SELECT ON public.room_messages TO authenticated;
GRANT ALL ON public.room_messages TO service_role;

-- message_reactions: read-only for signed-in members, nothing for anon.
REVOKE ALL ON public.message_reactions FROM PUBLIC;
REVOKE ALL ON public.message_reactions FROM anon;
REVOKE ALL ON public.message_reactions FROM authenticated;
GRANT SELECT ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;

-- user_reports: reporters may file and read their own; staff read via RLS.
REVOKE ALL ON public.user_reports FROM PUBLIC;
REVOKE ALL ON public.user_reports FROM anon;
REVOKE ALL ON public.user_reports FROM authenticated;
GRANT SELECT, INSERT ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;