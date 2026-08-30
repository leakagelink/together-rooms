
-- ============ Admin control center RPCs (admin-only) ============

CREATE OR REPLACE FUNCTION public.admin_platform_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'users_total', (SELECT count(*) FROM public.profiles),
    'users_new_24h', (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '24 hours'),
    'users_suspended', (SELECT count(*) FROM public.profiles WHERE status = 'suspended'),
    'rooms_total', (SELECT count(*) FROM public.rooms),
    'rooms_active', (SELECT count(*) FROM public.rooms WHERE status = 'active'),
    'rooms_new_24h', (SELECT count(*) FROM public.rooms WHERE created_at > now() - interval '24 hours'),
    'messages_24h', (SELECT count(*) FROM public.room_messages WHERE created_at > now() - interval '24 hours'),
    'reports_open', (SELECT count(*) FROM public.user_reports WHERE status IN ('open','reviewing')),
    'ads_today', (SELECT coalesce(sum(rewarded_today), 0) FROM public.user_ad_access WHERE day = current_date),
    'notifications_24h', (SELECT count(*) FROM public.notifications WHERE created_at > now() - interval '24 hours')
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_users(
  _q text DEFAULT NULL,
  _status text DEFAULT NULL,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _term TEXT := nullif(btrim(coalesce(_q, '')), '');
  _lim INT := least(greatest(coalesce(_limit, 25), 1), 100);
  _off INT := greatest(coalesce(_offset, 0), 0);
  _rows jsonb;
  _total BIGINT;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT count(*) INTO _total
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE (_status IS NULL OR p.status::text = _status)
    AND (_term IS NULL
         OR lower(coalesce(u.email, '')) LIKE '%' || lower(_term) || '%'
         OR lower(coalesce(p.username, '')) LIKE '%' || lower(_term) || '%'
         OR lower(coalesce(p.display_name, '')) LIKE '%' || lower(_term) || '%');

  SELECT coalesce(jsonb_agg(x ORDER BY created_at DESC), '[]'::jsonb) INTO _rows
  FROM (
    SELECT p.created_at,
      jsonb_build_object(
        'user_id', p.id,
        'email', u.email,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'status', p.status,
        'created_at', p.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'rooms_owned', (SELECT count(*) FROM public.rooms r WHERE r.owner_id = p.id),
        'roles', (SELECT coalesce(jsonb_agg(ur.role), '[]'::jsonb) FROM public.user_roles ur WHERE ur.user_id = p.id)
      ) AS x
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE (_status IS NULL OR p.status::text = _status)
      AND (_term IS NULL
           OR lower(coalesce(u.email, '')) LIKE '%' || lower(_term) || '%'
           OR lower(coalesce(p.username, '')) LIKE '%' || lower(_term) || '%'
           OR lower(coalesce(p.display_name, '')) LIKE '%' || lower(_term) || '%')
    ORDER BY p.created_at DESC
    LIMIT _lim OFFSET _off
  ) s;

  RETURN jsonb_build_object('ok', true, 'rows', _rows, 'total', _total);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  _user_id uuid,
  _status text,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _status NOT IN ('active', 'suspended') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;
  IF _user_id = _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_target_self');
  END IF;
  IF public.has_role(_user_id, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_target_admin');
  END IF;

  PERFORM set_config('app.account_status_write', '1', true);
  UPDATE public.profiles
     SET status = _status::account_status, updated_at = now()
   WHERE id = _user_id;
  PERFORM set_config('app.account_status_write', '0', true);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'admin.account_status', 'user', _user_id,
          jsonb_build_object('status', _status, 'reason', left(coalesce(_reason, ''), 240)));

  RETURN jsonb_build_object('ok', true, 'status', _status);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_list_rooms(
  _q text DEFAULT NULL,
  _status text DEFAULT NULL,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _term TEXT := nullif(btrim(coalesce(_q, '')), '');
  _lim INT := least(greatest(coalesce(_limit, 25), 1), 100);
  _off INT := greatest(coalesce(_offset, 0), 0);
  _rows jsonb;
  _total BIGINT;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT count(*) INTO _total
  FROM public.rooms r
  WHERE (_status IS NULL OR r.status::text = _status)
    AND (_term IS NULL OR lower(r.name) LIKE '%' || lower(_term) || '%');

  SELECT coalesce(jsonb_agg(x ORDER BY created_at DESC), '[]'::jsonb) INTO _rows
  FROM (
    SELECT r.created_at,
      jsonb_build_object(
        'room_id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'privacy', r.privacy,
        'created_at', r.created_at,
        'expires_at', r.expires_at,
        'ended_at', r.ended_at,
        'owner_id', r.owner_id,
        'owner_name', op.display_name,
        'member_count', (SELECT count(*) FROM public.room_members m
                          WHERE m.room_id = r.id AND m.status = 'joined'),
        'message_count', (SELECT count(*) FROM public.room_messages msg WHERE msg.room_id = r.id)
      ) AS x
    FROM public.rooms r
    LEFT JOIN public.profiles op ON op.id = r.owner_id
    WHERE (_status IS NULL OR r.status::text = _status)
      AND (_term IS NULL OR lower(r.name) LIKE '%' || lower(_term) || '%')
    ORDER BY r.created_at DESC
    LIMIT _lim OFFSET _off
  ) s;

  RETURN jsonb_build_object('ok', true, 'rows', _rows, 'total', _total);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_force_end_room(_room_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  UPDATE public.rooms
     SET status = 'ended', ended_at = now(), updated_at = now()
   WHERE id = _room_id AND status <> 'ended';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found_or_ended');
  END IF;

  INSERT INTO public.room_events (room_id, actor_id, type, payload)
  VALUES (_room_id, _uid, 'ROOM_ENDED', jsonb_build_object('cause', 'admin_ended'));

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'admin.room_ended', 'room', _room_id,
          jsonb_build_object('reason', left(coalesce(_reason, ''), 240)));

  RETURN jsonb_build_object('ok', true);
END; $$;

-- Custom announcements: all users / staff / one room / explicit user list.
CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(
  _title text,
  _body text DEFAULT NULL,
  _audience text DEFAULT 'all',
  _room_id uuid DEFAULT NULL,
  _user_ids uuid[] DEFAULT NULL,
  _link text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _clean_title TEXT := nullif(btrim(coalesce(_title, '')), '');
  _clean_body TEXT := left(btrim(coalesce(_body, '')), 240);
  _data jsonb;
  _sent BIGINT := 0;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _clean_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'title_required');
  END IF;
  IF _audience NOT IN ('all', 'staff', 'room', 'users') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_audience');
  END IF;
  IF _audience = 'room' AND _room_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_required');
  END IF;
  IF _audience = 'users' AND (_user_ids IS NULL OR array_length(_user_ids, 1) IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'users_required');
  END IF;

  _data := jsonb_strip_nulls(jsonb_build_object(
    'source', 'admin_broadcast',
    'audience', _audience,
    'room_id', _room_id,
    'link', nullif(btrim(coalesce(_link, '')), '')
  ));

  WITH targets AS (
    SELECT p.id
      FROM public.profiles p
     WHERE p.status = 'active'
       AND (
         (_audience = 'all')
         OR (_audience = 'staff' AND EXISTS (
               SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = p.id AND ur.role IN ('admin', 'moderator')))
         OR (_audience = 'room' AND EXISTS (
               SELECT 1 FROM public.room_members m
                WHERE m.room_id = _room_id AND m.user_id = p.id AND m.status = 'joined'))
         OR (_audience = 'users' AND p.id = ANY(_user_ids))
       )
     LIMIT 20000
  ), inserted AS (
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT t.id, 'admin_announcement', left(_clean_title, 120), _clean_body, _data
      FROM targets t
    RETURNING 1
  )
  SELECT count(*) INTO _sent FROM inserted;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'admin.broadcast', 'notification', NULL,
          jsonb_build_object('audience', _audience, 'room_id', _room_id,
                             'sent', _sent, 'title', left(_clean_title, 120)));

  RETURN jsonb_build_object('ok', true, 'sent', _sent);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_recent_broadcasts(_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _rows jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'created_at', a.created_at,
           'metadata', a.metadata,
           'actor_name', p.display_name
         ) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO _rows
    FROM public.audit_logs a
    LEFT JOIN public.profiles p ON p.id = a.actor_id
   WHERE a.action = 'admin.broadcast'
   ORDER BY a.created_at DESC
   LIMIT least(greatest(coalesce(_limit, 20), 1), 100);

  RETURN jsonb_build_object('ok', true, 'rows', _rows);
END; $$;

REVOKE ALL ON FUNCTION public.admin_platform_stats() FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_list_users(text, text, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_set_account_status(uuid, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_list_rooms(text, text, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_force_end_room(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_broadcast_notification(text, text, text, uuid, uuid[], text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_recent_broadcasts(integer) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.admin_platform_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_rooms(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_end_room(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_notification(text, text, text, uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_broadcasts(integer) TO authenticated;
