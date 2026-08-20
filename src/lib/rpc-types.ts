/**
 * Client-safe result contract shared by the Phase 2 server functions.
 *
 * Architecture note (see the Phase 2 report, section 8): privileged room
 * operations are narrowly scoped SECURITY DEFINER RPCs in Postgres, and server
 * functions are the only client-reachable entry point to them. The RPC owns
 * atomicity (row locks inside one transaction); the server function owns
 * tracing, input validation and safe error shaping.
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

/** JSON values that survive the server-function serialization boundary. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type RpcResult<T extends object = {}> =
  ({ ok: true } & T) | { ok: false; reason: RpcReason };

const MESSAGES: Record<RpcReason, string> = {
  unauthorized: "Sign in to continue.",
  forbidden: "You don't have permission to do that.",
  // Deliberately identical for "no such code" and "code not usable by you":
  // distinguishing them would allow room enumeration.
  invalid_code: "That code isn't valid.",
  invalid_invite: "That invite link isn't valid or has already been used.",
  invalid_request: "Check the details and try again.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  room_ended: "That room has ended.",
  room_expired: "That room has expired.",
  room_full: "That room is full.",
  room_not_open: "That room isn't open yet.",
  not_allowed: "You can't join that room.",
  not_found: "We couldn't find that.",
  server_error: "Something went wrong. Try again.",
};

export function rpcMessage(reason: RpcReason): string {
  return MESSAGES[reason] ?? MESSAGES.server_error;
}
