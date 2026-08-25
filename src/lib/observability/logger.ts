/**
 * PHASE 12 — the structured logging boundary.
 *
 * All operational logging goes through this module. It exists so that:
 *  - every line has the same shape and can be parsed by a log pipeline,
 *  - redaction is applied in ONE place instead of at every call site,
 *  - the app is not coupled to a logging vendor (see `monitor.ts`).
 *
 * A line NEVER contains chat/note/research content, media bytes, access or
 * refresh tokens, purchase tokens, service-account credentials, call content,
 * or raw personal data. User and room identifiers are pseudonymised.
 */
import { pseudonymize, redact } from "./redaction";
import type { ErrorClass } from "./errors";
import type { LogCategory, LogLevel, LogOutcome } from "./taxonomy";

export interface LogInput {
  category: LogCategory;
  event: string;
  level?: LogLevel;
  outcome?: LogOutcome;
  correlationId?: string;
  /** Raw user id — pseudonymised before it is emitted. */
  userId?: string | null;
  /** Raw room id — pseudonymised before it is emitted. */
  roomId?: string | null;
  errorClass?: ErrorClass;
  reason?: string;
  /** Extra structured fields. Redacted; never free text from users. */
  data?: Record<string, unknown>;
}

export interface LogRecord {
  ts: string;
  level: LogLevel;
  category: LogCategory;
  event: string;
  outcome?: LogOutcome;
  correlation_id?: string;
  user_ref?: string;
  room_ref?: string;
  error_class?: ErrorClass;
  reason?: string;
  data?: Record<string, unknown>;
}

export type LogSink = (record: LogRecord) => void;

export function buildRecord(input: LogInput, now: () => number = Date.now): LogRecord {
  const record: LogRecord = {
    ts: new Date(now()).toISOString(),
    level: input.level ?? "info",
    category: input.category,
    event: input.event,
  };
  if (input.outcome) record.outcome = input.outcome;
  if (input.correlationId) record.correlation_id = input.correlationId;
  if (input.userId) record.user_ref = pseudonymize(input.userId);
  if (input.roomId) record.room_ref = pseudonymize(input.roomId);
  if (input.errorClass) record.error_class = input.errorClass;
  if (input.reason) record.reason = input.reason;
  if (input.data && Object.keys(input.data).length > 0) record.data = redact(input.data);
  return record;
}

const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else console.log(line);
};

let sink: LogSink = consoleSink;

/** Swaps the destination (used by tests and by a future log shipper). */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? consoleSink;
}

export function log(input: LogInput): LogRecord {
  const record = buildRecord(input);
  sink(record);
  return record;
}

/** Binds a category and correlation id so call sites stay short. */
export function createLogger(category: LogCategory, correlationId?: string) {
  return {
    info: (event: string, rest: Omit<LogInput, "category" | "event" | "level"> = {}) =>
      log({ category, event, level: "info", ...(correlationId ? { correlationId } : {}), ...rest }),
    warn: (event: string, rest: Omit<LogInput, "category" | "event" | "level"> = {}) =>
      log({ category, event, level: "warn", ...(correlationId ? { correlationId } : {}), ...rest }),
    error: (event: string, rest: Omit<LogInput, "category" | "event" | "level"> = {}) =>
      log({ category, event, level: "error", ...(correlationId ? { correlationId } : {}), ...rest }),
  };
}
