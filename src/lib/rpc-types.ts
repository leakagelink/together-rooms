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
  | "muted"
  | "duplicate_message"
  | "message_not_editable"
  | "edit_window_expired"
  | "version_conflict"
  | "duplicate_item"
  | "queue_empty"
  | "queue_full"
  | "provider_verification_failed"
  | "made_for_kids"
  | "not_embeddable"
  | "privacy_blocked"
  | "unavailable"
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
  muted: "You're muted in this room.",
  duplicate_message: "You just sent that message.",
  message_not_editable: "That message can no longer be edited.",
  edit_window_expired: "The 15-minute edit window has passed.",
  version_conflict: "Playback changed a moment ago. Resynced to the latest state.",
  duplicate_item: "That track is already in the queue.",
  queue_empty: "The queue is empty.",
  queue_full: "The queue is full.",
  provider_verification_failed: "We couldn't verify this video with YouTube. Try again.",
  made_for_kids: "This video is marked Made for Kids and can't be played here.",
  not_embeddable: "The owner doesn't allow this video to be played outside YouTube.",
  privacy_blocked: "This video is private.",
  unavailable: "This video is unavailable on YouTube.",
  server_error: "Something went wrong. Try again.",
};

export function rpcMessage(reason: RpcReason): string {
  return MESSAGES[reason] ?? MESSAGES.server_error;
}
