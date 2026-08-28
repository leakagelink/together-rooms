/**
 * Safe error handling.
 *
 * Internal / database error text is never shown to users and never logged with
 * request payloads. We map known cases to friendly copy and fall back to a
 * generic message.
 */
export type AppErrorCode =
  | "auth_invalid_credentials"
  | "auth_email_not_confirmed"
  | "auth_rate_limited"
  | "auth_weak_password"
  | "auth_pwned_password"
  | "auth_email_taken"
  | "auth_invalid_email"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "offline"
  | "unknown";

export interface AppError {
  code: AppErrorCode;
  message: string;
}

const FRIENDLY: Record<AppErrorCode, string> = {
  auth_invalid_credentials: "That email or password doesn't match our records.",
  auth_email_not_confirmed: "Confirm your email address first, then sign in.",
  auth_rate_limited: "Too many attempts. Please wait a moment and try again.",
  auth_weak_password:
    "That password is too weak. Use at least 10 characters with an upper case letter, a lower case letter and a number.",
  auth_pwned_password:
    "This password has appeared in a known data breach. Please choose a different one.",
  auth_email_taken: "An account with this email already exists. Try signing in instead.",
  auth_invalid_email: "Enter a valid email address.",
  not_found: "We couldn't find that. It may have been removed or expired.",
  forbidden: "You don't have access to this.",
  conflict: "That value is already taken.",
  offline: "You appear to be offline. Check your connection and retry.",
  unknown: "Something went wrong. Please try again.",
};

export function toAppError(error: unknown): AppError {
  const raw = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const message =
    typeof raw["message"] === "string" ? (raw["message"] as string).toLowerCase() : "";
  const code = typeof raw["code"] === "string" ? (raw["code"] as string) : "";

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { code: "offline", message: FRIENDLY.offline };
  }
  if (message.includes("invalid login credentials")) {
    return { code: "auth_invalid_credentials", message: FRIENDLY.auth_invalid_credentials };
  }
  if (message.includes("email not confirmed")) {
    return { code: "auth_email_not_confirmed", message: FRIENDLY.auth_email_not_confirmed };
  }
  if (message.includes("rate limit") || message.includes("too many")) {
    return { code: "auth_rate_limited", message: FRIENDLY.auth_rate_limited };
  }
  if (code === "23505" || message.includes("duplicate key")) {
    return { code: "conflict", message: FRIENDLY.conflict };
  }
  if (
    code === "42501" ||
    message.includes("row-level security") ||
    message.includes("permission denied")
  ) {
    return { code: "forbidden", message: FRIENDLY.forbidden };
  }
  if (code === "PGRST116") {
    return { code: "not_found", message: FRIENDLY.not_found };
  }
  return { code: "unknown", message: FRIENDLY.unknown };
}

export function errorMessage(error: unknown) {
  return toAppError(error).message;
}
