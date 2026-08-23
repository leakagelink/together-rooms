/**
 * PHASE 9 — AdMob configuration.
 *
 * Two hard rules are encoded here:
 *  1. Development/preview builds may ONLY use Google's official test ad units.
 *  2. Production builds may ONLY use configured production unit ids; if they
 *     are missing, ads are disabled rather than silently falling back to test
 *     units (which would look like working ads while earning nothing and
 *     polluting reporting).
 *
 * No secret ever lives here. AdMob unit ids are public identifiers; the AdMob
 * account credentials stay in the Play Console / AdMob console.
 */

export type AdEnvironment = "development" | "production";

export interface AdUnits {
  banner: string;
  interstitial: string;
  appOpen: string;
}

/** Official Google-published AdMob test unit ids (Android). */
export const TEST_AD_UNITS: AdUnits = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
  appOpen: "ca-app-pub-3940256099942544/3419835294",
};

export interface AdUnitResolution {
  units: AdUnits | null;
  testMode: boolean;
  /** Set when ads must stay disabled; surfaced in logs, never to end users. */
  configError: string | null;
}

function isTestUnit(value: string | undefined): boolean {
  return Boolean(value && value.startsWith("ca-app-pub-3940256099942544/"));
}

/**
 * Resolves which ad units (if any) this build may request.
 * `production` requires every unit to be present AND to not be a test unit.
 */
export function resolveAdUnits(
  environment: AdEnvironment,
  configured: Partial<AdUnits> = {},
): AdUnitResolution {
  if (environment === "development") {
    return { units: TEST_AD_UNITS, testMode: true, configError: null };
  }

  const missing = (["banner", "interstitial", "appOpen"] as const).filter(
    (key) => !configured[key],
  );
  if (missing.length > 0) {
    return {
      units: null,
      testMode: false,
      configError: `missing production ad unit(s): ${missing.join(", ")}`,
    };
  }
  const testLeak = (["banner", "interstitial", "appOpen"] as const).filter((key) =>
    isTestUnit(configured[key]),
  );
  if (testLeak.length > 0) {
    return {
      units: null,
      testMode: false,
      configError: `test ad unit(s) configured in production: ${testLeak.join(", ")}`,
    };
  }

  return {
    units: {
      banner: configured.banner!,
      interstitial: configured.interstitial!,
      appOpen: configured.appOpen!,
    },
    testMode: false,
    configError: null,
  };
}

export interface AdFrequencyConfig {
  ads_enabled: boolean;
  min_seconds_between_fullscreen: number;
  max_fullscreen_per_session: number;
  min_seconds_after_app_open_ad: number;
  min_session_seconds_before_first_fullscreen: number;
  banner_enabled: boolean;
  app_open_enabled: boolean;
  interstitial_enabled: boolean;
}

/** Conservative defaults, documented in the Phase 9 report. Server-overridable. */
export const DEFAULT_AD_FREQUENCY: AdFrequencyConfig = {
  ads_enabled: true,
  min_seconds_between_fullscreen: 180,
  max_fullscreen_per_session: 2,
  min_seconds_after_app_open_ad: 120,
  min_session_seconds_before_first_fullscreen: 90,
  banner_enabled: true,
  app_open_enabled: false,
  interstitial_enabled: true,
};

/** Merges a remote config row over the conservative defaults. */
export function mergeAdFrequency(remote: unknown): AdFrequencyConfig {
  if (!remote || typeof remote !== "object") return DEFAULT_AD_FREQUENCY;
  const row = remote as Record<string, unknown>;
  const num = (key: keyof AdFrequencyConfig, fallback: number) =>
    typeof row[key] === "number" && Number.isFinite(row[key]) && (row[key] as number) >= 0
      ? (row[key] as number)
      : fallback;
  const bool = (key: keyof AdFrequencyConfig, fallback: boolean) =>
    typeof row[key] === "boolean" ? (row[key] as boolean) : fallback;

  return {
    ads_enabled: bool("ads_enabled", DEFAULT_AD_FREQUENCY.ads_enabled),
    min_seconds_between_fullscreen: num(
      "min_seconds_between_fullscreen",
      DEFAULT_AD_FREQUENCY.min_seconds_between_fullscreen,
    ),
    max_fullscreen_per_session: num(
      "max_fullscreen_per_session",
      DEFAULT_AD_FREQUENCY.max_fullscreen_per_session,
    ),
    min_seconds_after_app_open_ad: num(
      "min_seconds_after_app_open_ad",
      DEFAULT_AD_FREQUENCY.min_seconds_after_app_open_ad,
    ),
    min_session_seconds_before_first_fullscreen: num(
      "min_session_seconds_before_first_fullscreen",
      DEFAULT_AD_FREQUENCY.min_session_seconds_before_first_fullscreen,
    ),
    banner_enabled: bool("banner_enabled", DEFAULT_AD_FREQUENCY.banner_enabled),
    app_open_enabled: bool("app_open_enabled", DEFAULT_AD_FREQUENCY.app_open_enabled),
    interstitial_enabled: bool("interstitial_enabled", DEFAULT_AD_FREQUENCY.interstitial_enabled),
  };
}
