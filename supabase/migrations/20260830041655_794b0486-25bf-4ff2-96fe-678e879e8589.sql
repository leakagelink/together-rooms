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

  SELECT coalesce(jsonb_agg(x ORDER BY created_at DESC), '[]'::jsonb)
    INTO _rows
  FROM (
    SELECT a.created_at,
           jsonb_build_object(
             'id', a.id,
             'created_at', a.created_at,
             'metadata', a.metadata,
             'actor_name', p.display_name
           ) AS x
      FROM public.audit_logs a
      LEFT JOIN public.profiles p ON p.id = a.actor_id
     WHERE a.action = 'admin.broadcast'
     ORDER BY a.created_at DESC
     LIMIT least(greatest(coalesce(_limit, 20), 1), 100)
  ) s;

  RETURN jsonb_build_object('ok', true, 'rows', _rows);
END; $$;

REVOKE ALL ON FUNCTION public.admin_recent_broadcasts(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_recent_broadcasts(integer) TO authenticated;