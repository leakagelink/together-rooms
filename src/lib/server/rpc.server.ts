/** Shared server-side helpers for the Phase 2 secure execution layer. */
import type { RpcResult } from "../rpc-types";

/** Correlates a server-function failure with its server log line. */
export function newTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Builds RPC arguments where optional parameters are omitted entirely rather
 * than sent as null/undefined, so Postgres applies its own DEFAULTs and the
 * generated argument types stay satisfied.
 */
export function rpcArgs<R extends object, O extends object>(
  required: R,
  optional: O,
): R & { [K in keyof O]?: NonNullable<O[K]> } {
  const out: Record<string, unknown> = { ...required };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out as R & { [K in keyof O]?: NonNullable<O[K]> };
}


/**
 * Normalizes an RPC response. Postgres-level errors are logged with a trace id
 * and collapsed into a generic reason so no database internals reach the browser.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function normalizeRpc<T extends object = {}>(
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
