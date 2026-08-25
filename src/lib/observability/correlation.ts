/**
 * PHASE 12 — correlation identifiers.
 *
 * A correlation id ties the steps of one logical operation together across
 * modules and processes, e.g.
 *
 *   RTDN delivery → OIDC verification → dedupe claim → Play verification
 *   → apply_billing_event → acknowledgement → audit row
 *
 * Rules:
 *  - it is an opaque random token; it never encodes a user, room or purchase,
 *  - inbound ids are accepted only when they are plainly formatted, so a
 *    caller cannot inject log-breaking or oversized values,
 *  - it is never surfaced in a UI, and only echoed on server-to-server
 *    responses (the RTDN endpoint) where an operator needs it.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function newCorrelationId(prefix = "cid"): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return `${prefix}_${out}`;
}

/** Accepts a caller-supplied id only if it is safe; otherwise mints a new one. */
export function sanitizeCorrelationId(value: string | null | undefined, prefix = "cid"): string {
  if (typeof value === "string" && SAFE_ID.test(value)) return value;
  return newCorrelationId(prefix);
}

const HEADER_CANDIDATES = ["x-correlation-id", "x-request-id", "ce-id", "traceparent"];

/** Derives a correlation id for an inbound HTTP request. */
export function correlationFromHeaders(headers: Headers, prefix = "req"): string {
  for (const name of HEADER_CANDIDATES) {
    const value = headers.get(name);
    if (value && SAFE_ID.test(value)) return value;
  }
  return newCorrelationId(prefix);
}

/** Derives a deterministic child id so sub-steps stay linked to their parent. */
export function childCorrelationId(parent: string, step: string): string {
  return `${parent}.${step.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}`;
}
