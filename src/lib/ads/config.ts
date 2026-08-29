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
  /** Optional formats. Null means "configured off"; never a fallback unit. */
  appOpen: string | null;
  rewarded?: string | null;
}

/**
 * PHASE 13.1 — id shapes. AdMob app ids use "~", unit ids use "/". Enforcing
 * the shape here means a typo (or an escaped "~") disables advertising instead
 * of producing silent no-fill against a malformed id.
 */
export const ADMOB_APP_ID_PATTERN = /^ca-app-pub-\d{16}~\d{10}$/;
export const ADMOB_UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/;

export function isValidAdMobAppId(value: string | undefined | null): boolean {
  return typeof value === "string" && ADMOB_APP_ID_PATTERN.test(value);
}

export function isValidAdUnitId(value: string | undefined | null): boolean {
  return typeof value === "string" && ADMOB_UNIT_ID_PATTERN.test(value);
}

/** Official Google-published AdMob test unit ids (Android). */
export const TEST_AD_UNITS: AdUnits = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
  appOpen: "ca-app-pub-3940256099942544/3419835294",
  rewarded: "ca-app-pub-3940256099942544/5224354917",
};

/** Google's published sample application id. Development builds only. */
export const TEST_ADMOB_APP_ID = "ca-app-pub-3940256099942544~3347511713";

export interface AdUnitResolution {
  units: AdUnits | null;
  testMode: boolean;
  /** Set when ads must stay disabled; surfaced in logs, never to end users. */
  configError: string | null;
}

function isTestUnit(value: string | undefined | null): boolean {
  return Boolean(value && value.startsWith("ca-app-pub-3940256099942544/"));
}

/**
 * Resolves which ad units (if any) this build may request.
 *
 * `production` requires every REQUIRED unit (banner, interstitial) to be
 * present, correctly shaped, and not a Google test unit. Optional formats
 * (app-open, rewarded) may be absent — absent means the format is off, never
 * that a fallback unit is used.
 */
const REQUIRED_UNITS = ["banner", "interstitial"] as const;
const OPTIONAL_UNITS = ["appOpen", "rewarded"] as const;

export function resolveAdUnits(
  environment: AdEnvironment,
  configured: Partial<AdUnits> = {},
): AdUnitResolution {
  if (environment === "development") {
    // A development build may ONLY ever use Google's official test inventory:
    // configured production ids are ignored here, not merged.
    return { units: TEST_AD_UNITS, testMode: true, configError: null };
  }

  const missing = REQUIRED_UNITS.filter((key) => !configured[key]);
  if (missing.length > 0) {
    return {
      units: null,
      testMode: false,
      configError: `missing production ad unit(s): ${missing.join(", ")}`,
    };
  }
  const present = [...REQUIRED_UNITS, ...OPTIONAL_UNITS].filter((key) => Boolean(configured[key]));
  const testLeak = present.filter((key) => isTestUnit(configured[key]));
  if (testLeak.length > 0) {
    return {
      units: null,
      testMode: false,
      configError: `test ad unit(s) configured in production: ${testLeak.join(", ")}`,
    };
  }
  const malformed = present.filter((key) => !isValidAdUnitId(configured[key]));
  if (malformed.length > 0) {
    return {
      units: null,
      testMode: false,
      configError: `malformed production ad unit(s): ${malformed.join(", ")}`,
    };
  }

  return {
    units: {
      banner: configured.banner!,
      interstitial: configured.interstitial!,
      appOpen: configured.appOpen ?? null,
      rewarded: configured.rewarded ?? null,
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
  /**
   * Rewarded ads are ACTIVE: the reward is explicit and user-visible — the
   * user opts in to watch an ad and receives 24h full access (3 ads) or one
   * extra room (1 ad). The server is the authority on the reward itself.
   */
  rewarded_enabled: boolean;
}

/** Build-level kill switch for rewarded ads. Enabled now that an explicit,
 *  user-visible, opt-in reward exists (see public.claim_rewarded_view). */
export const REWARDED_ADS_ENABLED = true;

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
  rewarded_enabled: true,
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
    // Remote config can only ever turn rewarded ads further OFF: the build
    // flag is authoritative while no reward exists.
    rewarded_enabled: REWARDED_ADS_ENABLED && bool("rewarded_enabled", true),
  };
}
