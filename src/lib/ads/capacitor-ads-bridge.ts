/**
 * PHASE 14 — the real Capacitor ↔ Google Mobile Ads SDK binding.
 *
 * The Android shell registers a Capacitor plugin named `SyncTogetherAds`
 * (see android/app/src/main/java/com/synctogether/com/ads/AdsPlugin.java).
 * This module adapts that plugin to the `NativeAdsBridge` contract the ad
 * runtime already speaks.
 *
 * Deliberate properties:
 *  - it is a THIN adapter: no policy, no unit selection, no consent decisions;
 *  - it never fabricates success. If the plugin is absent or a call rejects,
 *    the result is a failure/unresolved value, never a pretend impression;
 *  - on the web there is no plugin and `resolveCapacitorAdsBridge()` returns
 *    null, which is what keeps the browser build ad-free.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

import type { NativeAdsBridge } from "./admob-bridge";
import { UNRESOLVED_UMP, type UmpState } from "./consent";

/** The exact surface implemented natively. Mirrors AdsPlugin.java. */
export interface SyncTogetherAdsPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  initialize(options: {
    testMode: boolean;
    nonPersonalized: boolean;
    testDeviceIds?: string[];
  }): Promise<{ initialized: boolean }>;
  showBanner(options: { unitId: string; nonPersonalized: boolean }): Promise<{ shown: boolean }>;
  hideBanner(): Promise<void>;
  preloadInterstitial(options: {
    unitId: string;
    nonPersonalized: boolean;
  }): Promise<{ loaded: boolean }>;
  showInterstitial(options: {
    unitId: string;
    nonPersonalized: boolean;
  }): Promise<{ shown: boolean; reason?: string }>;
  showRewarded(options: {
    unitId: string;
    nonPersonalized: boolean;
  }): Promise<{ earned: boolean; reason?: string }>;
  requestConsentInfoUpdate(): Promise<UmpState>;
  showConsentFormIfRequired(): Promise<UmpState>;
  showPrivacyOptionsForm(): Promise<UmpState>;
}

let cached: NativeAdsBridge | null | undefined;

/** Normalizes whatever the native layer returns into a complete `UmpState`. */
export function toUmpState(raw: unknown): UmpState {
  if (!raw || typeof raw !== "object") return { ...UNRESOLVED_UMP, error: "gathering_failed" };
  const value = raw as Partial<UmpState>;
  const status = value.status;
  const formStatus = value.formStatus;
  return {
    status:
      status === "required" || status === "not_required" || status === "obtained"
        ? status
        : "unknown",
    formStatus: formStatus === "available" || formStatus === "unavailable" ? formStatus : "unknown",
    privacyOptionsRequired: value.privacyOptionsRequired === true,
    canRequestAds: value.canRequestAds === true,
    personalizedAllowed: value.personalizedAllowed === true,
    error: typeof value.error === "string" && value.error ? "gathering_failed" : null,
  };
}

/** Wraps a plugin instance in the bridge contract. Exported for tests. */
export function adaptAdsPlugin(plugin: SyncTogetherAdsPlugin, available: boolean): NativeAdsBridge {
  const consentCall = async (fn: () => Promise<UmpState>): Promise<UmpState> => {
    try {
      return toUmpState(await fn());
    } catch {
      // A failed consent gather is never consent.
      return { ...UNRESOLVED_UMP, error: "gathering_failed" };
    }
  };

  return {
    isAvailable: () => available,
    async initialize(options) {
      await plugin.initialize(options);
    },
    async showBanner(unitId, nonPersonalized) {
      await plugin.showBanner({ unitId, nonPersonalized });
    },
    async hideBanner() {
      await plugin.hideBanner();
    },
    async showInterstitial(unitId, nonPersonalized) {
      const result = await plugin.showInterstitial({ unitId, nonPersonalized });
      return result?.shown === true;
    },
    async showRewarded(unitId, nonPersonalized) {
      const result = await plugin.showRewarded({ unitId, nonPersonalized });
      // Only an explicit native reward callback counts.
      return result?.earned === true;
    },
    async preloadInterstitial(unitId, nonPersonalized) {
      const result = await plugin.preloadInterstitial({ unitId, nonPersonalized });
      return result?.loaded === true;
    },
    consent: {
      requestConsentInfoUpdate: () => consentCall(() => plugin.requestConsentInfoUpdate()),
      showConsentFormIfRequired: () => consentCall(() => plugin.showConsentFormIfRequired()),
      showPrivacyOptionsForm: () => consentCall(() => plugin.showPrivacyOptionsForm()),
    },
  };
}

/**
 * Resolves the Capacitor-backed bridge, or null when this is not a native
 * Android build with the plugin present.
 */
export function resolveCapacitorAdsBridge(): NativeAdsBridge | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    if (typeof window === "undefined") return cached;
    if (!Capacitor.isNativePlatform?.()) return cached;
    if (!Capacitor.isPluginAvailable?.("SyncTogetherAds")) return cached;
    const plugin = registerPlugin<SyncTogetherAdsPlugin>("SyncTogetherAds");
    cached = adaptAdsPlugin(plugin, true);
  } catch {
    cached = null;
  }
  return cached;
}

/** Test-only: clears the memoized bridge. */
export function resetCapacitorAdsBridge() {
  cached = undefined;
}
