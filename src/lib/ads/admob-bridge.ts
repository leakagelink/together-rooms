/**
 * PHASE 11/14 — the Google Mobile Ads SDK boundary.
 *
 * The web build has no ad SDK. The Android shell provides one of two things:
 *
 *   1. the Capacitor plugin `SyncTogetherAds` (the real Phase 14
 *      implementation, see android/.../ads/AdsPlugin.java), or
 *   2. an injected `window.SyncTogetherAds` object (legacy/embedding shells).
 *
 * This module is the ONLY place in the application that knows either exists:
 * everything else goes through `AdProvider`, which enforces the centralized
 * placement policy first.
 *
 * The bridge is untrusted in the same sense as any client input — it can only
 * ever show or not show an ad; it can never grant entitlement or assert
 * consent state that the policy depends on, and it can never report an
 * impression the policy did not authorize.
 */
import { isValidAdUnitId } from "./config";
import { sanitizeBridgeError } from "./bridge-errors";
import { adDebug } from "./debug";
import type { AdSdk } from "./provider";
import type { UmpBridge, UmpState } from "./consent";
import { UNRESOLVED_UMP } from "./consent";
import { resolveCapacitorAdsBridge } from "./capacitor-ads-bridge";

export interface NativeAdsBridge {
  isAvailable(): boolean;
  /** Initializes the Mobile Ads SDK. Must only be called once consent allows it. */
  initialize(options: {
    testMode: boolean;
    nonPersonalized: boolean;
    testDeviceIds?: string[];
  }): Promise<void>;
  showBanner(unitId: string, nonPersonalized: boolean): Promise<void>;
  hideBanner(): Promise<void>;
  showInterstitial(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  /** Optional: warms an interstitial. Never shows one. */
  preloadInterstitial?(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  showAppOpen?(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  /** Shows a rewarded ad; resolves true ONLY when the SDK reported the reward. */
  showRewarded?(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  consent: UmpBridge;
}

declare global {
  interface Window {
    SyncTogetherAds?: NativeAdsBridge;
  }
}

function windowBridge(): NativeAdsBridge | null {
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
 * Resolves the native bridge, preferring an explicitly injected shell object
 * and falling back to the Capacitor plugin. Returns null on web, and null when
 * the required methods are missing — a partial bridge is treated as no bridge
 * rather than half-used.
 */
export function getAdsBridge(): NativeAdsBridge | null {
  const bridge = windowBridge() ?? resolveCapacitorAdsBridge();
  if (!bridge) return null;
  const required: (keyof NativeAdsBridge)[] = [
    "initialize",
    "showBanner",
    "hideBanner",
    "showInterstitial",
  ];
  if (required.some((method) => typeof bridge[method] !== "function")) return null;
  return bridge;
}

/**
 * PHASE 14 — single initialization path.
 *
 * The Mobile Ads SDK must be initialized exactly once per app process. The
 * guard lives here rather than in the React tree so that a remount, a route
 * change or an activity recreation replaying the effect cannot produce a
 * second initialization.
 */
let initState: "idle" | "in_flight" | "ready" = "idle";
let initPromise: Promise<boolean> | null = null;

export interface NativeInitOptions {
  testMode: boolean;
  nonPersonalized: boolean;
  testDeviceIds?: string[];
}

export async function initializeNativeAds(
  bridge: NativeAdsBridge,
  options: NativeInitOptions,
): Promise<boolean> {
  if (initState === "ready") return true;
  if (initPromise) return initPromise;
  initState = "in_flight";
  initPromise = bridge
    .initialize(options)
    .then(() => {
      initState = "ready";
      return true;
    })
    .catch((error: unknown) => {
      // Sanitized: SDK failure text never reaches a log or the UI.
      sanitizeBridgeError(error);
      initState = "idle";
      initPromise = null;
      return false;
    });
  return initPromise;
}

export function nativeAdsInitState(): "idle" | "in_flight" | "ready" {
  return initState;
}

/** Test-only: resets the process-wide initialization guard. */
export function resetNativeAdsInit() {
  initState = "idle";
  initPromise = null;
}

/**
 * Adapts the native bridge to the provider's `AdSdk` contract.
 *
 * Lifecycle safety:
 *  - a banner is tracked so a re-render, a route change or a foreground event
 *    can never create a second banner instance;
 *  - a malformed unit id is refused before it reaches the SDK;
 *  - full-screen formats can never stack, and a failed or unavailable ad is a
 *    non-event: navigation already happened and is never awaited on an ad.
 */
export function createNativeAdSdk(bridge: NativeAdsBridge): AdSdk {
  let bannerUnit: string | null = null;
  let bannerLoaded = false;
  let fullscreenInFlight = false;

  return {
    async showBanner(unitId, nonPersonalized) {
      if (!isValidAdUnitId(unitId)) return false; // fail closed on a malformed id
      // Already showing this unit, or a request for it is in flight: never a
      // second AdView, whatever React re-renders.
      if (bannerUnit === unitId) return bannerLoaded;
      bannerUnit = unitId;
      bannerLoaded = false;
      try {
        // The native call resolves only when the SDK reported onAdLoaded, and
        // rejects with a short token when the load failed.
        await bridge.showBanner(unitId, nonPersonalized);
        if (bannerUnit !== unitId) return false; // hidden while loading
        bannerLoaded = true;
        adDebug("native_banner_loaded", { unitId });
        return true;
      } catch (error: unknown) {
        adDebug("native_banner_failed", { unitId, reason: sanitizeBridgeError(error) });
        bannerUnit = null;
        bannerLoaded = false;
        return false;
      }
    },
    hideBanner() {
      if (bannerUnit === null) return;
      bannerUnit = null;
      bannerLoaded = false;
      adDebug("native_banner_hidden");
      void bridge.hideBanner().catch((error: unknown) => {
        sanitizeBridgeError(error);
      });
    },
    async showRewarded(unitId, nonPersonalized) {
      if (!isValidAdUnitId(unitId)) return false;
      if (!bridge.showRewarded) return false;
      if (fullscreenInFlight) return false;
      fullscreenInFlight = true;
      try {
        // The reward is whatever the SDK reports; the server re-checks caps.
        return await bridge.showRewarded(unitId, nonPersonalized);
      } catch (error) {
        sanitizeBridgeError(error);
        return false;
      } finally {
        fullscreenInFlight = false;
      }
    },
    async showFullscreen(unitId, nonPersonalized) {
      if (!isValidAdUnitId(unitId)) return;
      if (fullscreenInFlight) return;
      fullscreenInFlight = true;
      try {
        await bridge.showInterstitial(unitId, nonPersonalized);
      } catch (error) {
        // Ad failures are non-events for the user.
        sanitizeBridgeError(error);
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
