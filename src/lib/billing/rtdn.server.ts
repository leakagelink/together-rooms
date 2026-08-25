/**
 * PHASE 11 — RTDN processing (server-only).
 *
 * The webhook handler does authentication and decoding; this module owns what
 * actually happens to entitlements. Invariants:
 *
 *  1. The notification is a TRIGGER, never a source of truth. Subscription
 *     notifications cause a fresh Play Developer API verification and the
 *     verified state is what gets applied.
 *  2. Exactly-once: the Pub/Sub message id is claimed in `play_rtdn_messages`
 *     before any work happens. A redelivery short-circuits.
 *  3. Ordering: every applied event carries Play's event time as its sequence,
 *     and `apply_billing_event` refuses sequences older than the entitlement's.
 *  4. Unknown purchase tokens are recorded and ignored — never guessed at.
 */
import { createHash } from "node:crypto";

import { planRtdnAction, rtdnEventSeq, type RtdnMessage } from "./rtdn";
import { mapVerificationToEvent, verifyPlayPurchase } from "./verification.server";

export type RtdnOutcome =
  | "duplicate"
  | "ignored"
  | "applied"
  | "unknown_token"
  | "verification_failed"
  | "revoked"
  | "not_voided"
  | "error";

export interface RtdnProcessResult {
  outcome: RtdnOutcome;
  detail?: string;
}

export function hashPurchaseToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Minimal structural view of the admin client. Kept deliberately narrow so the
 * processing rules can be reasoned about (and tested) without the full
 * PostgREST type surface.
 */
type QueryResult = Promise<{ data: unknown; error: unknown }>;
interface AdminTable {
  insert(values: Record<string, unknown>): QueryResult;
  update(values: Record<string, unknown>): { eq(column: string, value: string): QueryResult };
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): {
      order(column: string, options: { ascending: boolean }): { limit(n: number): QueryResult };
    };
  };
}
type AdminClient = {
  from: (table: string) => AdminTable;
  rpc: (fn: string, args: Record<string, unknown>) => QueryResult;
};

/**
 * Claims the message id. Returns false when this message was already seen,
 * which makes redelivery — Pub/Sub guarantees at-least-once — a no-op.
 */
async function claimMessage(
  admin: AdminClient,
  message: RtdnMessage,
  tokenHash: string | null,
): Promise<boolean> {
  const { error } = await admin.from("play_rtdn_messages").insert({
    message_id: message.messageId,
    kind: message.kind,
    notification_type: message.notificationType,
    purchase_token_hash: tokenHash,
    event_seq: rtdnEventSeq(message),
    publish_time: message.publishTime,
  });
  return !error;
}

async function finish(
  admin: AdminClient,
  messageId: string,
  result: RtdnProcessResult,
): Promise<RtdnProcessResult> {
  await admin
    .from("play_rtdn_messages")
    .update({
      processed_at: new Date().toISOString(),
      outcome: result.outcome,
      detail: result.detail ? { detail: result.detail } : {},
    })
    .eq("message_id", messageId);
  return result;
}

/** Resolves the account a purchase token belongs to, from prior verified events. */
async function findUserForToken(admin: AdminClient, tokenHash: string): Promise<string | null> {
  const { data } = await admin
    .from("subscription_events")
    .select("user_id")
    .eq("purchase_token_hash", tokenHash)
    .order("event_time", { ascending: false })
    .limit(1);
  const rows = (data ?? []) as { user_id: string }[];
  return rows[0]?.user_id ?? null;
}

export async function processRtdnMessage(
  admin: AdminClient,
  message: RtdnMessage,
): Promise<RtdnProcessResult> {
  const tokenHash = message.purchaseToken ? hashPurchaseToken(message.purchaseToken) : null;

  if (!(await claimMessage(admin, message, tokenHash))) {
    return { outcome: "duplicate" };
  }

  const plan = planRtdnAction(message);
  if (plan.action === "ignore") {
    return finish(admin, message.messageId, { outcome: "ignored", detail: plan.reason });
  }

  if (!message.purchaseToken || !tokenHash) {
    return finish(admin, message.messageId, { outcome: "ignored", detail: "no_purchase_token" });
  }

  const userId = await findUserForToken(admin, tokenHash);
  if (!userId) {
    // A token we have never verified belongs to no account here. It is recorded
    // for support and dropped; we never guess an owner.
    return finish(admin, message.messageId, { outcome: "unknown_token" });
  }

  const eventSeq = rtdnEventSeq(message);

  if (plan.action === "revoke") {
    // Only Google's voided-purchases list may cause a revocation.
    const { isVoidedPurchase } = await import("./verification.server");
    const voided = await isVoidedPurchase(message.purchaseToken);
    if (voided !== true) {
      return finish(admin, message.messageId, {
        outcome: voided === null ? "error" : "not_voided",
        detail: "voided_purchase_unconfirmed",
      });
    }
    const { error } = await admin.rpc("apply_billing_event", {
      _user_id: userId,
      _event_type: "revoked",
      _provider: "google_play",
      _purchase_token: message.purchaseToken,
      _event_seq: eventSeq,
      _metadata: { source: "rtdn", message_id: message.messageId },
    });
    return finish(admin, message.messageId, {
      outcome: error ? "error" : "revoked",
    });
  }

  // Subscription notification: ask Play for the authoritative state.
  const productId = message.subscriptionId;
  if (!productId) {
    return finish(admin, message.messageId, { outcome: "ignored", detail: "no_product_id" });
  }
  const verification = await verifyPlayPurchase(productId, message.purchaseToken);
  if (!verification.ok) {
    await admin.rpc("apply_billing_event", {
      _user_id: userId,
      _event_type: "verification_failed",
      _provider: "google_play",
      _product_id: productId,
      _purchase_token: message.purchaseToken,
      _event_seq: eventSeq,
      _metadata: { source: "rtdn", reason: verification.reason, message_id: message.messageId },
    });
    return finish(admin, message.messageId, {
      outcome: "verification_failed",
      detail: verification.reason,
    });
  }

  const event = mapVerificationToEvent(verification.result);
  const { error } = await admin.rpc("apply_billing_event", {
    _user_id: userId,
    _event_type: event.eventType,
    _provider: "google_play",
    _product_id: verification.result.productId,
    _purchase_token: message.purchaseToken,
    _event_seq: Math.max(eventSeq, event.eventSeq ?? 0),
    _expires_at: event.expiresAt,
    _grace_until: event.graceUntil,
    _cancel_at_period_end: event.cancelAtPeriodEnd,
    _metadata: { source: "rtdn", message_id: message.messageId },
  });
  return finish(admin, message.messageId, { outcome: error ? "error" : "applied" });
}
