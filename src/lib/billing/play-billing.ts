/**
 * PHASE 9 — Google Play Billing client abstraction.
 *
 * The web build has no billing SDK. The Android build (WebView/TWA wrapper)
 * injects a bridge object which implements `PlayBillingBridge`; this module is
 * the ONLY place that knows about it, so no application code depends on
 * billing SDK internals.
 *
 * SECURITY: the bridge is untrusted input. A purchase is nothing more than a
 * *claim* until the backend verifies the token with Google Play, so this file
 * never decides entitlement — it only collects tokens to hand to the server.
 */

export interface PlayPurchase {
  productId: string;
  purchaseToken: string;
  /** Play's own purchase state, used for UI copy only. */
  purchaseState?: "purchased" | "pending" | "unspecified";
  orderId?: string;
}

export interface PlayBillingBridge {
  isAvailable(): boolean;
  /** Launches the Play purchase flow and resolves with the resulting claim. */
  purchase(productId: string, basePlanId?: string): Promise<PlayPurchase | null>;
  /** Returns all purchases Play knows about for the signed-in Play account. */
  queryPurchases(): Promise<PlayPurchase[]>;
  /** Opens the Play-managed subscription settings screen. */
  openManageSubscriptions?(productId?: string): void;
}

declare global {
  interface Window {
    SyncTogetherBilling?: PlayBillingBridge;
  }
}

export type BillingAvailability = "available" | "unsupported_platform";

export function getBillingBridge(): PlayBillingBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.SyncTogetherBilling;
  if (!bridge || typeof bridge.queryPurchases !== "function") return null;
  try {
    return bridge.isAvailable() ? bridge : null;
  } catch {
    return null;
  }
}

export function billingAvailability(): BillingAvailability {
  return getBillingBridge() ? "available" : "unsupported_platform";
}

/** Play-managed subscription settings deep link (works in a browser too). */
export function manageSubscriptionUrl(productId?: string): string {
  const base = "https://play.google.com/store/account/subscriptions";
  return productId ? `${base}?sku=${encodeURIComponent(productId)}` : base;
}
