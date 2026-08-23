
CREATE OR REPLACE FUNCTION public.can_control_study(_room_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    public.is_room_host(_room_id, _user_id)
    OR EXISTS (SELECT 1 FROM public.room_members m
                WHERE m.room_id = _room_id AND m.user_id = _user_id
                  AND m.status = 'joined' AND m.can_moderate)
  );
$$;

CREATE OR REPLACE FUNCTION public.ensure_study_settings(_room_id uuid)
RETURNS public.room_study_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s public.room_study_settings%ROWTYPE;
BEGIN
  PERFORM set_config('app.study_ctx','1',true);
  SELECT * INTO _s FROM public.room_study_settings WHERE room_id = _room_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.room_study_settings(room_id) VALUES (_room_id)
      ON CONFLICT (room_id) DO NOTHING;
    SELECT * INTO _s FROM public.room_study_settings WHERE room_id = _room_id FOR UPDATE;
  END IF;
  RETURN _s;
END; $$;

CREATE OR REPLACE FUNCTION public.study_precheck(_room_id uuid, _action text, _limit integer, _window_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _room public.rooms%ROWTYPE; _reason TEXT;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason','unauthorized'); END IF;
  SELECT * INTO _room FROM public.rooms WHERE id = _room_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _reason := public.room_is_joinable(_room);
  IF _reason <> 'ok' THEN RETURN jsonb_build_object('ok', false, 'reason', _reason); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = _room_id AND m.user_id = _uid AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  IF NOT public.consume_rate_limit(_action, _limit, _window_seconds) THEN
    RETURN jsonb_build_object('ok', false, 'reason','rate_limited');
  END IF;
  PERFORM set_config('app.study_ctx','1',true);
  RETURN NULL;
END; $$;

-- ------------------------------------------------------------- settings RPC
CREATE OR REPLACE FUNCTION public.set_study_settings(
  _room_id uuid, _resource_mode text DEFAULT NULL, _note_mode text DEFAULT NULL,
  _timer_mode text DEFAULT NULL, _focus_mode text DEFAULT NULL, _private_research boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_study_settings%ROWTYPE;
BEGIN
  _pre := public.study_precheck(_room_id, 'study_settings', 30, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT public.can_control_study(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  IF _resource_mode IS NOT NULL AND _resource_mode NOT IN ('host_only','collaborative','host_approval')
     OR _note_mode IS NOT NULL AND _note_mode NOT IN ('host_only','collaborative')
     OR _timer_mode IS NOT NULL AND _timer_mode NOT IN ('host_only','collaborative')
     OR _focus_mode IS NOT NULL AND _focus_mode NOT IN ('host_sync','free_navigation') THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  _s := public.ensure_study_settings(_room_id);
  UPDATE public.room_study_settings SET
    resource_mode = coalesce(_resource_mode::public.research_permission_mode, resource_mode),
    note_mode = coalesce(_note_mode::public.research_permission_mode, note_mode),
    timer_mode = coalesce(_timer_mode::public.research_permission_mode, timer_mode),
    focus_mode = coalesce(_focus_mode::public.research_focus_mode, focus_mode),
    private_research_mode = coalesce(_private_research, private_research_mode),
    updated_at = now()
  WHERE room_id = _room_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- ------------------------------------------------------------ resource RPCs
CREATE OR REPLACE FUNCTION public.add_room_resource(
  _room_id uuid, _resource_type text, _title text, _url text DEFAULT NULL,
  _normalized_url text DEFAULT NULL, _host text DEFAULT NULL,
  _description text DEFAULT NULL, _provider_media_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_study_settings%ROWTYPE;
        _status public.resource_status; _id UUID; _ctrl boolean;
BEGIN
  _pre := public.study_precheck(_room_id, 'resource_add', 20, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;

  IF _resource_type NOT IN ('web_link','youtube','document_reference','note')
     OR coalesce(btrim(_title),'') = '' OR length(_title) > 200
     OR coalesce(length(_description),0) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  IF _resource_type = 'note' THEN
    _url := NULL; _normalized_url := NULL; _host := NULL;
  ELSE
    IF _url IS NULL OR _url !~* '^https?://[^\s]+$' OR length(_url) > 2048 THEN
      RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
    END IF;
    IF _normalized_url IS NULL OR _normalized_url !~* '^https?://[^\s]+$' THEN
      RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
    END IF;
  END IF;

  _s := public.ensure_study_settings(_room_id);
  _ctrl := public.can_control_study(_room_id, _uid);

  IF _s.resource_mode = 'host_only' AND NOT _ctrl THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  _status := CASE WHEN _s.resource_mode = 'host_approval' AND NOT _ctrl
                  THEN 'pending'::public.resource_status
                  ELSE 'active'::public.resource_status END;

  IF _normalized_url IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.room_resources r
       WHERE r.room_id = _room_id AND r.normalized_url = _normalized_url
         AND r.status IN ('active','pending')) THEN
    RETURN jsonb_build_object('ok', false, 'reason','duplicate_item');
  END IF;

  INSERT INTO public.room_resources(room_id, resource_type, url, normalized_url, host,
      provider_media_id, title, description, added_by, status)
  VALUES (_room_id, _resource_type::public.resource_kind, _url, _normalized_url, _host,
      _provider_media_id, btrim(_title), nullif(btrim(coalesce(_description,'')),''), _uid, _status)
  RETURNING id INTO _id;

  RETURN jsonb_build_object('ok', true, 'resource_id', _id, 'status', _status);
END; $$;

CREATE OR REPLACE FUNCTION public.update_room_resource(_resource_id uuid, _title text DEFAULT NULL, _description text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _r public.room_resources%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.room_resources WHERE id = _resource_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _pre := public.study_precheck(_r.room_id, 'resource_update', 40, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT (public.can_control_study(_r.room_id, _uid) OR _r.added_by = _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  IF (_title IS NOT NULL AND (btrim(_title) = '' OR length(_title) > 200))
     OR coalesce(length(_description),0) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  UPDATE public.room_resources
     SET title = coalesce(nullif(btrim(coalesce(_title,'')),''), title),
         description = CASE WHEN _description IS NULL THEN description
                            ELSE nullif(btrim(_description),'') END
   WHERE id = _resource_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.set_resource_status(_resource_id uuid, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _r public.room_resources%ROWTYPE; _ctrl boolean;
BEGIN
  IF _status NOT IN ('active','archived','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  SELECT * INTO _r FROM public.room_resources WHERE id = _resource_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _pre := public.study_precheck(_r.room_id, 'resource_status', 40, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  _ctrl := public.can_control_study(_r.room_id, _uid);
  -- Approving a pending suggestion or rejecting anything is controller-only.
  IF (_r.status = 'pending' OR _status = 'rejected') AND NOT _ctrl THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  IF NOT (_ctrl OR _r.added_by = _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  IF _status = 'active' AND _r.normalized_url IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.room_resources o
       WHERE o.room_id = _r.room_id AND o.id <> _r.id
         AND o.normalized_url = _r.normalized_url AND o.status IN ('active','pending')) THEN
    RETURN jsonb_build_object('ok', false, 'reason','duplicate_item');
  END IF;
  UPDATE public.room_resources SET status = _status::public.resource_status WHERE id = _resource_id;
  IF _status <> 'active' THEN
    UPDATE public.room_study_settings SET focused_resource_id = NULL, focus_version = focus_version + 1
     WHERE room_id = _r.room_id AND focused_resource_id = _resource_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', _status);
END; $$;

CREATE OR REPLACE FUNCTION public.set_resource_pinned(_resource_id uuid, _pinned boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _r public.room_resources%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.room_resources WHERE id = _resource_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _pre := public.study_precheck(_r.room_id, 'resource_pin', 40, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT public.can_control_study(_r.room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  UPDATE public.room_resources SET pinned = _pinned WHERE id = _resource_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.remove_room_resource(_resource_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _r public.room_resources%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.room_resources WHERE id = _resource_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _pre := public.study_precheck(_r.room_id, 'resource_remove', 30, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT (public.can_control_study(_r.room_id, _uid) OR _r.added_by = _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  UPDATE public.room_study_settings SET focused_resource_id = NULL, focus_version = focus_version + 1
   WHERE room_id = _r.room_id AND focused_resource_id = _resource_id;
  DELETE FROM public.room_resources WHERE id = _resource_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.set_focused_resource(_room_id uuid, _resource_id uuid, _expected_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_study_settings%ROWTYPE;
BEGIN
  _pre := public.study_precheck(_room_id, 'resource_focus', 30, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT public.can_control_study(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  _s := public.ensure_study_settings(_room_id);
  IF _expected_version IS NOT NULL AND _expected_version <> _s.focus_version THEN
    RETURN jsonb_build_object('ok', false, 'reason','version_conflict', 'focus_version', _s.focus_version);
  END IF;
  IF _resource_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.room_resources r
       WHERE r.id = _resource_id AND r.room_id = _room_id AND r.status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason','not_found');
  END IF;
  UPDATE public.room_study_settings
     SET focused_resource_id = _resource_id, focus_version = focus_version + 1, updated_at = now()
   WHERE room_id = _room_id;
  RETURN jsonb_build_object('ok', true, 'focus_version', _s.focus_version + 1);
END; $$;

-- ---------------------------------------------------------------- note RPCs
CREATE OR REPLACE FUNCTION public.create_room_note(_room_id uuid, _title text, _content text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_study_settings%ROWTYPE; _id UUID;
BEGIN
  _pre := public.study_precheck(_room_id, 'note_create', 20, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF coalesce(btrim(_title),'') = '' OR length(_title) > 200 OR length(coalesce(_content,'')) > 20000 THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  _s := public.ensure_study_settings(_room_id);
  IF _s.note_mode = 'host_only' AND NOT public.can_control_study(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  INSERT INTO public.room_notes(room_id, title, content, created_by, updated_by)
  VALUES (_room_id, btrim(_title), coalesce(_content,''), _uid, _uid) RETURNING id INTO _id;
  INSERT INTO public.room_note_revisions(note_id, room_id, revision, content_length, updated_by)
  VALUES (_id, _room_id, 1, length(coalesce(_content,'')), _uid);
  RETURN jsonb_build_object('ok', true, 'note_id', _id, 'revision', 1);
END; $$;

CREATE OR REPLACE FUNCTION public.update_room_note(_note_id uuid, _expected_revision integer, _title text DEFAULT NULL, _content text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _n public.room_notes%ROWTYPE;
        _s public.room_study_settings%ROWTYPE; _next integer;
BEGIN
  SELECT * INTO _n FROM public.room_notes WHERE id = _note_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _pre := public.study_precheck(_n.room_id, 'note_update', 60, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  _s := public.ensure_study_settings(_n.room_id);
  IF _s.note_mode = 'host_only' AND NOT public.can_control_study(_n.room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  IF length(coalesce(_content,'')) > 20000 OR (_title IS NOT NULL AND length(_title) > 200) THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  -- Lock the row, then compare revisions: a stale writer never wins.
  SELECT * INTO _n FROM public.room_notes WHERE id = _note_id FOR UPDATE;
  IF _expected_revision <> _n.revision THEN
    RETURN jsonb_build_object('ok', false, 'reason','version_conflict', 'revision', _n.revision);
  END IF;
  _next := _n.revision + 1;
  UPDATE public.room_notes
     SET title = coalesce(nullif(btrim(coalesce(_title,'')),''), title),
         content = coalesce(_content, content),
         revision = _next, updated_by = _uid
   WHERE id = _note_id;
  INSERT INTO public.room_note_revisions(note_id, room_id, revision, content_length, updated_by)
  VALUES (_note_id, _n.room_id, _next, length(coalesce(_content, _n.content)), _uid);
  RETURN jsonb_build_object('ok', true, 'revision', _next);
END; $$;

CREATE OR REPLACE FUNCTION public.delete_room_note(_note_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _n public.room_notes%ROWTYPE;
BEGIN
  SELECT * INTO _n FROM public.room_notes WHERE id = _note_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _pre := public.study_precheck(_n.room_id, 'note_delete', 20, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT (public.can_control_study(_n.room_id, _uid) OR _n.created_by = _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  DELETE FROM public.room_notes WHERE id = _note_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- ---------------------------------------------------------------- task RPCs
CREATE OR REPLACE FUNCTION public.create_room_task(_room_id uuid, _title text, _description text DEFAULT NULL, _assigned_to uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _id UUID;
BEGIN
  _pre := public.study_precheck(_room_id, 'task_create', 20, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF coalesce(btrim(_title),'') = '' OR length(_title) > 200 OR coalesce(length(_description),0) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  IF _assigned_to IS NOT NULL THEN
    IF _assigned_to <> _uid AND NOT public.can_control_study(_room_id, _uid) THEN
      RETURN jsonb_build_object('ok', false, 'reason','forbidden');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.room_members m WHERE m.room_id = _room_id
                    AND m.user_id = _assigned_to AND m.status = 'joined') THEN
      RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
    END IF;
  END IF;
  INSERT INTO public.room_tasks(room_id, title, description, assigned_to, created_by)
  VALUES (_room_id, btrim(_title), nullif(btrim(coalesce(_description,'')),''), _assigned_to, _uid)
  RETURNING id INTO _id;
  RETURN jsonb_build_object('ok', true, 'task_id', _id);
END; $$;

CREATE OR REPLACE FUNCTION public.update_room_task(_task_id uuid, _status text DEFAULT NULL, _assigned_to uuid DEFAULT NULL, _clear_assignee boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _t public.room_tasks%ROWTYPE; _new public.study_task_status;
BEGIN
  SELECT * INTO _t FROM public.room_tasks WHERE id = _task_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _pre := public.study_precheck(_t.room_id, 'task_update', 60, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF _status IS NOT NULL AND _status NOT IN ('todo','in_progress','completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  IF (_assigned_to IS NOT NULL OR _clear_assignee) THEN
    IF NOT public.can_control_study(_t.room_id, _uid)
       AND NOT (_assigned_to = _uid OR (_clear_assignee AND _t.assigned_to = _uid)) THEN
      RETURN jsonb_build_object('ok', false, 'reason','forbidden');
    END IF;
    IF _assigned_to IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.room_members m WHERE m.room_id = _t.room_id
         AND m.user_id = _assigned_to AND m.status = 'joined') THEN
      RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
    END IF;
  END IF;
  _new := coalesce(_status::public.study_task_status, _t.status);
  UPDATE public.room_tasks
     SET status = _new,
         assigned_to = CASE WHEN _clear_assignee THEN NULL
                            WHEN _assigned_to IS NOT NULL THEN _assigned_to ELSE assigned_to END,
         completed_by = CASE WHEN _new = 'completed' THEN coalesce(completed_by, _uid) ELSE NULL END,
         completed_at = CASE WHEN _new = 'completed' THEN coalesce(completed_at, now()) ELSE NULL END
   WHERE id = _task_id;
  RETURN jsonb_build_object('ok', true, 'status', _new);
END; $$;

CREATE OR REPLACE FUNCTION public.delete_room_task(_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _t public.room_tasks%ROWTYPE;
BEGIN
  SELECT * INTO _t FROM public.room_tasks WHERE id = _task_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason','not_found'); END IF;
  _pre := public.study_precheck(_t.room_id, 'task_delete', 20, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  IF NOT (public.can_control_study(_t.room_id, _uid) OR _t.created_by = _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  DELETE FROM public.room_tasks WHERE id = _task_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- --------------------------------------------------------------- timer RPCs
CREATE OR REPLACE FUNCTION public.control_focus_timer(
  _room_id uuid, _action text, _phase text DEFAULT NULL,
  _duration_seconds integer DEFAULT NULL, _expected_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _pre jsonb; _s public.room_study_settings%ROWTYPE;
        _t public.room_focus_timer%ROWTYPE; _remaining integer; _dur integer;
BEGIN
  IF _action NOT IN ('start','pause','resume','reset','complete') THEN
    RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
  END IF;
  _pre := public.study_precheck(_room_id, 'timer_control', 30, 60);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;
  _s := public.ensure_study_settings(_room_id);
  IF _s.timer_mode = 'host_only' AND NOT public.can_control_study(_room_id, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;

  SELECT * INTO _t FROM public.room_focus_timer WHERE room_id = _room_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.room_focus_timer(room_id) VALUES (_room_id) ON CONFLICT DO NOTHING;
    SELECT * INTO _t FROM public.room_focus_timer WHERE room_id = _room_id FOR UPDATE;
  END IF;
  IF _expected_version IS NOT NULL AND _expected_version <> _t.version THEN
    RETURN jsonb_build_object('ok', false, 'reason','version_conflict', 'version', _t.version);
  END IF;

  IF _action = 'start' THEN
    _dur := coalesce(_duration_seconds, _t.duration_seconds, 1500);
    IF _dur < 60 OR _dur > 14400 THEN RETURN jsonb_build_object('ok', false, 'reason','invalid_request'); END IF;
    IF _phase IS NOT NULL AND _phase NOT IN ('focus','short_break','long_break','custom') THEN
      RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
    END IF;
    UPDATE public.room_focus_timer SET
      phase = coalesce(_phase::public.focus_timer_phase, phase), status = 'running',
      duration_seconds = _dur, remaining_seconds = NULL,
      started_at = now(), ends_at = now() + make_interval(secs => _dur),
      version = version + 1, updated_by = _uid, updated_at = now()
    WHERE room_id = _room_id;
  ELSIF _action = 'pause' THEN
    IF _t.status <> 'running' THEN RETURN jsonb_build_object('ok', false, 'reason','invalid_request'); END IF;
    _remaining := greatest(0, ceil(extract(epoch FROM (_t.ends_at - now())))::integer);
    UPDATE public.room_focus_timer SET status = 'paused', remaining_seconds = _remaining,
      ends_at = NULL, version = version + 1, updated_by = _uid, updated_at = now()
    WHERE room_id = _room_id;
  ELSIF _action = 'resume' THEN
    IF _t.status <> 'paused' THEN RETURN jsonb_build_object('ok', false, 'reason','invalid_request'); END IF;
    _remaining := greatest(1, coalesce(_t.remaining_seconds, _t.duration_seconds));
    UPDATE public.room_focus_timer SET status = 'running', started_at = now(),
      ends_at = now() + make_interval(secs => _remaining), remaining_seconds = NULL,
      version = version + 1, updated_by = _uid, updated_at = now()
    WHERE room_id = _room_id;
  ELSIF _action = 'complete' THEN
    IF _t.status <> 'running' OR _t.ends_at IS NULL OR _t.ends_at > now() THEN
      RETURN jsonb_build_object('ok', false, 'reason','invalid_request');
    END IF;
    UPDATE public.room_focus_timer SET status = 'completed', ends_at = _t.ends_at,
      remaining_seconds = 0,
      sessions_completed = sessions_completed + CASE WHEN _t.phase = 'focus' THEN 1 ELSE 0 END,
      version = version + 1, updated_by = _uid, updated_at = now()
    WHERE room_id = _room_id;
  ELSE
    UPDATE public.room_focus_timer SET status = 'idle', started_at = NULL, ends_at = NULL,
      remaining_seconds = NULL, version = version + 1, updated_by = _uid, updated_at = now()
    WHERE room_id = _room_id;
  END IF;

  SELECT * INTO _t FROM public.room_focus_timer WHERE room_id = _room_id;
  RETURN jsonb_build_object('ok', true, 'version', _t.version, 'status', _t.status,
    'phase', _t.phase, 'ends_at', _t.ends_at, 'remaining_seconds', _t.remaining_seconds,
    'duration_seconds', _t.duration_seconds, 'sessions_completed', _t.sessions_completed);
END; $$;

-- -------------------------------------------------------------- summary RPC
CREATE OR REPLACE FUNCTION public.study_session_summary(_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason','unauthorized'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.room_members m WHERE m.room_id = _room_id
                  AND m.user_id = _uid AND m.status = 'joined') THEN
    RETURN jsonb_build_object('ok', false, 'reason','forbidden');
  END IF;
  RETURN jsonb_build_object('ok', true,
    'resources_active', (SELECT count(*) FROM public.room_resources WHERE room_id = _room_id AND status = 'active'),
    'resources_pending', (SELECT count(*) FROM public.room_resources WHERE room_id = _room_id AND status = 'pending'),
    'resources_archived', (SELECT count(*) FROM public.room_resources WHERE room_id = _room_id AND status = 'archived'),
    'notes_total', (SELECT count(*) FROM public.room_notes WHERE room_id = _room_id),
    'note_revisions', (SELECT count(*) FROM public.room_note_revisions WHERE room_id = _room_id),
    'tasks_total', (SELECT count(*) FROM public.room_tasks WHERE room_id = _room_id),
    'tasks_completed', (SELECT count(*) FROM public.room_tasks WHERE room_id = _room_id AND status = 'completed'),
    'focus_sessions_completed', (SELECT coalesce(sessions_completed, 0) FROM public.room_focus_timer WHERE room_id = _room_id));
END; $$;

REVOKE EXECUTE ON FUNCTION public.ensure_study_settings(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.study_precheck(uuid, text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_study_tables() FROM anon, authenticated;
