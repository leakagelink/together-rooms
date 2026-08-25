/**
 * PHASE 12 — provider-neutral monitoring boundary.
 *
 * NOTE: no monitoring vendor is integrated. This is deliberately an empty
 * adapter: it defines the contract a crash reporter / error tracker / metrics
 * backend would implement, and routes everything through the same redaction
 * as the logger. Until an adapter is registered the calls are no-ops beyond
 * structured logging, and nothing in the app depends on a vendor SDK.
 */
import { classifyThrown, type ClassifiedError } from "./errors";
import { log } from "./logger";
import { redact } from "./redaction";
import type { LogCategory } from "./taxonomy";

export interface MonitoringAdapter {
  name: string;
  captureError?(payload: {
    category: LogCategory;
    event: string;
    errorClass: string;
    reason: string;
    correlationId?: string;
    context?: Record<string, unknown>;
  }): void;
  recordMetric?(name: string, value: number, tags?: Record<string, string>): void;
  recordTiming?(name: string, milliseconds: number, tags?: Record<string, string>): void;
}

let adapter: MonitoringAdapter | null = null;

export function registerMonitoringAdapter(next: MonitoringAdapter | null): void {
  adapter = next;
}

export function monitoringAdapterName(): string | null {
  return adapter?.name ?? null;
}

/** Reports a failure to logs and, if configured, to the monitoring adapter. */
export function captureError(
  category: LogCategory,
  event: string,
  error: unknown,
  options: { correlationId?: string; context?: Record<string, unknown> } = {},
): ClassifiedError {
  const info = classifyThrown(error);
  log({
    category,
    event,
    level: info.errorClass === "SECURITY" ? "warn" : "error",
    outcome: "failed",
    errorClass: info.errorClass,
    reason: info.reason,
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    ...(options.context ? { data: options.context } : {}),
  });
  adapter?.captureError?.({
    category,
    event,
    errorClass: info.errorClass,
    reason: info.reason,
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    ...(options.context ? { context: redact(options.context) } : {}),
  });
  return info;
}

/**
 * Counter/gauge emission. Metric names come from the operational dashboard
 * requirements in docs/OPERATIONS.md; tags must be low-cardinality and must
 * never contain a user, room or purchase identifier.
 */
export function recordMetric(name: string, value = 1, tags?: Record<string, string>): void {
  adapter?.recordMetric?.(name, value, tags);
}

export function recordTiming(name: string, milliseconds: number, tags?: Record<string, string>) {
  adapter?.recordTiming?.(name, milliseconds, tags);
}
