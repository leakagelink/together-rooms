-- 1. Columns + consistency rules
ALTER TABLE public.room_messages
  ADD COLUMN voice_path TEXT,
  ADD COLUMN voice_duration_ms INTEGER;

ALTER TABLE public.room_messages
  ADD CONSTRAINT room_messages_voice_only_on_voice
    CHECK (voice_path IS NULL OR content_type = 'voice'),
  ADD CONSTRAINT room_messages_voice_active_complete
    CHECK (content_type <> 'voice' OR status <> 'active'
           OR (voice_path IS NOT NULL AND voice_duration_ms BETWEEN 1 AND 300000));

CREATE UNIQUE INDEX idx_room_messages_voice_path
  ON public.room_messages(voice_path) WHERE voice_path IS NOT NULL;

GRANT SELECT (voice_path, voice_duration_ms) ON public.room_messages TO authenticated;

-- 2. Storage access helpers (path = <room_id>/<user_id>/<uuid>.<ext>)
CREATE OR REPLACE FUNCTION public.can_upload_voice_note(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _parts text[] := string_to_array(_name, '/'); _room uuid;
BEGIN
  IF auth.uid() IS NULL OR array_length(_parts, 1) <> 3 THEN RETURN false; END IF;
  IF _parts[2] <> auth.uid()::text THEN RETURN false; END IF;
  BEGIN _room := _parts[1]::uuid; EXCEPTION WHEN others THEN RETURN false; END;
  RETURN EXISTS (
    SELECT 1 FROM public.room_members m
     WHERE m.room_id = _room AND m.user_id = auth.uid()
       AND m.status = 'joined' AND m.is_muted = false
  );
END; $$;

CREATE OR REPLACE FUNCTION public.can_listen_voice_note(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_staff(auth.uid())
    OR split_part(_name, '/', 2) = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.room_messages msg
       WHERE msg.voice_path = _name AND msg.status = 'active'
         AND (public.is_room_member(msg.room_id, auth.uid()) OR public.is_room_host(msg.room_id, auth.uid()))
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_upload_voice_note(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_listen_voice_note(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_voice_note(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_listen_voice_note(text) TO authenticated;

CREATE POLICY "voice_notes_insert_member" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voice-notes' AND public.can_upload_voice_note(name));

CREATE POLICY "voice_notes_select_room" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'voice-notes' AND public.can_listen_voice_note(name));

CREATE POLICY "voice_notes_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'voice-notes' AND split_part(name, '/', 2) = auth.uid()::text);

-- 3. Send RPC (mirrors send_room_message checks)
CREATE OR REPLACE FUNCTION public.send_room_voice_note(
  _room_id uuid, _voice_path text, _duration_ms integer, _parent_message_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _member public.room_members%ROWTYPE;
  _reason TEXT;
  _id UUID;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _duration_ms IS NULL OR _duration_ms < 1 OR _duration_ms > 300000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _voice_path IS NULL OR _voice_path !~ ('^' || _room_id::text || '/' || _uid::text
       || '/[0-9a-f-]{36}\.(webm|ogg|m4a|mp3|aac)$') THEN
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

  IF _parent_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.room_messages WHERE id = _parent_message_id AND room_id = _room_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'voice-notes' AND name = _voice_path) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF EXISTS (SELECT 1 FROM public.room_messages WHERE voice_path = _voice_path) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_message');
  END IF;

  PERFORM set_config('app.message_ctx', '1', true);
  INSERT INTO public.room_messages
    (room_id, sender_id, parent_message_id, content, content_type, voice_path, voice_duration_ms)
  VALUES (_room_id, _uid, _parent_message_id, 'Voice note', 'voice', _voice_path, _duration_ms)
  RETURNING id INTO _id;
  PERFORM set_config('app.message_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'message_id', _id);
END; $$;
REVOKE ALL ON FUNCTION public.send_room_voice_note(uuid, text, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_room_voice_note(uuid, text, integer, uuid) TO authenticated;

-- 4. Self-delete also detaches the recording (cleanup job removes the file)
CREATE OR REPLACE FUNCTION public.delete_room_message(_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
       SET status = 'deleted', deleted_at = now(), content = '', voice_path = NULL
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
END; $function$;

-- 5. Notifications also fire for voice notes
CREATE OR REPLACE FUNCTION public.tg_notify_room_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _room_name TEXT; _sender TEXT;
BEGIN
  IF NEW.content_type NOT IN ('text', 'voice') OR NEW.status <> 'active' THEN RETURN NEW; END IF;
  SELECT name INTO _room_name FROM public.rooms WHERE id = NEW.room_id;
  SELECT COALESCE(display_name, username, 'Someone') INTO _sender FROM public.profiles WHERE id = NEW.sender_id;
  PERFORM public.notify_room_members(
    NEW.room_id, NEW.sender_id, 'chat_message',
    COALESCE(_sender, 'Someone') || CASE WHEN NEW.content_type = 'voice' THEN ' sent a voice note' ELSE ' sent a message' END,
    COALESCE(_room_name, 'A room') || ': new activity in chat',
    jsonb_build_object('message_id', NEW.id),
    300
  );
  RETURN NEW;
END; $function$;

-- 6. Server-only cleanup helpers
CREATE OR REPLACE FUNCTION public.orphan_voice_note_paths(_limit integer DEFAULT 500)
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT o.name FROM storage.objects o
   WHERE o.bucket_id = 'voice-notes'
     AND o.created_at < now() - interval '1 hour'
     AND NOT EXISTS (
       SELECT 1 FROM public.room_messages m
        WHERE m.voice_path = o.name AND m.status IN ('active', 'moderated')
     )
   ORDER BY o.created_at
   LIMIT greatest(1, least(coalesce(_limit, 500), 1000));
$$;

CREATE OR REPLACE FUNCTION public.purge_user_voice_notes(_user_id uuid)
RETURNS SETOF text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('app.message_ctx', '1', true);
  UPDATE public.room_messages
     SET status = 'deleted', deleted_at = now(), content = '', voice_path = NULL
   WHERE sender_id = _user_id AND content_type = 'voice' AND status = 'active';
  PERFORM set_config('app.message_ctx', '0', true);
  RETURN QUERY
    SELECT o.name FROM storage.objects o
     WHERE o.bucket_id = 'voice-notes' AND split_part(o.name, '/', 2) = _user_id::text;
END; $$;

REVOKE ALL ON FUNCTION public.orphan_voice_note_paths(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_user_voice_notes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orphan_voice_note_paths(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_user_voice_notes(uuid) TO service_role;

-- 7. Hourly cleanup call to the app worker (same DB->worker secret as push dispatch)
CREATE OR REPLACE FUNCTION public.dispatch_voice_note_cleanup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE cfg public.push_dispatch_config%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.push_dispatch_config WHERE id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM extensions.net_http_post(
    url := replace(cfg.endpoint, '/api/public/push/dispatch', '/api/public/voice-notes/cleanup'),
    headers := jsonb_build_object('content-type', 'application/json',
                                  'authorization', 'Bearer ' || cfg.secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN RETURN;
END; $$;
REVOKE ALL ON FUNCTION public.dispatch_voice_note_cleanup() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('synctogether-voice-note-cleanup', '23 * * * *',
                     'SELECT public.dispatch_voice_note_cleanup();');