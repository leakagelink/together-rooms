/**
 * PHASE 12 — redaction rules for structured logs and monitoring payloads.
 *
 * The rule is deny-by-default for anything that could carry user content or a
 * credential. Three mechanisms combine:
 *
 *  1. KEY DENY LIST — a field whose name looks like content or a credential is
 *     replaced with "[redacted]" whatever its value.
 *  2. VALUE SCANNING — a value that LOOKS like a credential (JWT, PEM block,
 *     Google/Supabase key prefixes, long opaque token) is redacted even under
 *     an innocent key name, because the caller may have nested it.
 *  3. PSEUDONYMISATION — user and room identifiers become short stable digests
 *     so that operators can correlate lines without the log becoming a
 *     membership database.
 *
 * The digest is a fast non-cryptographic hash. It is a privacy measure for
 * logs (it removes the raw identifier and is not reversible by reading), NOT a
 * security control — nothing authenticates on it.
 */

const DENY_KEY_PATTERNS: RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /authorization/i,
  /api[-_]?key/i,
  /private[-_]?key/i,
  /service[-_]?account/i,
  /session/i,
  /cookie/i,
  /\bjwt\b/i,
  // user content
  /content/i,
  /message(_body)?$/i,
  /\bbody\b/i,
  /\btext\b/i,
  /\bnote\b/i,
  /\bnotes\b/i,
  /\btitle\b/i,
  /description/i,
  /transcript/i,
  /\bemail\b/i,
  /\bphone\b/i,
  /avatar/i,
  /^bio$/i,
  /\bbio\b/i,
  /display[-_]?name/i,
  /username/i,
  /\burl\b/i,
  /\bquery\b/i,
  /\bprompt\b/i,
];

/** Keys that are explicitly safe even though they match a deny pattern. */
const ALLOW_KEYS = new Set([
  "token_hash",
  "purchase_token_hash",
  "content_type",
  "error_class",
  "message_id",
  "session_id",
]);

const VALUE_PATTERNS: RegExp[] = [
  /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^sb_(secret|publishable)_/,
  /^AIza[0-9A-Za-z_-]{20,}/, // Google API key
  /^ya29\./, // Google OAuth access token
  /^[A-Za-z0-9_-]{60,}$/, // long opaque blob (Play purchase tokens live here)
];

export const REDACTED = "[redacted]";

/** Short, stable, non-reversible-by-inspection digest of an identifier. */
export function pseudonymize(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
}

export function isDeniedKey(key: string): boolean {
  if (ALLOW_KEYS.has(key)) return false;
  return DENY_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function looksSensitive(value: string): boolean {
  return VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

const MAX_STRING = 120;
const MAX_DEPTH = 4;
const MAX_KEYS = 32;

function redactValue(value: unknown, depth: number): unknown {
  // Depth is enforced for every value, not just objects: a sensitive string
  // buried deep in a nested payload must not slip out under the limit.
  if (depth >= MAX_DEPTH) return "[depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (looksSensitive(value)) return REDACTED;
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => redactValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return redactRecord(value as Record<string, unknown>, depth + 1);
  }
  // functions, symbols, class instances: never logged
  return "[unsupported]";
}

function redactRecord(input: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_KEYS) {
      out["_truncated"] = true;
      break;
    }
    count += 1;
    out[key] = isDeniedKey(key) ? REDACTED : redactValue(value, depth);
  }
  return out;
}

/** Redacts an arbitrary structured payload before it leaves the process. */
export function redact(input: Record<string, unknown>): Record<string, unknown> {
  return redactRecord(input, 0);
}
