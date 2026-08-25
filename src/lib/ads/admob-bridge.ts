/**
 * PHASE 11 — the Google Mobile Ads SDK boundary.
 *
 * The web build has no ad SDK. The Android shell injects a bridge object that
 * wraps the real Mobile Ads SDK (banner/interstitial/app-open) and the UMP SDK.
 * This module is the ONLY place in the application that knows the bridge
 * exists: everything else goes through `AdProvider`, which enforces the
 * centralized placement policy first.
 *
 * The bridge is untrusted in the same sense as any client input — it can only
 * ever show or not show an ad; it can never grant entitlement or change
 * consent state that the policy depends on.
 */
import type { AdSdk } from "./provider";
import type { UmpBridge, UmpState } from "./consent";
import { UNRESOLVED_UMP } from "./consent";

export interface NativeAdsBridge {
  isAvailable(): boolean;
  /** Initializes the Mobile Ads SDK. Must only be called once consent allows it. */
  initialize(options: { testMode: boolean; nonPersonalized: boolean }): Promise<void>;
  showBanner(unitId: string, nonPersonalized: boolean): Promise<void>;
  hideBanner(): Promise<void>;
  showInterstitial(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  showAppOpen?(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  consent: UmpBridge;
}

declare global {
  interface Window {
    SyncTogetherAds?: NativeAdsBridge;
  }
}

export function getAdsBridge(): NativeAdsBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.SyncTogetherAds;
  if (!bridge || typeof bridge.showBanner !== "function") return null;
  try {
    return bridge.isAvailable() ? bridge : null;
  } catch {
    return null;
  }
}

/**
 * Adapts the native bridge to the provider's `AdSdk` contract.
 *
 * Lifecycle safety: a banner is tracked so a re-render or a foreground event
 * can never create a second banner instance, and every failure is swallowed —
 * an ad that cannot load must never block the app.
 */
export function createNativeAdSdk(bridge: NativeAdsBridge): AdSdk {
  let bannerUnit: string | null = null;
  let fullscreenInFlight = false;

  return {
    showBanner(unitId, nonPersonalized) {
      if (bannerUnit === unitId) return; // already showing: no duplicate instance
      bannerUnit = unitId;
      void bridge.showBanner(unitId, nonPersonalized).catch(() => {
        bannerUnit = null;
      });
    },
    hideBanner() {
      if (bannerUnit === null) return;
      bannerUnit = null;
      void bridge.hideBanner().catch(() => null);
    },
    async showFullscreen(unitId, nonPersonalized) {
      // Full-screen formats can never stack.
      if (fullscreenInFlight) return;
      fullscreenInFlight = true;
      try {
        await bridge.showInterstitial(unitId, nonPersonalized);
      } catch {
        // Ad failures are non-events for the user.
      } finally {
        fullscreenInFlight = false;
      }
    },
  };
}

/** Consent bridge that resolves to "unresolved" when no native SDK is present. */
export function getUmpBridge(): UmpBridge {
  const bridge = getAdsBridge();
  if (bridge) return bridge.consent;
  const unresolved = async (): Promise<UmpState> => UNRESOLVED_UMP;
  return {
    requestConsentInfoUpdate: unresolved,
    showConsentFormIfRequired: unresolved,
    showPrivacyOptionsForm: unresolved,
  };
}
