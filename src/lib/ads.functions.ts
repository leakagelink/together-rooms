import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc } from "@/lib/server/rpc.server";
import { PRODUCT_LIMITS } from "@/lib/entitlements";

/**
 * PHASE 15 — the app is free, so this module carries no purchase, entitlement
 * or subscription surface at all. What remains is the ad runtime configuration
 * (frequency caps, kill switches) and room capacity, which is an anti-abuse
 * limit re-checked in Postgres.
 */

export const getAdRuntimeConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("ad_config").select("config").maybeSingle();
    if (error) {
      console.error("[ad_config]", error.message);
      // Fail-safe: caller falls back to conservative defaults.
      return { ok: false as const, reason: "server_error" as const };
    }
    return { ok: true as const, config: data?.config ?? null };
  });

/**
 * Room capacity change. The ceiling is a product-wide anti-abuse limit, not a
 * paid feature: `public.set_room_capacity` clamps it again server-side.
 */
export const setRoomCapacity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: z.string().uuid(),
        max_members: z.number().int().min(2).max(PRODUCT_LIMITS.max_room_members),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_room_capacity", {
      _room_id: data.room_id,
      _max_members: data.max_members,
    });
    return normalizeRpc<{ max_members: number }>("set_room_capacity", result, error);
  });
