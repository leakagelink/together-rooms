/**
 * PHASE 11 — RTDN-T1 … T8
 *
 * The webhook is publicly reachable, so these cover the decode, authentication
 * and ordering rules that stand between the internet and an entitlement.
 */
import { describe, expect, it } from "vitest";

import {
  decodeRtdnEnvelope,
  isStaleEvent,
  planRtdnAction,
  rtdnEventSeq,
  SUBSCRIPTION_NOTIFICATION,
  type RtdnMessage,
} from "./rtdn";
import { validateOidcClaims } from "./google-oidc.server";

const PACKAGE = "com.synctogether.com";

const envelope = (payload: unknown, messageId = "msg-1") => ({
  message: {
    messageId,
    publishTime: "2026-01-01T00:00:00.000Z",
    data: Buffer.from(JSON.stringify(payload)).toString("base64"),
  },
});

const subscriptionPayload = (type: number, token = "tok-1") => ({
  version: "1.0",
  packageName: PACKAGE,
  eventTimeMillis: "1767225600000",
  subscriptionNotification: {
    version: "1.0",
    notificationType: type,
    purchaseToken: token,
    subscriptionId: "premium_monthly",
  },
});

const message = (patch: Partial<RtdnMessage> = {}): RtdnMessage => ({
  messageId: "msg-1",
  publishTime: "2026-01-01T00:00:00.000Z",
  packageName: PACKAGE,
  kind: "subscription",
  notificationType: SUBSCRIPTION_NOTIFICATION.RENEWED,
  purchaseToken: "tok-1",
  subscriptionId: "premium_monthly",
  eventTimeMillis: 1767225600000,
  ...patch,
});

const claims = (patch: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: "https://together-rooms.lovable.app/api/public/billing/rtdn",
  email: "play-rtdn@synctogether.iam.gserviceaccount.com",
  email_verified: true,
  iat: 1767225600,
  exp: 1767229200,
  ...patch,
});

const AUD = "https://together-rooms.lovable.app/api/public/billing/rtdn";
const EMAIL = "play-rtdn@synctogether.iam.gserviceaccount.com";
const NOW = 1767225700_000;

describe("RTDN", () => {
  it("RTDN-T1: a well-formed subscription notification decodes", () => {
    const result = decodeRtdnEnvelope(
      envelope(subscriptionPayload(SUBSCRIPTION_NOTIFICATION.RENEWED)),
      PACKAGE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.purchaseToken).toBe("tok-1");
    expect(result.message.subscriptionId).toBe("premium_monthly");
  });

  it("RTDN-T2: a notification for another package is rejected", () => {
    const payload = { ...subscriptionPayload(2), packageName: "com.attacker.app" };
    const result = decodeRtdnEnvelope(envelope(payload), PACKAGE);
    expect(result).toEqual({ ok: false, reason: "package_mismatch" });
  });

  it("RTDN-T3: malformed envelopes and payloads never decode", () => {
    expect(decodeRtdnEnvelope(null, PACKAGE).ok).toBe(false);
    expect(decodeRtdnEnvelope({}, PACKAGE)).toEqual({ ok: false, reason: "malformed_envelope" });
    expect(decodeRtdnEnvelope({ message: { data: "x" } }, PACKAGE)).toEqual({
      ok: false,
      reason: "missing_message_id",
    });
    expect(
      decodeRtdnEnvelope({ message: { messageId: "m", data: "!!!not base64!!!" } }, PACKAGE).ok,
    ).toBe(false);
  });

  it("RTDN-T4: every subscription type triggers re-verification, not a direct state change", () => {
    for (const type of Object.values(SUBSCRIPTION_NOTIFICATION)) {
      const plan = planRtdnAction(message({ notificationType: type }));
      expect(plan.action).toBe("verify");
    }
  });

  it("RTDN-T5: voided purchases revoke, test notifications are ignored", () => {
    expect(planRtdnAction(message({ kind: "voided_purchase" })).action).toBe("revoke");
    expect(planRtdnAction(message({ kind: "test", purchaseToken: null })).action).toBe("ignore");
    expect(planRtdnAction(message({ kind: "one_time_product" })).action).toBe("ignore");
  });

  it("RTDN-T6: ordering uses the platform event time and stale events are refused", () => {
    const seq = rtdnEventSeq(message());
    expect(seq).toBe(1767225600);
    expect(isStaleEvent(seq, seq - 1)).toBe(true);
    expect(isStaleEvent(seq, seq)).toBe(false);
    // Falls back to publish time when Play omits the event time.
    expect(rtdnEventSeq(message({ eventTimeMillis: null }))).toBe(1767225600);
  });

  it("RTDN-T7: only a Google-signed token with the right audience and sender is accepted", () => {
    expect(validateOidcClaims(claims(), AUD, EMAIL, NOW).ok).toBe(true);
    expect(validateOidcClaims(claims({ iss: "https://evil.example" }), AUD, EMAIL, NOW)).toEqual({
      ok: false,
      reason: "bad_issuer",
    });
    expect(validateOidcClaims(claims(), "https://other.example", EMAIL, NOW)).toEqual({
      ok: false,
      reason: "bad_audience",
    });
    expect(validateOidcClaims(claims({ email: "someone@else.com" }), AUD, EMAIL, NOW)).toEqual({
      ok: false,
      reason: "bad_email",
    });
    expect(validateOidcClaims(claims({ email_verified: false }), AUD, EMAIL, NOW)).toEqual({
      ok: false,
      reason: "bad_email",
    });
  });

  it("RTDN-T8: expired or future-dated tokens are refused", () => {
    expect(validateOidcClaims(claims(), AUD, EMAIL, 1767999999_000)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(validateOidcClaims(claims({ iat: 1768000000 }), AUD, EMAIL, NOW).ok).toBe(false);
  });
});
