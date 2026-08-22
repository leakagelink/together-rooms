-- ============================================================
-- PHASE 3.2 — moderation operations, role management, hardening
-- ============================================================

-- ---------- 1. Least-privilege grants -----------------------
-- These tables previously carried the Postgres default ALL grant for
-- anon/authenticated. RLS already denied every write (no INSERT/UPDATE/DELETE
-- policies exist), but defence-in-depth requires the grant to be absent too.
REVOKE ALL ON public.user_roles FROM anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

REVOKE ALL ON public.audit_logs FROM anon, authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

REVOKE ALL ON public.moderation_actions FROM anon, authenticated;
GRANT SELECT ON public.moderation_actions TO authenticated;
GRANT ALL ON public.moderation_actions TO service_role;

-- ---------- 2. Moderation queue indexes ---------------------
CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON public.user_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_created
  ON public.user_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target_type
  ON public.user_reports (target_type);
CREATE INDEX IF NOT EXISTS idx_reports_category
  ON public.user_reports (category);
CREATE INDEX IF NOT EXISTS idx_moderation_report
  ON public.moderation_actions (report_id);
CREATE INDEX IF NOT EXISTS idx_moderation_created
  ON public.moderation_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON public.audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created
  ON public.audit_logs (created_at DESC);

-- ---------- 3. First-admin bootstrap ------------------------
-- Operator-only. EXECUTE is revoked from anon and authenticated below, so it
-- is unreachable through PostgREST with any end-user JWT. It also refuses to
-- run once any admin exists, so it cannot be used for escalation later.
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _target UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT id INTO _target FROM auth.users WHERE lower(email) = lower(btrim(_email)) LIMIT 1;
  IF _target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (_target, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, 'role.bootstrap_admin', 'user_role', _target,
          jsonb_build_object('role', 'admin', 'via', 'operator_bootstrap'));

  RETURN jsonb_build_object('ok', true, 'user_id', _target);
END; $$;

REVOKE ALL ON FUNCTION public.bootstrap_first_admin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(text) TO service_role;

-- ---------- 4. Role assignment / revocation -----------------
CREATE OR REPLACE FUNCTION public.assign_app_role(_user_id uuid, _role app_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _role NOT IN ('moderator', 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'role.assigned', 'user_role', _user_id, jsonb_build_object('role', _role));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_app_role(_user_id uuid, _role app_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _admins INTEGER;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _role NOT IN ('moderator', 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  -- An admin may never drop their own admin role (lock-out protection), and
  -- the last remaining admin may never be removed.
  IF _role = 'admin' THEN
    IF _user_id = _uid THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
    END IF;
    SELECT count(*) INTO _admins FROM public.user_roles WHERE role = 'admin';
    IF _admins <= 1 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
    END IF;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'role.revoked', 'user_role', _user_id, jsonb_build_object('role', _role));
  RETURN jsonb_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.revoke_app_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_app_role(uuid, app_role) TO authenticated, service_role;

-- ---------- 5. Report status with moderator note ------------
DROP FUNCTION IF EXISTS public.set_report_status(uuid, report_status);

CREATE OR REPLACE FUNCTION public.set_report_status(
  _report_id uuid,
  _status report_status,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _prev report_status;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _note IS NOT NULL AND char_length(_note) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  SELECT status INTO _prev FROM public.user_reports WHERE id = _report_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  UPDATE public.user_reports SET status = _status, updated_at = now() WHERE id = _report_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'report.status_changed', 'user_report', _report_id,
          jsonb_build_object('from', _prev, 'status', _status,
                             'note', nullif(btrim(coalesce(_note, '')), '')));
  RETURN jsonb_build_object('ok', true, 'status', _status);
END; $$;

REVOKE ALL ON FUNCTION public.set_report_status(uuid, report_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_status(uuid, report_status, text)
  TO authenticated, service_role;

-- ---------- 6. Staff dashboard overview ---------------------
CREATE OR REPLACE FUNCTION public.staff_moderation_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _counts jsonb;
  _recent jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT jsonb_build_object(
    'open',      count(*) FILTER (WHERE status = 'open'),
    'reviewing', count(*) FILTER (WHERE status = 'reviewing'),
    'actioned',  count(*) FILTER (WHERE status = 'actioned'),
    'dismissed', count(*) FILTER (WHERE status = 'dismissed'),
    'total',     count(*)
  ) INTO _counts FROM public.user_reports;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO _recent
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'action', a.action,
      'reason', a.reason,
      'created_at', a.created_at,
      'report_id', a.report_id,
      'room_id', a.room_id,
      'target_user_id', a.target_user_id,
      'target_name', tp.display_name,
      'actor_name', ap.display_name
    ) AS x
    FROM public.moderation_actions a
    LEFT JOIN public.profiles tp ON tp.id = a.target_user_id
    LEFT JOIN public.profiles ap ON ap.id = a.actor_id
    ORDER BY a.created_at DESC
    LIMIT 10
  ) s;

  RETURN jsonb_build_object('ok', true, 'counts', _counts, 'recent_actions', _recent,
                            'is_admin', public.has_role(_uid, 'admin'));
END; $$;

REVOKE ALL ON FUNCTION public.staff_moderation_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_moderation_overview() TO authenticated, service_role;

-- ---------- 7. Paginated / filtered report queue ------------
CREATE OR REPLACE FUNCTION public.staff_report_queue(
  _status report_status DEFAULT NULL,
  _target_type report_target DEFAULT NULL,
  _category text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _lim INTEGER := least(greatest(coalesce(_limit, 25), 1), 50);
  _off INTEGER := greatest(coalesce(_offset, 0), 0);
  _cat TEXT := nullif(btrim(coalesce(_category, '')), '');
  _total BIGINT;
  _rows jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT count(*) INTO _total
  FROM public.user_reports r
  WHERE (_status IS NULL OR r.status = _status)
    AND (_target_type IS NULL OR r.target_type = _target_type)
    AND (_cat IS NULL OR r.category ILIKE '%' || _cat || '%')
    AND (_from IS NULL OR r.created_at >= _from)
    AND (_to IS NULL OR r.created_at < _to);

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO _rows
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'category', r.category,
      'target_type', r.target_type,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'target_user_id', r.target_user_id,
      'target_name', tp.display_name,
      'room_id', r.target_room_id,
      'room_name', rm.name,
      'has_message', (r.target_message_id IS NOT NULL),
      'action_count', (SELECT count(*) FROM public.moderation_actions ma WHERE ma.report_id = r.id)
    ) AS x
    FROM public.user_reports r
    LEFT JOIN public.profiles tp ON tp.id = r.target_user_id
    LEFT JOIN public.rooms rm ON rm.id = r.target_room_id
    WHERE (_status IS NULL OR r.status = _status)
      AND (_target_type IS NULL OR r.target_type = _target_type)
      AND (_cat IS NULL OR r.category ILIKE '%' || _cat || '%')
      AND (_from IS NULL OR r.created_at >= _from)
      AND (_to IS NULL OR r.created_at < _to)
    ORDER BY r.created_at DESC
    LIMIT _lim OFFSET _off
  ) s;

  RETURN jsonb_build_object('ok', true, 'total', _total, 'limit', _lim,
                            'offset', _off, 'rows', _rows);
END; $$;

REVOKE ALL ON FUNCTION public.staff_report_queue(report_status, report_target, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_report_queue(report_status, report_target, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;

-- ---------- 8. Report detail --------------------------------
-- Returns evidence context but NEVER removed plaintext: a moderated message
-- reports has_archived_content = true and the plaintext must be fetched
-- separately through the audited staff_get_removed_message().
CREATE OR REPLACE FUNCTION public.staff_report_detail(_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _r public.user_reports%ROWTYPE;
  _msg public.room_messages%ROWTYPE;
  _actions jsonb;
  _audit jsonb;
  _message jsonb := NULL;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO _r FROM public.user_reports WHERE id = _report_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF _r.target_message_id IS NOT NULL THEN
    SELECT * INTO _msg FROM public.room_messages WHERE id = _r.target_message_id;
    IF FOUND THEN
      _message := jsonb_build_object(
        'id', _msg.id,
        'room_id', _msg.room_id,
        'sender_id', _msg.sender_id,
        'status', _msg.status,
        'created_at', _msg.created_at,
        'edited_at', _msg.edited_at,
        -- Live text only while the message is still visible to members.
        'content', CASE WHEN _msg.status = 'active' THEN _msg.content ELSE NULL END,
        'has_archived_content', EXISTS (
          SELECT 1 FROM public.message_moderation_archive m WHERE m.message_id = _msg.id
        )
      );
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO _actions
  FROM (
    SELECT jsonb_build_object(
      'id', a.id, 'action', a.action, 'reason', a.reason, 'created_at', a.created_at,
      'actor_id', a.actor_id, 'actor_name', ap.display_name,
      'target_user_id', a.target_user_id, 'target_name', tp.display_name
    ) AS x
    FROM public.moderation_actions a
    LEFT JOIN public.profiles ap ON ap.id = a.actor_id
    LEFT JOIN public.profiles tp ON tp.id = a.target_user_id
    WHERE a.report_id = _report_id
  ) s;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO _audit
  FROM (
    SELECT jsonb_build_object(
      'id', l.id, 'action', l.action, 'created_at', l.created_at,
      'actor_id', l.actor_id, 'actor_name', ap.display_name, 'metadata', l.metadata
    ) AS x
    FROM public.audit_logs l
    LEFT JOIN public.profiles ap ON ap.id = l.actor_id
    WHERE l.entity_type = 'user_report' AND l.entity_id = _report_id
    ORDER BY l.created_at DESC
    LIMIT 50
  ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'report', jsonb_build_object(
      'id', _r.id, 'status', _r.status, 'category', _r.category, 'details', _r.details,
      'target_type', _r.target_type, 'created_at', _r.created_at, 'updated_at', _r.updated_at,
      'reporter_id', _r.reporter_id,
      'reporter_name', (SELECT display_name FROM public.profiles WHERE id = _r.reporter_id),
      'target_user_id', _r.target_user_id,
      'target_name', (SELECT display_name FROM public.profiles WHERE id = _r.target_user_id),
      'target_status', (SELECT status FROM public.profiles WHERE id = _r.target_user_id),
      'room_id', _r.target_room_id,
      'room_name', (SELECT name FROM public.rooms WHERE id = _r.target_room_id),
      'room_status', (SELECT status FROM public.rooms WHERE id = _r.target_room_id),
      'target_ref', _r.target_ref
    ),
    'message', _message,
    'actions', _actions,
    'audit', _audit,
    'is_admin', public.has_role(_uid, 'admin')
  );
END; $$;

REVOKE ALL ON FUNCTION public.staff_report_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_report_detail(uuid) TO authenticated, service_role;

-- ---------- 9. Admin role directory + user search -----------
CREATE OR REPLACE FUNCTION public.admin_list_roles()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _rows jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO _rows
  FROM (
    SELECT jsonb_build_object(
      'user_id', ur.user_id,
      'role', ur.role,
      'created_at', ur.created_at,
      'display_name', p.display_name,
      'username', p.username,
      'email', u.email
    ) AS x
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id = ur.user_id
    LEFT JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.role IN ('moderator', 'admin')
  ) s;

  RETURN jsonb_build_object('ok', true, 'rows', _rows, 'self_id', _uid);
END; $$;

REVOKE ALL ON FUNCTION public.admin_list_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_roles() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_search_users(_q text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _term TEXT := nullif(btrim(coalesce(_q, '')), '');
  _rows jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _term IS NULL OR char_length(_term) < 3 THEN
    RETURN jsonb_build_object('ok', true, 'rows', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO _rows
  FROM (
    SELECT jsonb_build_object(
      'user_id', u.id,
      'email', u.email,
      'display_name', p.display_name,
      'username', p.username,
      'roles', (SELECT coalesce(jsonb_agg(ur.role), '[]'::jsonb)
                  FROM public.user_roles ur WHERE ur.user_id = u.id)
    ) AS x
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) LIKE '%' || lower(_term) || '%'
       OR lower(coalesce(p.username, '')) LIKE '%' || lower(_term) || '%'
       OR lower(coalesce(p.display_name, '')) LIKE '%' || lower(_term) || '%'
    ORDER BY u.created_at DESC
    LIMIT 20
  ) s;

  RETURN jsonb_build_object('ok', true, 'rows', _rows);
END; $$;

REVOKE ALL ON FUNCTION public.admin_search_users(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text) TO authenticated, service_role;

-- ---------- 10. Staff context probe -------------------------
CREATE OR REPLACE FUNCTION public.my_staff_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'is_staff', coalesce(public.is_staff(auth.uid()), false),
    'is_admin', coalesce(public.has_role(auth.uid(), 'admin'), false)
  );
$$;

REVOKE ALL ON FUNCTION public.my_staff_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_staff_context() TO authenticated, service_role;
