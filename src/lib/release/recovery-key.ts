/**
 * PHASE 13 — billing recovery key configuration and rotation model.
 *
 * `BILLING_TOKEN_RECOVERY_KEY_V<n>` protects the encrypted purchase-token
 * envelopes. There is no KMS/HSM on this platform: these are server-side
 * environment secrets. That reality drives two rules encoded here:
 *
 *   1. A production deployment without the CURRENT key version is a hard
 *      failure — recovery would silently stop working.
 *   2. Rotation is additive. The previous key version must remain configured
 *      until every outstanding envelope has expired (recovery retention), or
 *      rotation destroys access to purchases that still need acknowledgement.
 *
 * Pure: the caller passes the set of key versions it can see.
 */

import { RECOVERY_RETENTION_MS } from "@/lib/billing/token-crypto.server";

export type RecoveryKeyProblem =
  | "missing_current_key"
  | "weak_key"
  | "previous_key_removed_too_early"
  | "invalid_key_version";

export interface RecoveryKeyInput {
  /** Key version this deployment encrypts with. */
  currentVersion: number;
  /** Versions whose secrets are actually present, with their lengths. */
  available: readonly { version: number; length: number }[];
  /**
   * Versions that still have outstanding (unsettled, unexpired) envelopes in
   * `billing_ack_state`. Decryption of those requires their key.
   */
  versionsWithOutstandingEnvelopes?: readonly number[];
}

export interface RecoveryKeyResult {
  ok: boolean;
  problems: RecoveryKeyProblem[];
  /** Versions that must stay configured right now. */
  requiredVersions: number[];
}

export const MIN_RECOVERY_KEY_LENGTH = 32;

export function validateRecoveryKeyConfig(input: RecoveryKeyInput): RecoveryKeyResult {
  const problems: RecoveryKeyProblem[] = [];
  const available = new Map(input.available.map((k) => [k.version, k.length]));

  if (!Number.isInteger(input.currentVersion) || input.currentVersion < 1) {
    problems.push("invalid_key_version");
  }

  const currentLength = available.get(input.currentVersion);
  if (currentLength === undefined) problems.push("missing_current_key");
  else if (currentLength < MIN_RECOVERY_KEY_LENGTH) problems.push("weak_key");

  const outstanding = input.versionsWithOutstandingEnvelopes ?? [];
  for (const version of outstanding) {
    const length = available.get(version);
    if (length === undefined) {
      if (!problems.includes("previous_key_removed_too_early")) {
        problems.push("previous_key_removed_too_early");
      }
    } else if (length < MIN_RECOVERY_KEY_LENGTH && !problems.includes("weak_key")) {
      problems.push("weak_key");
    }
  }

  const required = [...new Set([input.currentVersion, ...outstanding])].sort((a, b) => a - b);
  return { ok: problems.length === 0, problems, requiredVersions: required };
}

export interface RotationStep {
  order: number;
  action: string;
  destructive: boolean;
}

/**
 * The supported (non-destructive) rotation sequence. Old envelopes stay
 * readable throughout because decryption picks the key version recorded in the
 * envelope itself, not the current one.
 */
export function rotationPlan(fromVersion: number, toVersion: number): RotationStep[] {
  const retentionDays = Math.ceil(RECOVERY_RETENTION_MS / (24 * 60 * 60 * 1000));
  return [
    {
      order: 1,
      action: `Generate a new 64-character random secret and store it as BILLING_TOKEN_RECOVERY_KEY_V${toVersion}. Do not touch V${fromVersion}.`,
      destructive: false,
    },
    {
      order: 2,
      action: `Deploy with both V${fromVersion} and V${toVersion} present, and BILLING_TOKEN_RECOVERY_KEY_VERSION=${toVersion}. New envelopes are sealed with V${toVersion}; existing V${fromVersion} envelopes still open.`,
      destructive: false,
    },
    {
      order: 3,
      action: `Wait at least ${retentionDays} days (the recovery retention window) and confirm no billing_ack_state row still carries recovery_key_version=${fromVersion}.`,
      destructive: false,
    },
    {
      order: 4,
      action: `Only then remove BILLING_TOKEN_RECOVERY_KEY_V${fromVersion}.`,
      destructive: true,
    },
  ];
}

/** True when removing `version` right now would destroy recoverable data. */
export function rotationIsSafe(
  removingVersion: number,
  versionsWithOutstandingEnvelopes: readonly number[],
): boolean {
  return !versionsWithOutstandingEnvelopes.includes(removingVersion);
}
