/**
 * PHASE 14 — the native ad bridge error boundary.
 *
 * The Google Mobile Ads SDK and the UMP SDK produce free-form, vendor-specific
 * failure text ("No fill from mediation adapter …", domain/code pairs, request
 * ids). None of it is safe or useful to show a user, and none of it may be
 * logged verbatim, because it is attacker-influenceable text arriving from
 * outside the app.
 *
 * Every value that crosses the native boundary therefore passes through here
 * and comes out as a Phase 12 `ClassifiedError` built from a short machine
 * token — never the provider's own sentence.
 */
import { classified, type ClassifiedError } from "@/lib/observability/errors";

/** The only ad failure tokens that may ever be recorded. */
export const AD_BRIDGE_REASONS = [
  "bridge_unavailable",
  "bridge_method_missing",
  "sdk_init_failed",
  "no_fill",
  "network",
  "invalid_request",
  "internal",
  "consent_failed",
  "unknown",
] as const;

export type AdBridgeReason = (typeof AD_BRIDGE_REASONS)[number];

/**
 * Google's canonical error codes (`AdRequest.ERROR_CODE_*`) mapped onto our
 * tokens. Anything else becomes "unknown"; nothing is passed through.
 */
const CODE_REASON: Record<number, AdBridgeReason> = {
  0: "internal", // ERROR_CODE_INTERNAL_ERROR
  1: "invalid_request", // ERROR_CODE_INVALID_REQUEST
  2: "network", // ERROR_CODE_NETWORK_ERROR
  3: "no_fill", // ERROR_CODE_NO_FILL
};

function reasonFromValue(value: unknown): AdBridgeReason {
  if (typeof value === "object" && value !== null) {
    const raw = value as Record<string, unknown>;
    const code = raw["code"];
    if (typeof code === "number" && CODE_REASON[code]) return CODE_REASON[code];
    const token = raw["reason"];
    if (typeof token === "string" && (AD_BRIDGE_REASONS as readonly string[]).includes(token)) {
      return token as AdBridgeReason;
    }
  }
  if (typeof value === "string" && (AD_BRIDGE_REASONS as readonly string[]).includes(value)) {
    return value as AdBridgeReason;
  }
  return "unknown";
}

const RETRYABLE: AdBridgeReason[] = ["network"];

/**
 * Converts anything thrown or returned by the native bridge into a classified,
 * sanitized error. `clientMessage` is a generic Phase 12 sentence and the
 * `reason` is one of the fixed tokens above — provider text never survives.
 */
export function sanitizeBridgeError(value: unknown): ClassifiedError {
  const reason = reasonFromValue(value);
  if (reason === "invalid_request") return classified("VALIDATION", reason);
  if (RETRYABLE.includes(reason)) return classified("TRANSIENT", reason);
  if (reason === "no_fill") return classified("NON_RETRYABLE", reason);
  if (reason === "unknown") return classified("UNKNOWN", reason);
  return classified("PROVIDER", reason);
}

/**
 * True when a sanitized payload is free of vendor text. Used by tests and as a
 * guard before anything ad-related is logged.
 */
export function isSanitizedAdError(error: ClassifiedError): boolean {
  return (AD_BRIDGE_REASONS as readonly string[]).includes(error.reason);
}
