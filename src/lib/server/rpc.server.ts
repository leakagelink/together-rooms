/**
 * Shared server-side helpers for the Phase 2 secure execution layer.
 *
 * Architecture note (see the Phase 2 report, section 8):
 * privileged room operations are implemented as narrowly scoped
 * SECURITY DEFINER RPCs in Postgres, and server functions are the only
 * client-reachable entry point to them. The RPC owns atomicity (row locks in
 * a single transaction); the server function owns tracing, input validation
 * and safe error shaping. Neither path ever needs the service role key,
 * except account deletion, which must reach the Auth admin API.
 */

/** Machine-readable failure reasons returned by the SQL layer. */
export type RpcReason =
  | "unauthorized"
  | "forbidden"
  | "invalid_code"
  | "invalid_invite"
  | "invalid_request"
  | "rate_limited"
  | "room_ended"
  | "room_expired"
  | "room_full"
  | "room_not_open"
  | "not_allowed"
  | "not_found"
  | "server_error";

export type RpcResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; reason: RpcReason };

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