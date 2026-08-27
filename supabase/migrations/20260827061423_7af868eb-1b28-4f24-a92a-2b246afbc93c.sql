-- =========================================================
-- Activity notifications
-- =========================================================

-- Realtime for in-app delivery
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ---------- core emitter ----------
CREATE OR REPLACE FUNCTION public.emit_notification(
  _user_id UUID,
  _type TEXT,
  _title TEXT,
  _body TEXT DEFAULT NULL,
  _data JSONB DEFAULT '{}'::jsonb,
  _dedupe_seconds INTEGER DEFAULT 0
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _settings RECORD;
  _allowed BOOLEAN := TRUE;
  _id UUID;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;

  SELECT notify_room_invites, notify_room_activity
    INTO _settings
    FROM public.user_settings
   WHERE user_id = _user_id;

  IF FOUND THEN
    IF _type IN ('room_invite', 'member_joined', 'member_left') THEN
      _allowed := COALESCE(_settings.notify_room_invites, TRUE);
    ELSIF _type IN ('chat_message', 'playback', 'queue', 'study') THEN
      _allowed := COALESCE(_settings.notify_room_activity, TRUE);
    END IF;
  END IF;

  IF NOT _allowed THEN RETURN NULL; END IF;

  -- Collapse bursts (e.g. rapid chat) into a single unread entry.
  IF _dedupe_seconds > 0 THEN
    PERFORM 1 FROM public.notifications
     WHERE user_id = _user_id
       AND type = _type
       AND read_at IS NULL
       AND COALESCE(data->>'room_id', '') = COALESCE(_data->>'room_id', '')
       AND created_at > now() - make_interval(secs => _dedupe_seconds)
     LIMIT 1;
    IF FOUND THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (_user_id, _type, _title, left(COALESCE(_body, ''), 240), COALESCE(_data, '{}'::jsonb))
  RETURNING id INTO _id;

  RETURN _id;
END; $$;

REVOKE ALL ON FUNCTION public.emit_notification(UUID, TEXT, TEXT, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- Fan-out helper: every joined member except the actor.
CREATE OR REPLACE FUNCTION public.notify_room_members(
  _room_id UUID,
  _except UUID,
  _type TEXT,
  _title TEXT,
  _body TEXT DEFAULT NULL,
  _data JSONB DEFAULT '{}'::jsonb,
  _dedupe_seconds INTEGER DEFAULT 0
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _member RECORD;
  _payload JSONB := COALESCE(_data, '{}'::jsonb) || jsonb_build_object('room_id', _room_id);
BEGIN
  FOR _member IN
    SELECT user_id FROM public.room_members
     WHERE room_id = _room_id AND status = 'joined'
       AND (_except IS NULL OR user_id <> _except)
  LOOP
    PERFORM public.emit_notification(
      _member.user_id, _type, _title, _body, _payload, _dedupe_seconds
    );
  END LOOP;
END; $$;

REVOKE ALL ON FUNCTION public.notify_room_members(UUID, UUID, TEXT, TEXT, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- ---------- triggers ----------

-- Chat: one unread "new messages" entry per room per 5 minutes.
CREATE OR REPLACE FUNCTION public.tg_notify_room_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _room_name TEXT; _sender TEXT;
BEGIN
  IF NEW.content_type <> 'text' OR NEW.status <> 'active' THEN RETURN NEW; END IF;
  SELECT name INTO _room_name FROM public.rooms WHERE id = NEW.room_id;
  SELECT COALESCE(display_name, username, 'Someone') INTO _sender FROM public.profiles WHERE id = NEW.sender_id;
  PERFORM public.notify_room_members(
    NEW.room_id, NEW.sender_id, 'chat_message',
    COALESCE(_sender, 'Someone') || ' sent a message',
    COALESCE(_room_name, 'A room') || ': new activity in chat',
    jsonb_build_object('message_id', NEW.id),
    300
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS notify_room_message ON public.room_messages;
CREATE TRIGGER notify_room_message
AFTER INSERT ON public.room_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_room_message();

-- Membership: invites, joins, leaves.
CREATE OR REPLACE FUNCTION public.tg_notify_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _room RECORD; _who TEXT;
BEGIN
  SELECT id, name, host_id, owner_id INTO _room FROM public.rooms WHERE id = NEW.room_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT COALESCE(display_name, username, 'Someone') INTO _who FROM public.profiles WHERE id = NEW.user_id;

  IF TG_OP = 'INSERT' AND NEW.status = 'invited' THEN
    PERFORM public.emit_notification(
      NEW.user_id, 'room_invite',
      'You were invited to ' || COALESCE(_room.name, 'a room'),
      'Open the room to join.',
      jsonb_build_object('room_id', NEW.room_id)
    );
    RETURN NEW;
  END IF;

  IF NEW.status = 'joined' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'joined') THEN
    PERFORM public.notify_room_members(
      NEW.room_id, NEW.user_id, 'member_joined',
      COALESCE(_who, 'Someone') || ' joined ' || COALESCE(_room.name, 'the room'),
      NULL, '{}'::jsonb, 0
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IN ('left', 'kicked', 'banned') AND OLD.status = 'joined' THEN
    PERFORM public.emit_notification(
      COALESCE(_room.host_id, _room.owner_id), 'member_left',
      COALESCE(_who, 'Someone') || ' left ' || COALESCE(_room.name, 'the room'),
      NULL, jsonb_build_object('room_id', NEW.room_id)
    );
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS notify_membership ON public.room_members;
CREATE TRIGGER notify_membership
AFTER INSERT OR UPDATE ON public.room_members
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_membership();

-- Playback: only when the room's media actually changes.
CREATE OR REPLACE FUNCTION public.tg_notify_playback()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.provider_media_id IS NULL
     OR NEW.provider_media_id IS NOT DISTINCT FROM OLD.provider_media_id THEN
    RETURN NEW;
  END IF;
  PERFORM public.notify_room_members(
    NEW.room_id, NEW.controlled_by, 'playback',
    'Now playing in the room',
    COALESCE(NEW.title, 'A new track started'),
    jsonb_build_object('media_id', NEW.provider_media_id),
    60
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS notify_playback ON public.room_playback_state;
CREATE TRIGGER notify_playback
AFTER UPDATE ON public.room_playback_state
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_playback();

-- Queue additions.
CREATE OR REPLACE FUNCTION public.tg_notify_queue()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _who TEXT;
BEGIN
  IF NEW.status NOT IN ('queued', 'suggested') THEN RETURN NEW; END IF;
  SELECT COALESCE(display_name, username, 'Someone') INTO _who FROM public.profiles WHERE id = NEW.added_by;
  PERFORM public.notify_room_members(
    NEW.room_id, NEW.added_by, 'queue',
    COALESCE(_who, 'Someone') || ' added to the queue',
    COALESCE(NEW.title, 'A new item is queued'),
    jsonb_build_object('queue_item_id', NEW.id),
    120
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS notify_queue ON public.room_media_queue;
CREATE TRIGGER notify_queue
AFTER INSERT ON public.room_media_queue
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_queue();

-- Study tasks assigned to someone.
CREATE OR REPLACE FUNCTION public.tg_notify_task()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to) THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_to = COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN NEW;
  END IF;
  PERFORM public.emit_notification(
    NEW.assigned_to, 'study', 'A task was assigned to you', NEW.title,
    jsonb_build_object('room_id', NEW.room_id, 'task_id', NEW.id)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS notify_task ON public.room_tasks;
CREATE TRIGGER notify_task
AFTER INSERT OR UPDATE ON public.room_tasks
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_task();

-- Moderation outcomes for the target user.
CREATE OR REPLACE FUNCTION public.tg_notify_moderation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.target_user_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.emit_notification(
    NEW.target_user_id, 'moderation',
    'Moderation update: ' || NEW.action::text,
    NEW.reason,
    jsonb_build_object('room_id', NEW.room_id, 'action', NEW.action::text)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS notify_moderation ON public.moderation_actions;
CREATE TRIGGER notify_moderation
AFTER INSERT ON public.moderation_actions
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_moderation();

-- Subscription / entitlement changes.
CREATE OR REPLACE FUNCTION public.tg_notify_entitlement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.plan IS NOT DISTINCT FROM OLD.plan
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  PERFORM public.emit_notification(
    NEW.user_id, 'subscription',
    'Your plan is now ' || NEW.plan::text,
    'Status: ' || NEW.status::text,
    jsonb_build_object('plan', NEW.plan::text, 'status', NEW.status::text)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS notify_entitlement ON public.entitlements;
CREATE TRIGGER notify_entitlement
AFTER INSERT OR UPDATE ON public.entitlements
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_entitlement();

-- ---------- read-state RPCs ----------
CREATE OR REPLACE FUNCTION public.mark_notifications_read(_ids UUID[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.notifications
     SET read_at = now()
   WHERE user_id = auth.uid()
     AND read_at IS NULL
     AND (_ids IS NULL OR id = ANY(_ids));
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END; $$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_notifications()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  DELETE FROM public.notifications WHERE user_id = auth.uid();
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END; $$;

REVOKE ALL ON FUNCTION public.clear_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_notifications() TO authenticated;

-- =========================================================
-- Device push tokens (for later FCM delivery)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_tokens_own_select" ON public.push_tokens FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "push_tokens_own_delete" ON public.push_tokens FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.register_push_token(_token TEXT, _platform TEXT DEFAULT 'android')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _token IS NULL OR length(_token) < 20 OR length(_token) > 512 THEN
    RAISE EXCEPTION 'invalid token';
  END IF;
  INSERT INTO public.push_tokens (user_id, token, platform)
  VALUES (auth.uid(), _token, COALESCE(NULLIF(_platform, ''), 'android'))
  ON CONFLICT (token) DO UPDATE
    SET user_id = auth.uid(), last_seen_at = now(), platform = EXCLUDED.platform;
END; $$;

REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;