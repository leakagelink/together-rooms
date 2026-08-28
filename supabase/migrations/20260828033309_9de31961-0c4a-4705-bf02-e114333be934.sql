-- =====================================================================
-- PHASE 15 — free-only v1, UGC reporting coverage, moderation enforcement,
-- realtime revocation and least-privilege hardening.
-- =====================================================================

-- ---------- A. FREE-ONLY PRODUCT LIMITS ----------
CREATE OR REPLACE FUNCTION public.product_limits()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'max_active_rooms', 25,
    'max_room_members', 25,
    'max_local_media_minutes', 60,
    'max_playlists', 25,
    'ads_enabled', true
  );
$$;
REVOKE ALL ON FUNCTION public.product_limits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_limits() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_room_entitlement_limits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _limits JSONB := public.product_limits();
  _active INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.max_members > (_limits->>'max_room_members')::INTEGER THEN
    RAISE EXCEPTION 'limit_reached: room capacity above the product limit'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO _active FROM public.rooms
   WHERE owner_id = NEW.owner_id
     AND status IN ('draft','active','paused')
     AND (expires_at IS NULL OR expires_at > now());
  IF _active >= (_limits->>'max_active_rooms')::INTEGER THEN
    RAISE EXCEPTION 'limit_reached: active room limit reached'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.set_room_capacity(_room_id uuid, _max_members integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _room public.rooms%ROWTYPE;
  _cap INTEGER := (public.product_limits()->>'max_room_members')::INTEGER;
  _joined INTEGER;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF _max_members IS NULL OR _max_members < 2 OR _max_members > _cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO _room FROM public.rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF COALESCE(_room.host_id, _room.owner_id) <> _uid AND _room.owner_id <> _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _room.status IN ('ended','archived') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;
  SELECT count(*) INTO _joined FROM public.room_members
   WHERE room_id = _room_id AND status = 'joined';
  IF _max_members < _joined THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  PERFORM set_config('app.room_capacity_write', '1', true);
  UPDATE public.rooms SET max_members = _max_members, updated_at = now() WHERE id = _room_id;
  PERFORM set_config('app.room_capacity_write', '0', true);
  RETURN jsonb_build_object('ok', true, 'max_members', _max_members);
END; $$;

REVOKE ALL ON public.entitlements FROM anon, authenticated;
REVOKE ALL ON public.subscription_products FROM anon, authenticated;
REVOKE ALL ON public.subscription_events FROM anon, authenticated;
REVOKE ALL ON public.plan_limits FROM anon, authenticated;
REVOKE ALL ON public.billing_ack_state FROM anon, authenticated;
REVOKE ALL ON public.billing_reconciliation_runs FROM anon, authenticated;
REVOKE ALL ON public.play_rtdn_messages FROM anon, authenticated;

DO $$
DECLARE _fn TEXT;
BEGIN
  FOR _fn IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('my_entitlement','entitlement_precheck','entitlement_snapshot',
         'my_subscription_events','apply_billing_event','admin_grant_entitlement',
         'admin_subscription_overview','current_plan')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _fn);
  END LOOP;
END $$;

-- ---------- B. ACCOUNT-STATUS ENFORCEMENT ----------
CREATE OR REPLACE FUNCTION public.is_account_active(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT p.status = 'active' FROM public.profiles p WHERE p.id = _user_id), false);
$$;
REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_room_member(_room_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_account_active(_user_id) AND EXISTS (
    SELECT 1 FROM public.room_members
     WHERE room_id = _room_id AND user_id = _user_id AND status IN ('invited','joined')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_host(_room_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_account_active(_user_id) AND (
    EXISTS (SELECT 1 FROM public.rooms WHERE id = _room_id
              AND (owner_id = _user_id OR host_id = _user_id))
    OR EXISTS (SELECT 1 FROM public.room_members
                WHERE room_id = _room_id AND user_id = _user_id
                  AND status = 'joined' AND role IN ('host','co_host'))
  );
$$;

CREATE OR REPLACE FUNCTION public.authorize_room_channel(_room_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.is_account_active(auth.uid())
     AND NOT EXISTS (
       SELECT 1 FROM public.room_members m
        WHERE m.room_id = _room_id AND m.user_id = auth.uid()
          AND m.status IN ('kicked','banned')
     )
     AND (
       EXISTS (SELECT 1 FROM public.room_members m
                WHERE m.room_id = _room_id AND m.user_id = auth.uid() AND m.status = 'joined')
       OR public.is_room_host(_room_id, auth.uid())
     );
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role' AND auth.uid() IS NOT NULL THEN
    NEW.subscription_tier := OLD.subscription_tier;
    NEW.id := OLD.id;
    IF COALESCE(current_setting('app.account_status_write', true), '') <> '1' THEN
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_profile_privileged_columns() FROM PUBLIC, anon, authenticated;

-- ---------- C. GENERIC UGC REPORTING ----------
REVOKE INSERT ON public.user_reports FROM authenticated;

CREATE OR REPLACE FUNCTION public.report_content(
  _target_type text, _target_id uuid, _category text, _details text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _room UUID;
  _owner UUID;
  _ref TEXT := _target_id::TEXT;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized'); END IF;
  IF NOT public.is_account_active(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _category IS NULL OR char_length(btrim(_category)) < 2 OR char_length(_category) > 60
     OR (_details IS NOT NULL AND char_length(_details) > 2000)
     OR _target_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  IF _target_type = 'resource' THEN
    SELECT room_id, added_by INTO _room, _owner FROM public.room_resources WHERE id = _target_id;
  ELSIF _target_type = 'note' THEN
    SELECT room_id, created_by INTO _room, _owner FROM public.room_notes WHERE id = _target_id;
  ELSIF _target_type = 'task' THEN
    SELECT room_id, created_by INTO _room, _owner FROM public.room_tasks WHERE id = _target_id;
  ELSIF _target_type = 'queue_item' THEN
    SELECT room_id, added_by INTO _room, _owner FROM public.room_media_queue WHERE id = _target_id;
  ELSIF _target_type = 'local_media_session' THEN
    SELECT room_id, owner_id INTO _room, _owner
      FROM public.room_local_media_sessions WHERE id = _target_id;
  ELSIF _target_type = 'playlist' THEN
    SELECT NULL::uuid, owner_id INTO _room, _owner FROM public.playlists
     WHERE id = _target_id AND visibility = 'shared_with_room';
  ELSIF _target_type = 'room' THEN
    SELECT id, owner_id INTO _room, _owner FROM public.rooms WHERE id = _target_id;
  ELSIF _target_type = 'user' THEN
    SELECT NULL::uuid, id INTO _room, _owner FROM public.profiles WHERE id = _target_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  IF _owner IS NULL AND _room IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF _owner IS NOT DISTINCT FROM _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  -- Room-scoped surfaces are only reportable by someone who can actually see them.
  IF _room IS NOT NULL
     AND NOT (public.is_room_member(_room, _uid) OR public.is_room_host(_room, _uid)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_reports
              WHERE reporter_id = _uid AND target_ref = _ref
                AND target_type::text = _target_type) THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'already_reported');
  END IF;
  IF NOT public.consume_rate_limit('report_content', 10, 3600) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.user_reports (reporter_id, target_type, target_user_id, target_room_id,
                                   target_ref, category, details)
  VALUES (_uid, _target_type::public.report_target, _owner, _room, _ref,
          btrim(_category), _details);

  RETURN jsonb_build_object('ok', true, 'outcome', 'reported');
END; $$;
REVOKE ALL ON FUNCTION public.report_content(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_content(text, uuid, text, text) TO authenticated;

-- ---------- D. MODERATION ENFORCEMENT ----------
CREATE OR REPLACE FUNCTION public.moderation_enforce(
  _target_user_id uuid, _action text, _room_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL, _duration_minutes integer DEFAULT NULL,
  _report_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _expires TIMESTAMPTZ;
  _action_id UUID;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF _target_user_id IS NULL OR _target_user_id = _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _action NOT IN ('warn','mute','kick','ban','suspend','content_removed','dismissed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _action IN ('mute','kick') AND _room_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF _duration_minutes IS NOT NULL THEN
    IF _duration_minutes < 5 OR _duration_minutes > 525600 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
    END IF;
    _expires := now() + make_interval(mins => _duration_minutes);
  END IF;
  -- A permanent account ban never expires; a suspension must.
  IF _action = 'suspend' AND _expires IS NULL THEN
    _expires := now() + interval '7 days';
  END IF;

  IF _action = 'mute' THEN
    PERFORM set_config('app.membership_ctx', '1', true);
    UPDATE public.room_members SET is_muted = true
     WHERE room_id = _room_id AND user_id = _target_user_id;
    PERFORM set_config('app.membership_ctx', '0', true);
  ELSIF _action = 'kick' THEN
    PERFORM set_config('app.membership_ctx', '1', true);
    UPDATE public.room_members SET status = 'kicked'
     WHERE room_id = _room_id AND user_id = _target_user_id;
    PERFORM set_config('app.membership_ctx', '0', true);
  ELSIF _action = 'ban' AND _room_id IS NOT NULL THEN
    PERFORM set_config('app.membership_ctx', '1', true);
    UPDATE public.room_members SET status = 'banned'
     WHERE room_id = _room_id AND user_id = _target_user_id;
    PERFORM set_config('app.membership_ctx', '0', true);
  ELSIF _action IN ('ban','suspend') THEN
    -- Account-level enforcement: every membership helper fails closed for a
    -- non-active account, so reads, writes and realtime all stop immediately.
    PERFORM set_config('app.account_status_write', '1', true);
    UPDATE public.profiles SET status = 'suspended', updated_at = now()
     WHERE id = _target_user_id;
    PERFORM set_config('app.account_status_write', '0', true);
    IF _action = 'ban' THEN _expires := NULL; END IF;
  END IF;

  INSERT INTO public.moderation_actions
    (report_id, room_id, target_user_id, actor_id, action, reason, expires_at)
  VALUES (_report_id, _room_id, _target_user_id, _uid,
          _action::public.moderation_action_type, _reason, _expires)
  RETURNING id INTO _action_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'moderation_enforce', 'user', _target_user_id,
          jsonb_build_object('action', _action, 'room_id', _room_id,
                             'expires_at', _expires, 'report_id', _report_id));

  IF _report_id IS NOT NULL THEN
    UPDATE public.user_reports SET status = 'actioned', updated_at = now()
     WHERE id = _report_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'action_id', _action_id,
                            'action', _action, 'expires_at', _expires);
END; $$;
REVOKE ALL ON FUNCTION public.moderation_enforce(uuid, text, uuid, text, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderation_enforce(uuid, text, uuid, text, integer, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.moderation_reverse(_action_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _a public.moderation_actions%ROWTYPE;
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  SELECT * INTO _a FROM public.moderation_actions WHERE id = _action_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF _a.action = 'mute' AND _a.room_id IS NOT NULL THEN
    PERFORM set_config('app.membership_ctx', '1', true);
    UPDATE public.room_members SET is_muted = false
     WHERE room_id = _a.room_id AND user_id = _a.target_user_id;
    PERFORM set_config('app.membership_ctx', '0', true);
  ELSIF _a.action IN ('kick','ban') AND _a.room_id IS NOT NULL THEN
    PERFORM set_config('app.membership_ctx', '1', true);
    UPDATE public.room_members SET status = 'left'
     WHERE room_id = _a.room_id AND user_id = _a.target_user_id
       AND status IN ('kicked','banned');
    PERFORM set_config('app.membership_ctx', '0', true);
  ELSIF _a.action IN ('ban','suspend') THEN
    PERFORM set_config('app.account_status_write', '1', true);
    UPDATE public.profiles SET status = 'active', updated_at = now()
     WHERE id = _a.target_user_id AND status = 'suspended';
    PERFORM set_config('app.account_status_write', '0', true);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'moderation_reverse', 'user', _a.target_user_id,
          jsonb_build_object('action_id', _action_id, 'action', _a.action, 'reason', _reason));

  RETURN jsonb_build_object('ok', true, 'reversed', _a.action::text);
END; $$;
REVOKE ALL ON FUNCTION public.moderation_reverse(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderation_reverse(uuid, text) TO authenticated;

-- Staff view of a user's enforcement history (strike context, no auto-bans).
CREATE OR REPLACE FUNCTION public.staff_user_enforcement(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_staff(_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'account_status', (SELECT status::text FROM public.profiles WHERE id = _user_id),
    'distinct_reporters', (SELECT count(DISTINCT reporter_id) FROM public.user_reports
                            WHERE target_user_id = _user_id),
    'open_reports', (SELECT count(*) FROM public.user_reports
                      WHERE target_user_id = _user_id AND status = 'open'),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action::text, 'room_id', a.room_id,
        'reason', a.reason, 'expires_at', a.expires_at, 'created_at', a.created_at)
        ORDER BY a.created_at DESC)
      FROM public.moderation_actions a WHERE a.target_user_id = _user_id), '[]'::jsonb)
  );
END; $$;
REVOKE ALL ON FUNCTION public.staff_user_enforcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_user_enforcement(uuid) TO authenticated;

-- Expired suspensions lapse automatically; permanent bans never do.
CREATE OR REPLACE FUNCTION public.expire_account_suspensions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n INTEGER := 0;
BEGIN
  PERFORM set_config('app.account_status_write', '1', true);
  WITH lapsed AS (
    SELECT DISTINCT a.target_user_id
      FROM public.moderation_actions a
     WHERE a.action = 'suspend' AND a.expires_at IS NOT NULL AND a.expires_at <= now()
       AND NOT EXISTS (
         SELECT 1 FROM public.moderation_actions b
          WHERE b.target_user_id = a.target_user_id AND b.room_id IS NULL
            AND ((b.action = 'ban') OR (b.action = 'suspend' AND (b.expires_at IS NULL OR b.expires_at > now())))
       )
  )
  UPDATE public.profiles p SET status = 'active', updated_at = now()
    FROM lapsed l WHERE p.id = l.target_user_id AND p.status = 'suspended';
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.account_status_write', '0', true);
  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.expire_account_suspensions() FROM PUBLIC, anon, authenticated;