/**
 * PHASE 12 — the event taxonomy.
 *
 * Every structured log line names a category and an event. Keeping the names
 * in one place is what makes dashboards and alerts possible later: a metric is
 * "count of BILLING/verification_failed", not "grep for a sentence someone
 * wrote in a console.log".
 */
export const LOG_CATEGORIES = [
  "AUTH",
  "ROOM",
  "PLAYBACK",
  "CHAT",
  "MODERATION",
  "MEDIA",
  "CALL",
  "BILLING",
  "RTDN",
  "ADS",
  "CONSENT",
  "SECURITY",
  "SYSTEM",
] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Result of the operation the line describes. */
export type LogOutcome = "ok" | "denied" | "failed" | "skipped" | "retry_scheduled" | "terminal";

export function isLogCategory(value: string): value is LogCategory {
  return (LOG_CATEGORIES as readonly string[]).includes(value);
}
