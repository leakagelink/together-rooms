/**
 * Phase 7 — analytics safety net for local media sharing.
 *
 * Local media analytics may only ever describe the *operation*: which kind of
 * media, which transport state, why a connection failed. Filenames, device
 * paths, EXIF/GPS data and — obviously — media bytes must never reach the
 * analytics table, so anything resembling them is dropped here before the
 * event is emitted, in addition to callers simply not collecting it.
 */
import type { AnalyticsProperties } from "@/lib/analytics";

/** Property keys that are never allowed on a local media event. */
export const FORBIDDEN_PROPERTY_PATTERNS: readonly RegExp[] = [
  /file_?name/i,
  /^name$/i,
  /path/i,
  /uri$/i,
  /^url$/i,
  /exif/i,
  /gps/i,
  /latitude|longitude|geo|location/i,
  /thumbnail|preview|frame|sample|blob|base64|data_?url|bytes|content/i,
  /token|credential|secret|ice|candidate|sdp|address|ip_?addr/i,
];

export const ALLOWED_LOCAL_MEDIA_KEYS = [
  "media_kind",
  "transport_state",
  "role",
  "reason",
  "item_count",
  "duration_bucket",
] as const;

export type LocalMediaAnalyticsKey = (typeof ALLOWED_LOCAL_MEDIA_KEYS)[number];

function isForbidden(key: string): boolean {
  return FORBIDDEN_PROPERTY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Allow-list first, deny-list second. Values are additionally clamped to short
 * scalars so a long string can never smuggle content through an allowed key.
 */
export function sanitizeLocalMediaProperties(input: AnalyticsProperties): AnalyticsProperties {
  const out: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(input)) {
    if (isForbidden(key)) continue;
    if (!(ALLOWED_LOCAL_MEDIA_KEYS as readonly string[]).includes(key)) continue;
    if (typeof value === "string") {
      if (value.length > 32) continue;
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

/** Coarse duration buckets, so no exact media length is ever recorded. */
export function durationBucket(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "unknown";
  if (seconds < 60) return "lt_1m";
  if (seconds < 600) return "lt_10m";
  if (seconds < 3600) return "lt_1h";
  return "gte_1h";
}
