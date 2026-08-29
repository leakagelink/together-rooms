CREATE OR REPLACE FUNCTION public.count_recent_open_rooms(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
    FROM public.rooms
   WHERE owner_id = _user_id
     AND created_at > now() - interval '24 hours'
     AND status NOT IN ('ended', 'archived')
     AND ended_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
$$;

REVOKE ALL ON FUNCTION public.count_recent_open_rooms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_recent_open_rooms(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ad_access_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  r public.user_ad_access;
  rooms_recent integer;
  unlocked boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  r := public.ad_access_refresh(uid);
  rooms_recent := public.count_recent_open_rooms(uid);
  unlocked := r.unlock_expires_at IS NOT NULL AND r.unlock_expires_at > now();

  RETURN jsonb_build_object(
    'ok', true,
    'rewarded_today', r.rewarded_today,
    'daily_ad_limit', 10,
    'ads_remaining_today', greatest(0, 10 - r.rewarded_today),
    'unlock_progress', r.unlock_progress,
    'unlock_required', 3,
    'unlocked', unlocked,
    'unlock_expires_at', r.unlock_expires_at,
    'room_credits', r.room_credits,
    'rooms_created_24h', rooms_recent,
    'free_rooms_per_day', 1,
    'can_create_room', unlocked OR rooms_recent < 1 OR r.room_credits > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ad_access_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ad_access_snapshot() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_room_creation_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  r public.user_ad_access;
  rooms_recent integer;
BEGIN
  IF uid IS NULL OR NEW.owner_id IS DISTINCT FROM uid THEN
    RETURN NEW;
  END IF;

  r := public.ad_access_refresh(uid);

  IF r.unlock_expires_at IS NOT NULL AND r.unlock_expires_at > now() THEN
    RETURN NEW;
  END IF;

  rooms_recent := public.count_recent_open_rooms(uid);

  IF rooms_recent < 1 THEN
    RETURN NEW;
  END IF;

  IF r.room_credits > 0 THEN
    UPDATE public.user_ad_access
       SET room_credits = room_credits - 1,
           updated_at = now()
     WHERE user_id = uid;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'room_quota_exhausted'
    USING ERRCODE = 'check_violation',
          HINT = 'Watch a rewarded ad to create another room today.';
END;
$$;