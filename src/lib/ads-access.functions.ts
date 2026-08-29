import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Rewarded-ad access state.
 *
 * The SERVER is the only authority here. The device can report that a rewarded
 * ad finished, but the daily cap (10/day), the pacing and the reward itself are
 * decided in Postgres (public.claim_rewarded_view), so a tampered client can
 * never grant itself more than the policy allows.
 */
export interface AdAccessState {
  ok: boolean;
  rewarded_today: number;
  daily_ad_limit: number;
  ads_remaining_today: number;
  unlock_progress: number;
  unlock_required: number;
  unlocked: boolean;
  unlock_expires_at: string | null;
  room_credits: number;
  rooms_created_24h: number;
  free_rooms_per_day: number;
  can_create_room: boolean;
  reason?: string;
}

export const FALLBACK_AD_ACCESS: AdAccessState = {
  ok: false,
  rewarded_today: 0,
  daily_ad_limit: 10,
  ads_remaining_today: 10,
  unlock_progress: 0,
  unlock_required: 3,
  unlocked: false,
  unlock_expires_at: null,
  room_credits: 0,
  rooms_created_24h: 0,
  free_rooms_per_day: 1,
  can_create_room: true,
};

function normalize(raw: unknown): AdAccessState {
  if (!raw || typeof raw !== "object") return FALLBACK_AD_ACCESS;
  return { ...FALLBACK_AD_ACCESS, ...(raw as Partial<AdAccessState>) };
}

export const getAdAccessState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("ad_access_snapshot");
    if (error) {
      console.error("[ad_access_snapshot]", error.message);
      return FALLBACK_AD_ACCESS;
    }
    return normalize(data);
  });

/**
 * Records ONE completed rewarded view. Called only after the ads SDK reported
 * that the user actually earned the reward.
 */
export const claimRewardedView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ purpose: z.enum(["unlock", "extra_room"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("claim_rewarded_view", {
      _purpose: data.purpose,
    });
    if (error) {
      console.error("[claim_rewarded_view]", error.message);
      return { ...FALLBACK_AD_ACCESS, ok: false, reason: "server_error" };
    }
    return normalize(result);
  });
