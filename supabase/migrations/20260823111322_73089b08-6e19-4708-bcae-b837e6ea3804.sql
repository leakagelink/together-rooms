-- Phase 7 fix: issue/verify transport grants without the pgcrypto extension.
-- gen_random_bytes() and digest() live in pgcrypto, which is not installed;
-- gen_random_uuid() and sha256() are built into Postgres.

CREATE OR REPLACE FUNCTION public.issue_local_media_transport_grant(_session_id UUID)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _row public.room_local_media_sessions%ROWTYPE;
        _pre jsonb; _token TEXT; _role TEXT; _exp TIMESTAMPTZ;
        _settings public.room_local_media_settings%ROWTYPE;
BEGIN
  PERFORM public.sweep_local_media();
  SELECT * INTO _row FROM public.room_local_media_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  _pre := public.local_media_precheck(_row.room_id, 'local_media_grant', 30, 300);
  IF _pre IS NOT NULL THEN RETURN _pre; END IF;

  IF _row.status <> 'active' OR _row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;
  IF public.is_blocked_between(_uid, _row.owner_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  _settings := public.ensure_local_media_settings(_row.room_id);
  _role := CASE WHEN _row.owner_id = _uid THEN 'owner' ELSE 'viewer' END;
  -- 64 hex characters of server-side randomness.
  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  _exp := least(now() + interval '5 minutes', _row.expires_at);

  PERFORM set_config('app.local_media_ctx', '1', true);
  UPDATE public.local_media_transport_grants SET revoked_at = now()
   WHERE session_id = _session_id AND user_id = _uid AND revoked_at IS NULL;
  INSERT INTO public.local_media_transport_grants(
    session_id, room_id, user_id, grant_role, token_hash, relay_allowed, expires_at)
  VALUES (_session_id, _row.room_id, _uid, _role,
          encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _settings.allow_relay, _exp);
  PERFORM set_config('app.local_media_ctx', '0', true);

  RETURN jsonb_build_object('ok', true, 'token', _token, 'role', _role,
    'relay_allowed', _settings.allow_relay, 'expires_at', _exp,
    'ttl_seconds', greatest(0, floor(extract(epoch FROM (_exp - now()))))::int);
END; $$;

CREATE OR REPLACE FUNCTION public.verify_local_media_grant(_session_id UUID, _token TEXT)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _id UUID;
BEGIN
  IF _uid IS NULL OR _token IS NULL OR length(_token) < 32 THEN RETURN NULL; END IF;
  SELECT g.id INTO _id
    FROM public.local_media_transport_grants g
    JOIN public.room_local_media_sessions s ON s.id = g.session_id
   WHERE g.session_id = _session_id
     AND g.user_id = _uid
     AND g.revoked_at IS NULL
     AND g.expires_at > now()
     AND g.token_hash = encode(sha256(convert_to(_token, 'UTF8')), 'hex')
     AND s.status = 'active'
     AND s.expires_at > now()
     -- Membership is re-checked on every use, so revocation takes effect at once.
     AND EXISTS (SELECT 1 FROM public.room_members m
                  WHERE m.room_id = s.room_id AND m.user_id = _uid AND m.status = 'joined')
   LIMIT 1;
  RETURN _id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.verify_local_media_grant(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_local_media_transport_grant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_local_media_transport_grant(uuid) TO authenticated;