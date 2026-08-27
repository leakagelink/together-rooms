ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS notify_chat BOOLEAN NOT NULL DEFAULT TRUE;

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

  SELECT notify_room_invites, notify_room_activity, notify_chat
    INTO _settings
    FROM public.user_settings
   WHERE user_id = _user_id;

  IF FOUND THEN
    IF _type IN ('room_invite', 'member_joined', 'member_left') THEN
      _allowed := COALESCE(_settings.notify_room_invites, TRUE);
    ELSIF _type = 'chat_message' THEN
      _allowed := COALESCE(_settings.notify_chat, TRUE);
    ELSIF _type IN ('playback', 'queue', 'study') THEN
      _allowed := COALESCE(_settings.notify_room_activity, TRUE);
    END IF;
  END IF;

  IF NOT _allowed THEN RETURN NULL; END IF;

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