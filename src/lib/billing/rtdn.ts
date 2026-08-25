/**
 * PHASE 11 — Real-time Developer Notifications (RTDN) decoding and ordering.
 *
 * Everything here is PURE: decoding, validation, and the ordering rules. The
 * payload is untrusted input arriving over the public internet, so:
 *
 *  - a malformed envelope is rejected before anything is looked up,
 *  - the notification is treated ONLY as a trigger — the authoritative state
 *    always comes from a fresh Google Play Developer API verification,
 *  - message ids give exactly-once processing,
 *  - a stale/out-of-order notification can never overwrite newer verified state.
 */

export type RtdnDecodeFailure =
  | "malformed_envelope"
  | "missing_message_id"
  | "invalid_base64"
  | "invalid_json"
  | "unknown_payload"
  | "package_mismatch";

export type RtdnKind =
  | "subscription"
  | "voided_purchase"
  | "one_time_product"
  | "test";

export interface RtdnMessage {
  messageId: string;
  publishTime: string | null;
  packageName: string;
  kind: RtdnKind;
  /** Play's numeric notification type; null for test notifications. */
  notificationType: number | null;
  purchaseToken: string | null;
  subscriptionId: string | null;
  /** Millisecond event time from Play, used strictly for ordering. */
  eventTimeMillis: number | null;
}

export type RtdnDecodeResult =
  | { ok: true; message: RtdnMessage }
  | { ok: false; reason: RtdnDecodeFailure };

/** Subscription notification types (developer.android.com/google/play/billing). */
export const SUBSCRIPTION_NOTIFICATION = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  PRICE_CHANGE_CONFIRMED: 8,
  DEFERRED: 9,
  PAUSED: 10,
  PAUSE_SCHEDULE_CHANGED: 11,
  REVOKED: 12,
  EXPIRED: 13,
  PENDING_PURCHASE_CANCELED: 20,
} as const;

function decodeBase64(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Decodes a Pub/Sub push envelope into a normalized notification.
 * `expectedPackage` is our own application id: a notification for any other
 * package is rejected outright.
 */
export function decodeRtdnEnvelope(body: unknown, expectedPackage: string): RtdnDecodeResult {
  if (!body || typeof body !== "object") return { ok: false, reason: "malformed_envelope" };
  const envelope = body as Record<string, unknown>;
  const message = envelope["message"];
  if (!message || typeof message !== "object") return { ok: false, reason: "malformed_envelope" };
  const msg = message as Record<string, unknown>;

  const messageId = str(msg, "messageId") ?? str(msg, "message_id");
  if (!messageId) return { ok: false, reason: "missing_message_id" };

  const data = msg["data"];
  if (typeof data !== "string" || data.length === 0) {
    return { ok: false, reason: "invalid_base64" };
  }
  const decoded = decodeBase64(data);
  if (decoded === null) return { ok: false, reason: "invalid_base64" };

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object") return { ok: false, reason: "invalid_json" };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const packageName = str(payload, "packageName");
  if (!packageName) return { ok: false, reason: "unknown_payload" };
  if (packageName !== expectedPackage) return { ok: false, reason: "package_mismatch" };

  const rawEventTime = payload["eventTimeMillis"];
  const eventTimeMillis =
    typeof rawEventTime === "string" || typeof rawEventTime === "number"
      ? Number(rawEventTime)
      : null;

  const sub = payload["subscriptionNotification"];
  const voided = payload["voidedPurchaseNotification"];
  const oneTime = payload["oneTimeProductNotification"];
  const test = payload["testNotification"];

  const base = {
    messageId,
    publishTime: str(msg, "publishTime") ?? str(msg, "publish_time"),
    packageName,
    eventTimeMillis:
      eventTimeMillis !== null && Number.isFinite(eventTimeMillis) ? eventTimeMillis : null,
  };

  if (sub && typeof sub === "object") {
    const s = sub as Record<string, unknown>;
    const type = typeof s["notificationType"] === "number" ? (s["notificationType"] as number) : null;
    const token = str(s, "purchaseToken");
    if (type === null || !token) return { ok: false, reason: "unknown_payload" };
    return {
      ok: true,
      message: {
        ...base,
        kind: "subscription",
        notificationType: type,
        purchaseToken: token,
        subscriptionId: str(s, "subscriptionId"),
      },
    };
  }

  if (voided && typeof voided === "object") {
    const v = voided as Record<string, unknown>;
    const token = str(v, "purchaseToken");
    if (!token) return { ok: false, reason: "unknown_payload" };
    return {
      ok: true,
      message: {
        ...base,
        kind: "voided_purchase",
        notificationType: null,
        purchaseToken: token,
        subscriptionId: null,
      },
    };
  }

  if (oneTime && typeof oneTime === "object") {
    const o = oneTime as Record<string, unknown>;
    return {
      ok: true,
      message: {
        ...base,
        kind: "one_time_product",
        notificationType:
          typeof o["notificationType"] === "number" ? (o["notificationType"] as number) : null,
        purchaseToken: str(o, "purchaseToken"),
        subscriptionId: str(o, "sku"),
      },
    };
  }

  if (test && typeof test === "object") {
    return {
      ok: true,
      message: {
        ...base,
        kind: "test",
        notificationType: null,
        purchaseToken: null,
        subscriptionId: null,
      },
    };
  }

  return { ok: false, reason: "unknown_payload" };
}

/**
 * What we do with a decoded notification.
 *
 * `verify` means: call the Play Developer API for the current authoritative
 * state and apply THAT — never the notification's own claim. Only a
 * voided-purchase notification carries a state we act on directly, and even
 * then the resulting event is ordered and idempotent in the database.
 */
export type RtdnAction =
  | { action: "verify"; reason: string }
  | { action: "revoke"; reason: string }
  | { action: "ignore"; reason: string };

export function planRtdnAction(message: RtdnMessage): RtdnAction {
  if (message.kind === "test") return { action: "ignore", reason: "test_notification" };
  if (message.kind === "one_time_product") {
    return { action: "ignore", reason: "no_one_time_products" };
  }
  if (message.kind === "voided_purchase") {
    return { action: "revoke", reason: "voided_purchase" };
  }
  if (!message.purchaseToken) return { action: "ignore", reason: "no_purchase_token" };
  // Every subscription lifecycle type resolves to the same safe behaviour:
  // ask Google what the truth is right now.
  return { action: "verify", reason: `subscription_notification_${message.notificationType}` };
}

/**
 * Ordering key. Play's `eventTimeMillis` is authoritative for ordering; the
 * database additionally refuses any event whose sequence is lower than the
 * entitlement's current sequence, so a delayed notification is inert.
 */
export function rtdnEventSeq(message: RtdnMessage): number {
  if (message.eventTimeMillis !== null) return Math.floor(message.eventTimeMillis / 1000);
  if (message.publishTime) {
    const parsed = Date.parse(message.publishTime);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return 0;
}

/**
 * Pure ordering rule mirrored by the database: an event may only be applied
 * when its sequence is at least the current authoritative sequence.
 */
export function isStaleEvent(currentSeq: number, incomingSeq: number): boolean {
  return incomingSeq < currentSeq;
}
