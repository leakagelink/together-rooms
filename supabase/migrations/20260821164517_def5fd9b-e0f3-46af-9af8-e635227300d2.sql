-- Attempt real retention enforcement (Blocker 7, Option A) with a safe fallback.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable: %', SQLERRM;
    RETURN;
  END;

  BEGIN
    PERFORM cron.unschedule('synctogether-purge-expired-chat');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM cron.schedule(
      'synctogether-purge-expired-chat',
      '7 * * * *',
      $job$SELECT public.purge_expired_chat();$job$
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'cron.schedule unavailable: %', SQLERRM;
  END;
END $$;

-- purge_expired_chat is internal maintenance only: never user-invokable.
REVOKE ALL ON FUNCTION public.purge_expired_chat() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_chat() FROM anon;
REVOKE ALL ON FUNCTION public.purge_expired_chat() FROM authenticated;