/** Shared server-side helpers for the Phase 2 secure execution layer. */
import type { RpcResult } from "../rpc-types";

/** Correlates a server-function failure with its server log line. */
export function newTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Normalizes an RPC response. Postgres-level errors are logged with a trace id
 * and collapsed into a generic reason so no database internals reach the browser.
 */
export function normalizeRpc<T extends Record<string, unknown>>(
  operation: string,
  data: unknown,
  error: { message: string } | null,
): RpcResult<T> {
  if (error) {
    const traceId = newTraceId();
    console.error(`[${operation}] trace=${traceId}`, error.message);
    return { ok: false, reason: "server_error" };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "server_error" };
  }
  return data as RpcResult<T>;
}