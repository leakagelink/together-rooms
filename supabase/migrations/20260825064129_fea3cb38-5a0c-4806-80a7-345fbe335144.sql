-- PHASE 12: billing acknowledgement recovery + reconciliation ledger.
-- Both tables are operational infrastructure written only by trusted server
-- code (service_role). No client role may read or write them, so there are no
-- anon/authenticated grants and no policies: RLS is enabled and denies all.

CREATE TABLE public.billing_ack_state (
  purchase_token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_ack_state_status_chk
    CHECK (status IN ('pending', 'acknowledged', 'not_required', 'failed_terminal'))
);

GRANT ALL ON public.billing_ack_state TO service_role;
ALTER TABLE public.billing_ack_state ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER billing_ack_state_updated_at
  BEFORE UPDATE ON public.billing_ack_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.billing_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger_source text NOT NULL DEFAULT 'cron',
  examined integer NOT NULL DEFAULT 0,
  repaired integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.billing_reconciliation_runs TO service_role;
ALTER TABLE public.billing_reconciliation_runs ENABLE ROW LEVEL SECURITY;

-- Index audit follow-ups (no redundant indexes; each backs a real query):
--  1. resolving the owning account for a purchase token takes the newest event
--     for that token — the existing index is not ordered, forcing a sort.
CREATE INDEX idx_sub_events_token_time
  ON public.subscription_events (purchase_token_hash, event_time DESC);

--  2. the acknowledgement worker scans only rows that are due.
CREATE INDEX idx_billing_ack_due
  ON public.billing_ack_state (next_attempt_at)
  WHERE status = 'pending';

--  3. operational visibility of notifications that could not be processed.
CREATE INDEX idx_rtdn_outcome_time
  ON public.play_rtdn_messages (outcome, received_at DESC);