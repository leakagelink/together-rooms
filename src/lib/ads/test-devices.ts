/**
 * PHASE 14 — explicit test-device configuration.
 *
 * Google supports exactly two safe ways to test ads:
 *
 *   A. Google's official demo ad units (development builds only — see
 *      `resolveAdUnits`, which never lets a development build touch production
 *      inventory).
 *   B. Registered test devices requesting the REAL ad unit ids. Impressions
 *      and clicks from a registered device are test traffic and cannot cause
 *      invalid-traffic enforcement.
 *
 * Both must be deliberate. This module encodes the rule that a device is only
 * ever a test device when its hashed id was explicitly configured at build
 * time: there is no "treat this build as test", no runtime toggle, no remote
 * override, and registering a device NEVER flips the build into test mode or
 * changes which ad units are used.
 */
import type { AdEnvironment } from "./config";

/** AdMob prints the hashed device id in logcat; it is a 32-char hex string. */
const TEST_DEVICE_ID_PATTERN = /^[0-9A-Fa-f]{32}$/;

export interface TestDeviceResolution {
  /** Hashed ids to hand to `RequestConfiguration.setTestDeviceIds`. */
  deviceIds: string[];
  /** True only when at least one valid id was explicitly configured. */
  explicit: boolean;
  /** Ids that were configured but rejected; surfaced in logs only. */
  rejected: string[];
}

/**
 * Parses `VITE_ADMOB_TEST_DEVICE_IDS` (comma or whitespace separated).
 *
 * Malformed ids are dropped rather than passed to the SDK: an unrecognized id
 * would silently register nothing and the tester would click a real ad
 * believing they were protected.
 */
export function resolveTestDeviceIds(raw: string | undefined | null): TestDeviceResolution {
  const parts = (raw ?? "")
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const deviceIds: string[] = [];
  const rejected: string[] = [];
  for (const part of parts) {
    if (TEST_DEVICE_ID_PATTERN.test(part)) deviceIds.push(part.toUpperCase());
    else rejected.push(part);
  }
  return { deviceIds, explicit: deviceIds.length > 0, rejected };
}

export interface AdTestModeDecision {
  /** Whether Google's demo inventory is in use (development builds only). */
  demoUnits: boolean;
  /** Registered device ids; empty on an ordinary production device. */
  testDeviceIds: string[];
  /** Human-readable mode, for the release auditor and documentation. */
  mode: "demo_units" | "registered_test_devices" | "live";
}

/**
 * The single decision point for how this build tests ads.
 *
 * Invariants:
 *  - a production build is NEVER globally forced into test mode: `demoUnits`
 *    is false in production no matter what is configured;
 *  - an ordinary production device (no configured ids) resolves to "live";
 *  - configuring test devices does not change unit selection at all.
 */
export function resolveAdTestMode(
  environment: AdEnvironment,
  rawDeviceIds: string | undefined | null,
): AdTestModeDecision {
  const { deviceIds } = resolveTestDeviceIds(rawDeviceIds);
  if (environment === "development") {
    return { demoUnits: true, testDeviceIds: deviceIds, mode: "demo_units" };
  }
  return {
    demoUnits: false,
    testDeviceIds: deviceIds,
    mode: deviceIds.length > 0 ? "registered_test_devices" : "live",
  };
}
