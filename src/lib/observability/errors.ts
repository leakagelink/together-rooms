/**
 * PHASE 12 — the error classification model.
 *
 * Every failure the backend handles is placed in one class. The class is what
 * decides three things, consistently, everywhere:
 *
 *   retryable  — may the same operation be attempted again unchanged?
 *   loggable   — what severity does it deserve?
 *   client     — what may the caller be told?
 *
 * Classes:
 *   RETRYABLE      a transient failure with a known cause (HTTP 5xx, 429 from a provider)
 *   TRANSIENT      an infrastructure hiccup with no clear cause (network reset, timeout)
 *   RATE_LIMIT     the caller exceeded a limit; retry only after the window
 *   PROVIDER       an external provider answered, but with something unusable
 *   VALIDATION     the input was wrong; retrying it unchanged cannot help
 *   SECURITY       an authorization/authentication failure; never auto-retried
 *   NON_RETRYABLE  a definite terminal answer (404/410, product mismatch)
 *   UNKNOWN        unclassified; treated as non-retryable and logged as an error
 */
export type ErrorClass =
  | "RETRYABLE"
  | "TRANSIENT"
  | "RATE_LIMIT"
  | "PROVIDER"
  | "VALIDATION"
  | "SECURITY"
  | "NON_RETRYABLE"
  | "UNKNOWN";

export interface ClassifiedError {
  errorClass: ErrorClass;
  /** May the identical operation be retried later? */
  retryable: boolean;
  /** Safe, non-actionable-for-an-attacker summary. Never a stack trace. */
  clientMessage: string;
  /** Short machine token for logs and metrics. Never free-form provider text. */
  reason: string;
}

const CLIENT_MESSAGE: Record<ErrorClass, string> = {
  RETRYABLE: "That didn't go through. Please try again in a moment.",
  TRANSIENT: "The connection dropped. Please try again.",
  RATE_LIMIT: "Too many attempts. Please wait a moment and try again.",
  PROVIDER: "A service we depend on isn't responding correctly right now.",
  VALIDATION: "Some of the details weren't valid. Check them and try again.",
  SECURITY: "You don't have access to this.",
  NON_RETRYABLE: "That request can't be completed.",
  UNKNOWN: "Something went wrong. Please try again.",
};

const RETRYABLE_CLASSES = new Set<ErrorClass>(["RETRYABLE", "TRANSIENT", "RATE_LIMIT"]);

export function isRetryableClass(errorClass: ErrorClass): boolean {
  return RETRYABLE_CLASSES.has(errorClass);
}

export function classified(errorClass: ErrorClass, reason: string): ClassifiedError {
  return {
    errorClass,
    retryable: isRetryableClass(errorClass),
    clientMessage: CLIENT_MESSAGE[errorClass],
    reason,
  };
}

/** Classifies an HTTP status returned by an external provider. */
export function classifyHttpStatus(status: number): ErrorClass {
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "RETRYABLE";
  if (status === 401 || status === 403) return "SECURITY";
  if (status === 404 || status === 410) return "NON_RETRYABLE";
  if (status === 408) return "TRANSIENT";
  if (status >= 400) return "VALIDATION";
  return "UNKNOWN";
}

/**
 * Named failure reasons produced by our own server modules. Keeping the map
 * explicit means a new failure mode has to be classified deliberately rather
 * than silently inheriting "retry forever".
 */
const REASON_CLASS: Record<string, ErrorClass> = {
  // billing verification
  verification_unavailable: "RETRYABLE",
  verification_failed: "PROVIDER",
  purchase_not_found: "NON_RETRYABLE",
  purchase_pending: "RETRYABLE",
  product_mismatch: "NON_RETRYABLE",
  package_mismatch: "NON_RETRYABLE",
  // acknowledgement
  not_configured: "RETRYABLE",
  not_acknowledgeable: "NON_RETRYABLE",
  request_failed: "RETRYABLE",
  // rtdn / oidc
  missing_token: "SECURITY",
  malformed_token: "SECURITY",
  unknown_key: "SECURITY",
  bad_signature: "SECURITY",
  bad_issuer: "SECURITY",
  bad_audience: "SECURITY",
  bad_email: "SECURITY",
  expired: "SECURITY",
  jwks_unavailable: "RETRYABLE",
  // generic
  rate_limited: "RATE_LIMIT",
  forbidden: "SECURITY",
  invalid_input: "VALIDATION",
  server_error: "RETRYABLE",
};

export function classifyReason(reason: string): ClassifiedError {
  return classified(REASON_CLASS[reason] ?? "UNKNOWN", reason);
}

/**
 * Last-resort classification of a thrown value. Deliberately never reads the
 * stack, and never puts provider text into `clientMessage`.
 */
export function classifyThrown(error: unknown): ClassifiedError {
  const raw = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const status = typeof raw["status"] === "number" ? (raw["status"] as number) : null;
  if (status !== null) return classified(classifyHttpStatus(status), `http_${status}`);

  const name = typeof raw["name"] === "string" ? (raw["name"] as string) : "";
  const message = typeof raw["message"] === "string" ? (raw["message"] as string).toLowerCase() : "";
  if (name === "AbortError" || message.includes("timeout") || message.includes("network")) {
    return classified("TRANSIENT", "network");
  }
  if (message.includes("rate limit") || message.includes("too many")) {
    return classified("RATE_LIMIT", "rate_limited");
  }
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return classified("SECURITY", "forbidden");
  }
  return classified("UNKNOWN", "unknown");
}
