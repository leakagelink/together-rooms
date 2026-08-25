/**
 * PHASE 11 — PLAY-BILLING-T1 … T15
 *
 * These cover the rules that decide whether money turns into entitlement.
 * They are deliberately pure: no network, no database, no SDK.
 */
import { describe, expect, it } from "vitest";

import {
  EXPECTED_PACKAGE_NAME,
  isAllowedProduct,
  resolveProductConfig,
  serverProductConfig,
} from "./products";
import {
  eventTypeFor,
  mapVerificationToEvent,
  shouldAcknowledge,
  type VerifiedPurchase,
} from "./verification.server";
import { getBillingBridge, manageSubscriptionUrl } from "./play-billing";
import { hashPurchaseToken } from "./rtdn.server";

const purchase = (patch: Partial<VerifiedPurchase> = {}): VerifiedPurchase => ({
  productId: "premium_monthly",
  state: "active",
  expiresAt: "2030-01-01T00:00:00.000Z",
  graceUntil: null,
  autoRenewing: true,
  eventSeq: 1000,
  acknowledged: false,
  ...patch,
});

const goodConfig = () =>
  resolveProductConfig("production", {
    premiumProductId: "premium_monthly",
    packageName: EXPECTED_PACKAGE_NAME,
  });

describe("PLAY-BILLING", () => {
  it("PLAY-BILLING-T1: product ids come from configuration, never hard-coded", () => {
    const missing = resolveProductConfig("production", { packageName: EXPECTED_PACKAGE_NAME });
    expect(missing.ok).toBe(false);
    expect(missing.problems).toContain("missing_premium_product_id");
    expect(missing.allowedProductIds).toEqual([]);
  });

  it("PLAY-BILLING-T2: a test product id is rejected in a production build", () => {
    const config = resolveProductConfig("production", {
      premiumProductId: "android.test.purchased",
      packageName: EXPECTED_PACKAGE_NAME,
    });
    expect(config.ok).toBe(false);
    expect(config.problems).toContain("test_product_in_production");
  });

  it("PLAY-BILLING-T3: a mismatched package name fails configuration", () => {
    const config = resolveProductConfig("production", {
      premiumProductId: "premium_monthly",
      packageName: "com.attacker.app",
    });
    expect(config.problems).toContain("package_mismatch");
  });

  it("PLAY-BILLING-T4: only configured products may be verified", () => {
    const config = goodConfig();
    expect(isAllowedProduct(config, "premium_monthly")).toBe(true);
    expect(isAllowedProduct(config, "premium_lifetime_free")).toBe(false);
  });

  it("PLAY-BILLING-T5: an invalid configuration allows no product at all", () => {
    const broken = resolveProductConfig("production", { premiumProductId: "premium_monthly" });
    expect(isAllowedProduct(broken, "premium_monthly")).toBe(false);
  });

  it("PLAY-BILLING-T6: server configuration reads only server environment keys", () => {
    const config = serverProductConfig({
      NODE_ENV: "production",
      GOOGLE_PLAY_PREMIUM_PRODUCT_ID: "premium_monthly",
      GOOGLE_PLAY_PACKAGE_NAME: EXPECTED_PACKAGE_NAME,
    });
    expect(config.ok).toBe(true);
    expect(config.allowedProductIds).toEqual(["premium_monthly"]);
  });

  it("PLAY-BILLING-T7: an active verified purchase maps to a granting event", () => {
    expect(eventTypeFor(purchase())).toBe("purchase_verified");
  });

  it("PLAY-BILLING-T8: a pending purchase never grants entitlement", () => {
    const event = mapVerificationToEvent(purchase({ state: "pending" }));
    expect(event.eventType).toBe("pending");
  });

  it("PLAY-BILLING-T9: a revoked purchase maps to revocation", () => {
    expect(eventTypeFor(purchase({ state: "revoked" }))).toBe("revoked");
  });

  it("PLAY-BILLING-T10: cancelled-but-active keeps access until period end", () => {
    const event = mapVerificationToEvent(purchase({ state: "cancelled_active", autoRenewing: false }));
    expect(event.eventType).toBe("cancelled");
    expect(event.cancelAtPeriodEnd).toBe(true);
    expect(event.expiresAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("PLAY-BILLING-T11: acknowledgement happens only for entitling states", () => {
    expect(shouldAcknowledge(purchase())).toBe(true);
    expect(shouldAcknowledge(purchase({ state: "grace_period" }))).toBe(true);
    expect(shouldAcknowledge(purchase({ state: "pending" }))).toBe(false);
    expect(shouldAcknowledge(purchase({ state: "expired" }))).toBe(false);
  });

  it("PLAY-BILLING-T12: an already-acknowledged purchase is not acknowledged twice", () => {
    expect(shouldAcknowledge(purchase({ acknowledged: true }))).toBe(false);
  });

  it("PLAY-BILLING-T13: the event sequence comes from the platform timestamp", () => {
    expect(mapVerificationToEvent(purchase({ eventSeq: 42 })).eventSeq).toBe(42);
  });

  it("PLAY-BILLING-T14: purchase tokens are only ever stored as hashes", () => {
    const hash = hashPurchaseToken("token-abc");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("token-abc");
    expect(hashPurchaseToken("token-abc")).toBe(hash);
    expect(hashPurchaseToken("token-abd")).not.toBe(hash);
  });

  it("PLAY-BILLING-T15: no billing bridge exists outside the Android shell", () => {
    expect(getBillingBridge()).toBeNull();
    expect(manageSubscriptionUrl("premium_monthly")).toContain(
      "play.google.com/store/account/subscriptions",
    );
  });
});
