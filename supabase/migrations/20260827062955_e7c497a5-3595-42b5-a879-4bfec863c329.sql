CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.push_dispatch_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  endpoint text NOT NULL,
  secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.push_dispatch_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_dispatch_config TO service_role;
ALTER TABLE public.push_dispatch_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.push_dispatch_config (id, endpoint, secret)
VALUES (true, 'https://together-rooms.lovable.app/api/public/push/dispatch',
        'd72ad4c077b13f307c93d228698c87b739026b646e38df5995f13d5051df5d9e')
ON CONFLICT (id) DO UPDATE
  SET endpoint = EXCLUDED.endpoint, secret = EXCLUDED.secret, updated_at = now();

CREATE OR REPLACE FUNCTION public.tg_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cfg public.push_dispatch_config%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.push_dispatch_config WHERE id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM extensions.net_http_post(
    url := cfg.endpoint,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || cfg.secret
    ),
    body := jsonb_build_object('notification_id', NEW.id),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Push delivery must never block the in-app notification write.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_dispatch_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_dispatch_push ON public.notifications;
CREATE TRIGGER tg_dispatch_push
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.tg_dispatch_push();