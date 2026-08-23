/**
 * PHASE 8 — call telemetry safety.
 *
 * Calls are live communication only. No audio, no video, no transcript, no
 * device identity may ever reach analytics. This module is the single choke
 * point: only an allow-list of coarse operational fields survives, and every
 * value is bounded so a token or a device label cannot be smuggled through.
 */
import type { AnalyticsProperties } from "@/lib/analytics";

/** The only properties a call event may carry. */
export const CALL_ALLOWED_KEYS = [
  "call_mode",
  "role",
  "participant_bucket",
  "connection_state",
  "reason_code",
  "duration_bucket",
] as const;

export type CallAnalyticsKey = (typeof CALL_ALLOWED_KEYS)[number];

/** Free-form values are bounded; anything longer is dropped, not truncated. */
const MAX_VALUE_LENGTH = 32;

/** Keys that would carry identity, media or credentials if ever allowed. */
const FORBIDDEN_HINTS = [
  "audio",
  "video_track",
  "stream",
  "token",
  "credential",
  "ip",
  "address",
  "device",
  "mic_name",
  "camera_name",
  "label",
  "sdp",
  "candidate",
  "transcript",
  "recording",
];

function allowed(key: string): key is CallAnalyticsKey {
  return (CALL_ALLOWED_KEYS as readonly string[]).includes(key);
}

/** Coarse participant bucket: never an exact head count of a private room. */
export function participantBucket(count: number): string {
  if (!Number.isFinite(count) || count <= 1) return "solo";
  if (count === 2) return "pair";
  if (count <= 4) return "small";
  return "group";
}

/** Coarse call-length bucket in place of a precise duration. */
export function callDurationBucket(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "unknown";
  if (seconds < 60) return "under_1m";
  if (seconds < 300) return "under_5m";
  if (seconds < 1800) return "under_30m";
  return "over_30m";
}

/**
 * Strips every property that is not an explicitly allowed operational field.
 * Media contents cannot pass because they are not on the allow-list, and
 * oversized/complex values are dropped rather than trimmed.
 */
export function sanitizeCallProperties(input: Record<string, unknown>): AnalyticsProperties {
  const out: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(input)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_HINTS.some((hint) => lower.includes(hint)) && !allowed(key)) continue;
    if (!allowed(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length > 0 && value.length <= MAX_VALUE_LENGTH) {
      out[key] = value;
    }
  }
  return out;
}
