/**
 * PHASE 11/14 — the Google Mobile Ads SDK boundary.
 */
import { isValidAdUnitId } from "./config";
import { sanitizeBridgeError } from "./bridge-errors";
import type { AdSdk } from "./provider";
import type { UmpBridge, UmpState } from "./consent";
import { UNRESOLVED_UMP } from "./consent";
import { resolveCapacitorAdsBridge } from "./capacitor-ads-bridge";

export interface NativeAdsBridge {
  isAvailable(): boolean;
  initialize(options: {
    testMode: boolean;
    nonPersonalized: boolean;
    testDeviceIds?: string[];
  }): Promise<void>;
  showBanner(unitId: string, nonPersonalized: boolean): Promise<void>;
  hideBanner(): Promise<void>;
  showInterstitial(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  preloadInterstitial?(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  showRewarded(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  preloadRewarded?(unitId: string, nonPersonalized: boolean): Promise<boolean>;
  showAppOpen?(unitId: string, nonPersonalized: boolean): Promise<boolean>;
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

export function getAdsBridge(): NativeAdsBridge | null {
  const bridge = windowBridge() ?? resolveCapacitorAdsBridge();
  if (!bridge) return null;
  const required: (keyof NativeAdsBridge)[] = [
    "initialize",
    "showBanner",
    "hideBanner",
    "showInterstitial",
    "showRewarded",
  ];
  if (required.some((method) => typeof bridge[method] !== "function")) return null;
  return bridge;
}

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
      sanitizeBridgeError(error);
      initState = "idle";
      initPromise = null;
      return false;
    });
  return initPromise;
}

export function createNativeAdSdk(bridge: NativeAdsBridge): AdSdk {
  let bannerUnit: string | null = null;
  let fullscreenInFlight = false;

  return {
    showBanner(unitId, nonPersonalized) {
      if (!isValidAdUnitId(unitId)) return;
      if (bannerUnit === unitId) return;
      bannerUnit = unitId;
      void bridge.showBanner(unitId, nonPersonalized).catch((error: unknown) => {
        sanitizeBridgeError(error);
        bannerUnit = null;
      });
    },
    hideBanner() {
      if (bannerUnit === null) return;
      bannerUnit = null;
      void bridge.hideBanner().catch((error: unknown) => {
        sanitizeBridgeError(error);
      });
    },
    async showFullscreen(unitId, nonPersonalized, format) {
      if (!isValidAdUnitId(unitId)) return;
      if (fullscreenInFlight) return;
      fullscreenInFlight = true;
      try {
        if (format === "rewarded") {
          await bridge.showRewarded(unitId, nonPersonalized);
        } else {
          await bridge.showInterstitial(unitId, nonPersonalized);
        }
      } catch (error) {
        sanitizeBridgeError(error);
      } finally {
        fullscreenInFlight = false;
      }
    },
  };
}

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
