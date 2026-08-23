import { describe, expect, it } from "vitest";

import { eventTypeFor, mapPlaySubscription, verifyPlayPurchase } from "./verification.server";

const EXPIRY = "2026-03-01T00:00:00Z";

function payload(state: string, autoRenew = true) {
  return {
    subscriptionState: state,
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    startTime: "2026-02-01T00:00:00Z",
    lineItems: [
      {
        productId: "premium_monthly",
        expiryTime: EXPIRY,
        autoRenewingPlan: { autoRenewEnabled: autoRenew },
      },
    ],
  };
}

describe("Google Play verification (BILLING-U1..U8)", () => {
  it("U1: verification fails closed when no credentials are configured", async () => {
    delete process.env["GOOGLE_PLAY_PACKAGE_NAME"];
    delete process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"];
    const outcome = await verifyPlayPurchase("premium_monthly", "token-1234567890");
    expect(outcome).toEqual({ ok: false, reason: "verification_unavailable" });
  });

  it("U2: an active auto-renewing subscription maps to premium", () => {
    const mapped = mapPlaySubscription(payload("SUBSCRIPTION_STATE_ACTIVE"), "premium_monthly");
    expect(mapped?.state).toBe("active");
    expect(mapped?.expiresAt).toBe(EXPIRY);
    expect(eventTypeFor(mapped!)).toBe("purchase_verified");
  });

  it("U3: cancelled-but-active keeps access until the period ends", () => {
    const mapped = mapPlaySubscription(payload("SUBSCRIPTION_STATE_CANCELED"), "premium_monthly");
    expect(mapped?.state).toBe("cancelled_active");
    expect(mapped?.autoRenewing).toBe(true);
    expect(eventTypeFor(mapped!)).toBe("cancelled");
  });

  it("U4: grace period is mapped and bounded by its own timestamp", () => {
    const mapped = mapPlaySubscription(
      payload("SUBSCRIPTION_STATE_IN_GRACE_PERIOD"),
      "premium_monthly",
    );
    expect(mapped?.state).toBe("grace_period");
    expect(mapped?.graceUntil).toBe(EXPIRY);
  });

  it("U5: on-hold and expired both revoke premium", () => {
    expect(mapPlaySubscription(payload("SUBSCRIPTION_STATE_ON_HOLD"), "p")?.state).toBe("expired");
    expect(mapPlaySubscription(payload("SUBSCRIPTION_STATE_EXPIRED"), "p")?.state).toBe("expired");
  });

  it("U6: paused subscriptions do not grant premium", () => {
    const mapped = mapPlaySubscription(payload("SUBSCRIPTION_STATE_PAUSED"), "p");
    expect(mapped?.state).toBe("paused");
  });

  it("U7: an unknown state is rejected rather than guessed", () => {
    expect(mapPlaySubscription(payload("SOMETHING_NEW"), "p")).toBeNull();
    expect(mapPlaySubscription({}, "p")).toBeNull();
  });

  it("U8: the ordering key increases with each renewal", () => {
    const first = mapPlaySubscription(payload("SUBSCRIPTION_STATE_ACTIVE"), "p")!;
    const renewed = mapPlaySubscription(
      {
        ...payload("SUBSCRIPTION_STATE_ACTIVE"),
        lineItems: [
          {
            productId: "premium_monthly",
            expiryTime: "2026-04-01T00:00:00Z",
            autoRenewingPlan: { autoRenewEnabled: true },
          },
        ],
      },
      "p",
    )!;
    expect(renewed.eventSeq).toBeGreaterThan(first.eventSeq);
  });
});
