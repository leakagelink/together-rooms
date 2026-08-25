import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc } from "@/lib/server/rpc.server";
import type { Json } from "@/lib/rpc-types";
import type { EntitlementSnapshot } from "@/lib/entitlements";

/**
 * PHASE 9 — monetization server functions.
 *
 * Entitlement decisions are made in Postgres; purchase verification is made
 * against Google Play. The client contributes *claims* only (a product id and
 * a purchase token) and can never assert a plan, a status or an expiry.
 *
 * Verification is fail-closed: an unverifiable purchase results in no
 * entitlement change at all.
 */

const productId = z.string().trim().min(3).max(120);
const purchaseToken = z.string().trim().min(10).max(4096);

export type EntitlementResult = EntitlementSnapshot & { ok: true };

export const getMyEntitlement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("my_entitlement");
    return normalizeRpc<EntitlementSnapshot>("my_entitlement", data, error);
  });

export const checkPremiumFeature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        feature: z.enum(["ad_free", "premium_capacity", "extended_call", "extended_local_media"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("entitlement_precheck", {
      _feature: data.feature,
    });
    return normalizeRpc<{ entitlement: EntitlementSnapshot }>(
      "entitlement_precheck",
      result,
      error,
    );
  });

export const getSubscriptionHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("my_subscription_events", { _limit: 20 });
    return normalizeRpc<{
      events: {
        event_type: string;
        event_time: string;
        product_id: string | null;
        outcome: string;
        applied: boolean;
      }[];
    }>("my_subscription_events", data, error);
  });

export const listSubscriptionProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("subscription_products")
      .select("id, base_plan_id, offer_id, period, entitlement_key, sort_order")
      .eq("is_active", true)
      .eq("platform", "google_play")
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("[list_subscription_products]", error.message);
      return { ok: false as const, reason: "server_error" as const };
    }
    return { ok: true as const, products: data ?? [] };
  });

/** Remote ad frequency/config row. Never contains secrets. */
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

/** Premium-gated room capacity change (server re-checks the entitlement). */
export const setRoomCapacity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ room_id: z.string().uuid(), max_members: z.number().int().min(2).max(50) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_room_capacity", {
      _room_id: data.room_id,
      _max_members: data.max_members,
    });
    return normalizeRpc<{ max_members: number }>("set_room_capacity", result, error);
  });

type ApplyOutcome = {
  ok: boolean;
  reason?: string;
  outcome?: string;
  entitlement?: EntitlementSnapshot;
};

/**
 * Verifies one purchase claim with Google Play and applies the resulting
 * billing event exactly once. The admin client is loaded INSIDE the handler
 * and used only after the caller has been authenticated, and only to write the
 * event for that caller's own user id.
 */
async function verifyAndApply(
  supabase: { rpc: (fn: never, args: never) => unknown },
  userId: string,
  claim: { product_id: string; purchase_token: string },
): Promise<ApplyOutcome> {
  const { verifyPlayPurchase, eventTypeFor } = await import("@/lib/billing/verification.server");
  const verification = await verifyPlayPurchase(claim.product_id, claim.purchase_token);

  if (!verification.ok) {
    // Fail-closed. Record the attempt so support can see it, but grant nothing.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("apply_billing_event", {
      _user_id: userId,
      _event_type: "verification_failed",
      _provider: "google_play",
      _product_id: claim.product_id,
      _purchase_token: claim.purchase_token,
      _metadata: { reason: verification.reason },
    });
    return { ok: false, reason: verification.reason };
  }

  const verified = verification.result;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("apply_billing_event", {
    _user_id: userId,
    _event_type: eventTypeFor(verified),
    _provider: "google_play",
    _product_id: verified.productId,
    _purchase_token: claim.purchase_token,
    _event_seq: verified.eventSeq,
    _cancel_at_period_end: !verified.autoRenewing,
    ...(verified.expiresAt ? { _expires_at: verified.expiresAt } : {}),
    ...(verified.graceUntil ? { _grace_until: verified.graceUntil } : {}),
  });
  if (error) {
    console.error("[apply_billing_event]", error.message);
    return { ok: false, reason: "server_error" };
  }

  // Acknowledge only AFTER the entitlement was actually granted. Play refunds
  // an unacknowledged purchase after three days, so acknowledgement is the
  // server's confirmation that the user really received what they paid for.
  // A failed acknowledgement never affects the entitlement; the next
  // verification or renewal notification retries it.
  const { acknowledgePlaySubscription, shouldAcknowledge } = await import(
    "@/lib/billing/verification.server"
  );
  if (shouldAcknowledge(verified)) {
    const ack = await acknowledgePlaySubscription(claim.purchase_token, verified);
    if (!ack.ok) console.warn("[acknowledge_purchase] failed:", ack.reason);
  }

  return (data ?? { ok: false, reason: "server_error" }) as unknown as ApplyOutcome;
}


export const verifyPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ product_id: productId, purchase_token: purchaseToken }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("consume_rate_limit", {
      _action: "verify_purchase",
      _limit: 20,
      _window_seconds: 300,
    });
    if (allowed === false) return { ok: false as const, reason: "rate_limited" as const };

    return verifyAndApply(context.supabase as never, context.userId, data);
  });

/**
 * Restore flow: re-verifies every purchase Play reports for this device and
 * reconciles the entitlement. Out-of-order or stale events are ignored by the
 * database, so a restore can never downgrade a newer state.
 */
export const restorePurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchases: z
          .array(z.object({ product_id: productId, purchase_token: purchaseToken }))
          .max(10),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("consume_rate_limit", {
      _action: "restore_purchases",
      _limit: 10,
      _window_seconds: 600,
    });
    if (allowed === false) return { ok: false as const, reason: "rate_limited" as const };

    let applied = 0;
    for (const claim of data.purchases) {
      const outcome = await verifyAndApply(context.supabase as never, context.userId, claim);
      if (outcome.ok) applied += 1;
    }

    const { data: snapshot, error } = await context.supabase.rpc("my_entitlement");
    if (error) return { ok: false as const, reason: "server_error" as const };
    return { ok: true as const, applied, entitlement: snapshot as unknown as EntitlementSnapshot };
  });

/* ------------------------------ staff surface ----------------------------- */

export const adminSubscriptionOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("admin_subscription_overview", {
      _user_id: data.user_id,
    });
    return normalizeRpc<{ entitlement: EntitlementSnapshot; events: Json[] }>(
      "admin_subscription_overview",
      result,
      error,
    );
  });

export const adminGrantEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        reason: z.string().trim().min(5).max(300),
        expires_at: z.string().datetime().nullable().optional(),
        revoke: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("admin_grant_entitlement", {
      _user_id: data.user_id,
      _reason: data.reason,
      ...(data.expires_at ? { _expires_at: data.expires_at } : {}),
      ...(data.revoke ? { _revoke: true } : {}),
    });
    return normalizeRpc<{ entitlement: EntitlementSnapshot }>(
      "admin_grant_entitlement",
      result,
      error,
    );
  });
