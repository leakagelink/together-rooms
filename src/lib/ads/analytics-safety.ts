/**
 * PHASE 9 — ad analytics safety.
 *
 * Ad telemetry is operational only. Room content, chat text, notes, media,
 * filenames, call data, tokens and identifiers of other people can never reach
 * an analytics event, so the payload is built from an explicit allow-list.
 */
import type { AnalyticsProperties } from "@/lib/analytics";

const ALLOWED_KEYS = [
  "format",
  "placement",
  "eligible",
  "reason",
  "non_personalized",
  "test_mode",
  "session_ad_count",
] as const;

export type AdEventField = (typeof ALLOWED_KEYS)[number];

/** Keys that must never appear, even if a caller adds them by mistake. */
const FORBIDDEN_SUBSTRINGS = [
  "message",
  "content",
  "text",
  "note",
  "title",
  "url",
  "file",
  "name",
  "token",
  "email",
  "room_id",
  "user_id",
  "media",
  "transcript",
];

export function sanitizeAdEvent(input: Record<string, unknown>): AnalyticsProperties {
  const out: AnalyticsProperties = {};
  for (const key of ALLOWED_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value === "string") {
      if (FORBIDDEN_SUBSTRINGS.some((bad) => key.toLowerCase().includes(bad))) continue;
      out[key] = value.slice(0, 64);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

/** True when a payload is safe to send (used by tests and dev assertions). */
export function isAdEventSafe(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).every(
    (key) =>
      (ALLOWED_KEYS as readonly string[]).includes(key) &&
      !FORBIDDEN_SUBSTRINGS.some((bad) => key.toLowerCase().includes(bad)),
  );
}
