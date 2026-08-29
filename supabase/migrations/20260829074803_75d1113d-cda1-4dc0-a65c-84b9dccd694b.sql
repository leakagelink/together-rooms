CREATE TABLE IF NOT EXISTS public.user_ad_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  rewarded_today integer NOT NULL DEFAULT 0,
  unlock_progress integer NOT NULL DEFAULT 0,
  unlock_expires_at timestamp with time zone,
  room_credits integer NOT NULL DEFAULT 0,
  last_reward_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_ad_access TO authenticated;
GRANT ALL ON public.user_ad_access TO service_role;

ALTER TABLE public.user_ad_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_ad_access_select_own" ON public.user_ad_access;
CREATE POLICY "user_ad_access_select_own"
  ON public.user_ad_access FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.ad_access_refresh(_user_id uuid)
RETURNS public.user_ad_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.user_ad_access;
BEGIN
  INSERT INTO public.user_ad_access (user_id) VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.user_ad_access
     SET day = (now() AT TIME ZONE 'utc')::date,
         rewarded_today = 0,
         updated_at = now()
   WHERE user_id = _user_id
     AND day <> (now() AT TIME ZONE 'utc')::date;

  UPDATE public.user_ad_access
     SET unlock_expires_at = NULL,
         unlock_progress = 0,
         updated_at = now()
   WHERE user_id = _user_id
     AND unlock_expires_at IS NOT NULL
     AND unlock_expires_at <= now();

  SELECT * INTO r FROM public.user_ad_access WHERE user_id = _user_id;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.ad_access_refresh(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ad_access_refresh(uuid) TO service_role;

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

  SELECT count(*) INTO rooms_recent
    FROM public.rooms
   WHERE owner_id = uid
     AND created_at > now() - interval '24 hours';

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

CREATE OR REPLACE FUNCTION public.claim_rewarded_view(_purpose text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  r public.user_ad_access;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;
  IF _purpose IS NULL OR _purpose NOT IN ('unlock', 'extra_room') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_purpose');
  END IF;
  IF NOT public.account_is_active(uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  r := public.ad_access_refresh(uid);

  IF r.last_reward_at IS NOT NULL AND r.last_reward_at > now() - interval '10 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  IF r.rewarded_today >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_ad_limit_reached');
  END IF;

  IF _purpose = 'unlock' THEN
    UPDATE public.user_ad_access
       SET rewarded_today = rewarded_today + 1,
           unlock_progress = LEAST(unlock_progress + 1, 3),
           last_reward_at = now(),
           updated_at = now()
     WHERE user_id = uid
     RETURNING * INTO r;

    IF r.unlock_progress >= 3 AND (r.unlock_expires_at IS NULL OR r.unlock_expires_at <= now()) THEN
      UPDATE public.user_ad_access
         SET unlock_expires_at = now() + interval '24 hours',
             updated_at = now()
       WHERE user_id = uid;
    END IF;
  ELSE
    UPDATE public.user_ad_access
       SET rewarded_today = rewarded_today + 1,
           room_credits = LEAST(room_credits + 1, 10),
           last_reward_at = now(),
           updated_at = now()
     WHERE user_id = uid;
  END IF;

  RETURN public.ad_access_snapshot();
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rewarded_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_rewarded_view(text) TO authenticated;

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

  SELECT count(*) INTO rooms_recent
    FROM public.rooms
   WHERE owner_id = uid
     AND created_at > now() - interval '24 hours';

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

DROP TRIGGER IF EXISTS trg_enforce_room_creation_quota ON public.rooms;
CREATE TRIGGER trg_enforce_room_creation_quota
  BEFORE INSERT ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_creation_quota();