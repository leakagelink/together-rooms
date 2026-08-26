/**
 * PHASE 13.1 — the single authoritative AdMob identifier boundary.
 *
 * AdMob application and ad unit ids are PUBLIC native identifiers, not
 * secrets: they ship inside the APK and are visible in every ad request. They
 * are still centralized here so that
 *
 *  - no UI component ever contains an id,
 *  - environment separation is decided in exactly one place,
 *  - a malformed or mismatched id disables advertising instead of silently
 *    serving against the wrong inventory.
 *
 * Production values may be overridden by build-time VITE_ADMOB_* variables
 * (useful for a staging AdMob account); when unset, the constants below are
 * the production configuration.
 */
import {
  isValidAdMobAppId,
  TEST_ADMOB_APP_ID,
  type AdEnvironment,
  type AdUnits,
} from "./config";

/** Real SyncTogether AdMob application id (Android). The "~" is significant. */
export const PRODUCTION_ADMOB_APP_ID = "ca-app-pub-1475323931624357~5237247287";

/**
 * Real production inventory.
 *
 * `appOpen` is intentionally absent — app-open ads are not part of the
 * product. `rewarded` is configured but gated behind REWARDED_ADS_ENABLED.
 */
export const PRODUCTION_AD_UNITS: Partial<AdUnits> = {
  banner: "ca-app-pub-1475323931624357/9884842805",
  interstitial: "ca-app-pub-1475323931624357/3102038535",
  rewarded: "ca-app-pub-1475323931624357/5045675599",
};

export interface AdMobEnvOverrides {
  banner?: string | undefined;
  interstitial?: string | undefined;
  appOpen?: string | undefined;
  rewarded?: string | undefined;
  appId?: string | undefined;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The ad units this build may pass to `resolveAdUnits`.
 *
 * Development builds return `{}` — they never see production inventory, and
 * `resolveAdUnits` supplies Google's official test units for them.
 */
export function resolveConfiguredAdUnits(
  environment: AdEnvironment,
  overrides: AdMobEnvOverrides = {},
): Partial<AdUnits> {
  if (environment === "development") return {};
  const banner = clean(overrides.banner) ?? PRODUCTION_AD_UNITS.banner;
  const interstitial = clean(overrides.interstitial) ?? PRODUCTION_AD_UNITS.interstitial;
  const appOpen = clean(overrides.appOpen) ?? PRODUCTION_AD_UNITS.appOpen ?? null;
  const rewarded = clean(overrides.rewarded) ?? PRODUCTION_AD_UNITS.rewarded ?? null;
  return {
    ...(banner ? { banner } : {}),
    ...(interstitial ? { interstitial } : {}),
    appOpen,
    rewarded,
  };
}

export interface AdMobAppIdResolution {
  appId: string | null;
  configError: string | null;
}

/**
 * Resolves the AdMob application id the native shell must be configured with.
 * Fails closed: an invalid or environment-mismatched id yields no app id, and
 * a build with no app id must not serve ads.
 */
export function resolveAdMobAppId(
  environment: AdEnvironment,
  overrides: AdMobEnvOverrides = {},
): AdMobAppIdResolution {
  if (environment === "development") {
    return { appId: TEST_ADMOB_APP_ID, configError: null };
  }
  const candidate = clean(overrides.appId) ?? PRODUCTION_ADMOB_APP_ID;
  if (!isValidAdMobAppId(candidate)) {
    return { appId: null, configError: "malformed admob app id" };
  }
  if (candidate === TEST_ADMOB_APP_ID) {
    return { appId: null, configError: "test admob app id configured in production" };
  }
  return { appId: candidate, configError: null };
}
