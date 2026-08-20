CREATE OR REPLACE FUNCTION public.export_user_data()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid UUID := auth.uid();
  _cap CONSTANT INTEGER := 1000;
  _out JSONB;
  _truncated JSONB;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT jsonb_build_object(
    'rooms_owned', (SELECT count(*) FROM public.rooms WHERE owner_id = _uid),
    'memberships', (SELECT count(*) FROM public.room_members WHERE user_id = _uid),
    'blocks', (SELECT count(*) FROM public.user_blocks WHERE blocker_id = _uid),
    'reports_submitted', (SELECT count(*) FROM public.user_reports WHERE reporter_id = _uid),
    'analytics_events', (SELECT count(*) FROM public.analytics_events WHERE user_id = _uid)
  ) INTO _truncated;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'schema_version', 2,
    'user_id', _uid,
    'limits', jsonb_build_object('per_collection_max', _cap, 'total_counts', _truncated),
    'profile', (SELECT to_jsonb(p) - 'subscription_tier' FROM public.profiles p WHERE p.id = _uid),
    'settings', (SELECT to_jsonb(s) FROM public.user_settings s WHERE s.user_id = _uid),
    'privacy_settings', (SELECT to_jsonb(ps) FROM public.privacy_settings ps WHERE ps.user_id = _uid),
    'entitlement', (SELECT jsonb_build_object('plan', e.plan, 'status', e.status, 'expires_at', e.expires_at)
                      FROM public.entitlements e WHERE e.user_id = _uid),
    'rooms_owned', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('id', r.id, 'name', r.name, 'type', r.type, 'status', r.status,
                                  'created_at', r.created_at, 'ended_at', r.ended_at) AS x
          FROM public.rooms r WHERE r.owner_id = _uid
         ORDER BY r.created_at DESC LIMIT _cap) s), '[]'::jsonb),
    'memberships', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('room_id', m.room_id, 'role', m.role, 'status', m.status,
                                  'joined_at', m.joined_at, 'left_at', m.left_at) AS x
          FROM public.room_members m WHERE m.user_id = _uid
         ORDER BY m.joined_at DESC LIMIT _cap) s), '[]'::jsonb),
    'blocks', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('blocked_id', b.blocked_id, 'created_at', b.created_at) AS x
          FROM public.user_blocks b WHERE b.blocker_id = _uid
         ORDER BY b.created_at DESC LIMIT _cap) s), '[]'::jsonb),
    'reports_submitted', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('id', ur.id, 'target_type', ur.target_type, 'category', ur.category,
                                  'details', ur.details, 'status', ur.status, 'created_at', ur.created_at) AS x
          FROM public.user_reports ur WHERE ur.reporter_id = _uid
         ORDER BY ur.created_at DESC LIMIT _cap) s), '[]'::jsonb),
    'analytics_events', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', ae.name, 'properties', ae.properties, 'created_at', ae.created_at) AS x
          FROM public.analytics_events ae WHERE ae.user_id = _uid
         ORDER BY ae.created_at DESC LIMIT _cap) s), '[]'::jsonb)
  ) INTO _out;

  RETURN _out;
END; $$;