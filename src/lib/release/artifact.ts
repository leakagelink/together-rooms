/**
 * PHASE 13 — release candidate configuration audit.
 *
 * One pure function that answers: "would this build be safe to upload to a
 * Play testing track?" It composes the checks that already exist (runtime
 * config, billing product config, ad units, scheduler, recovery key) and adds
 * the artifact-level facts that only exist at packaging time.
 *
 * It audits CONFIGURATION only. It cannot inspect a signed .aab — generating
 * and inspecting the artifact remains a manual step (docs/RELEASE.md).
 */

import { resolveAdUnits, type AdUnits } from "@/lib/ads/config";
import { resolveProductConfig, EXPECTED_PACKAGE_NAME } from "@/lib/billing/products";
import { validateRuntimeConfig, type RuntimeConfigInput } from "@/lib/android/environment";

import { validateRecoveryKeyConfig, type RecoveryKeyInput } from "./recovery-key";
import { validateSchedulerConfig, type SchedulerConfigInput } from "./scheduler";

export type ReleaseProblem =
  | "package_mismatch"
  | "missing_version_code"
  | "non_monotonic_version_code"
  | "invalid_version_name"
  | "debuggable_release"
  | "unsigned_release"
  | "debug_signing_in_release"
  | "webview_debugging_enabled"
  | "cleartext_enabled"
  | "min_sdk_too_low"
  | "target_sdk_too_low"
  | `runtime:${string}`
  | `billing:${string}`
  | `ads:${string}`
  | `scheduler:${string}`
  | `recovery_key:${string}`;

export interface ArtifactFacts {
  packageName: string;
  versionCode: number | undefined;
  versionName: string | undefined;
  /** versionCode already used on the track, if any. */
  previousVersionCode?: number | undefined;
  debuggable: boolean;
  signedWithReleaseKey: boolean;
  usesDebugKeystore: boolean;
  webContentsDebuggingEnabled: boolean;
  cleartextTrafficPermitted: boolean;
  minSdk: number;
  targetSdk: number;
}

export interface ReleaseAuditInput {
  artifact: ArtifactFacts;
  runtime: RuntimeConfigInput;
  billing: { premiumProductId?: string | undefined; packageName?: string | undefined };
  ads: Partial<AdUnits>;
  scheduler: SchedulerConfigInput;
  recoveryKey: RecoveryKeyInput;
}

export interface ReleaseAuditResult {
  ok: boolean;
  problems: ReleaseProblem[];
}

/** Play's policy floor at the time of writing; bump deliberately, not silently. */
export const REQUIRED_MIN_SDK = 23;
export const REQUIRED_TARGET_SDK = 34;

const VERSION_NAME_PATTERN = /^\d+\.\d+\.\d+$/;

export function auditReleaseCandidate(input: ReleaseAuditInput): ReleaseAuditResult {
  const problems: ReleaseProblem[] = [];
  const a = input.artifact;

  if (a.packageName !== EXPECTED_PACKAGE_NAME) problems.push("package_mismatch");
  if (!a.versionCode || !Number.isInteger(a.versionCode) || a.versionCode < 1) {
    problems.push("missing_version_code");
  } else if (a.previousVersionCode !== undefined && a.versionCode <= a.previousVersionCode) {
    problems.push("non_monotonic_version_code");
  }
  if (!a.versionName || !VERSION_NAME_PATTERN.test(a.versionName)) {
    problems.push("invalid_version_name");
  }
  if (a.debuggable) problems.push("debuggable_release");
  if (!a.signedWithReleaseKey) problems.push("unsigned_release");
  if (a.usesDebugKeystore) problems.push("debug_signing_in_release");
  if (a.webContentsDebuggingEnabled) problems.push("webview_debugging_enabled");
  if (a.cleartextTrafficPermitted) problems.push("cleartext_enabled");
  if (a.minSdk < REQUIRED_MIN_SDK) problems.push("min_sdk_too_low");
  if (a.targetSdk < REQUIRED_TARGET_SDK) problems.push("target_sdk_too_low");

  const runtime = validateRuntimeConfig({ ...input.runtime, mode: "production" });
  for (const problem of runtime.problems) problems.push(`runtime:${problem}` as ReleaseProblem);

  const billing = resolveProductConfig("production", input.billing);
  for (const problem of billing.problems) problems.push(`billing:${problem}` as ReleaseProblem);

  const ads = resolveAdUnits("production", input.ads);
  if (ads.configError) problems.push(`ads:${ads.configError}` as ReleaseProblem);

  const scheduler = validateSchedulerConfig(input.scheduler);
  for (const problem of scheduler.problems) {
    problems.push(`scheduler:${problem}` as ReleaseProblem);
  }

  const key = validateRecoveryKeyConfig(input.recoveryKey);
  for (const problem of key.problems) problems.push(`recovery_key:${problem}` as ReleaseProblem);

  return { ok: problems.length === 0, problems };
}
