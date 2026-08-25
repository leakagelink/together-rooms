/**
 * PHASE 10 — crash/error reporting boundary.
 *
 * No third-party crash SDK is integrated in this phase. What exists is the
 * boundary a provider would later plug into, plus the redaction rules that
 * apply BEFORE anything leaves the device.
 *
 * Never reportable: chat text, note/task content, media bytes or filenames,
 * call contents, access/refresh tokens, transport grants, purchase tokens,
 * billing secrets, email addresses.
 */

export interface CrashReport {
  message: string;
  stack?: string;
  route: string;
  environment: string;
  /** Only primitive, non-identifying operational values survive redaction. */
  context: Record<string, string | number | boolean>;
}

export interface CrashSink {
  send(report: CrashReport): void;
}

const TOKEN_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /sb_(secret|publishable)_[A-Za-z0-9_-]+/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email
  /\b[a-f0-9]{64}\b/gi, // hashed transport grant / purchase token
  /(?:Bearer|token|apikey|api_key|password|purchaseToken)[=:\s"']+[^\s"',}]+/gi,
];

const FORBIDDEN_CONTEXT_KEYS = new Set([
  "message",
  "content",
  "body",
  "text",
  "note",
  "task",
  "filename",
  "file",
  "path",
  "url",
  "token",
  "access_token",
  "refresh_token",
  "purchase_token",
  "email",
  "grant",
  "transport_token",
  "sdp",
  "candidate",
]);

export function redactText(input: string): string {
  return TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "[redacted]"), input).slice(
    0,
    4000,
  );
}

export function redactContext(
  context: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context)) {
    if (FORBIDDEN_CONTEXT_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      out[key] = redactText(value);
    }
    // Objects/arrays are dropped: they are the usual vehicle for payload leaks.
  }
  return out;
}

export function buildCrashReport(input: {
  error: unknown;
  route: string;
  environment: string;
  context?: Record<string, unknown>;
}): CrashReport {
  const error = input.error;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  const stack = error instanceof Error ? error.stack : undefined;
  return {
    message: redactText(message),
    ...(stack ? { stack: redactText(stack) } : {}),
    route: input.route,
    environment: input.environment,
    context: redactContext(input.context ?? {}),
  };
}

let sink: CrashSink | null = null;

/** A production provider is registered here — and nowhere else. */
export function registerCrashSink(next: CrashSink | null): void {
  sink = next;
}

export function reportCrash(input: {
  error: unknown;
  route: string;
  environment: string;
  context?: Record<string, unknown>;
}): CrashReport | null {
  const report = buildCrashReport(input);
  sink?.send(report);
  return sink ? report : null;
}
