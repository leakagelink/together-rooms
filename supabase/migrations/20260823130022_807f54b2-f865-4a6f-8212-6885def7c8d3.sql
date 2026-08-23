-- PHASE 9 (step 1/2): new entitlement lifecycle states and sources.
-- Enum values must be committed before any later statement can reference them.
ALTER TYPE public.entitlement_status ADD VALUE IF NOT EXISTS 'grace_period';
ALTER TYPE public.entitlement_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE public.entitlement_source ADD VALUE IF NOT EXISTS 'admin_grant';
ALTER TYPE public.entitlement_source ADD VALUE IF NOT EXISTS 'play_billing';