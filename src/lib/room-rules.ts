/**
 * Pure mirrors of the room business rules enforced in Postgres.
 *
 * These are the client-side previews and the unit-testable specification of
 * the SQL logic. They are NOT the security boundary — the database functions
 * (`room_is_joinable`, `admit_member`, `pick_room_successor`) are.
 */

export const JOIN_CODE_PATTERN = /^[A-Z0-9]{6,12}$/;
export const INVITE_TOKEN_PATTERN = /^[a-f0-9]{48}$/;

export function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidJoinCode(raw: string): boolean {
  return JOIN_CODE_PATTERN.test(normalizeJoinCode(raw));
}

export function isValidInviteToken(raw: string): boolean {
  return INVITE_TOKEN_PATTERN.test(raw.trim());
}

export type RoomJoinability = "ok" | "room_ended" | "room_expired" | "room_not_open";

export interface RoomLifecycleState {
  status: string;
  expires_at: string | null;
}

/** Mirrors public.room_is_joinable. */
export function roomJoinability(room: RoomLifecycleState, now: Date = new Date()): RoomJoinability {
  if (room.status === "ended" || room.status === "archived") return "room_ended";
  if (room.status === "draft") return "room_not_open";
  if (room.expires_at && new Date(room.expires_at).getTime() <= now.getTime()) return "room_expired";
  return "ok";
}

/** Mirrors the capacity check in public.admit_member. */
export function hasCapacity(joinedCount: number, maxMembers: number): boolean {
  return joinedCount < maxMembers;
}

export interface InviteState {
  revoked_at: string | null;
  expires_at: string;
  use_count: number;
  max_uses: number;
}

/** Mirrors the invite validity checks in public.redeem_room_invite. */
export function isInviteUsable(invite: InviteState, now: Date = new Date()): boolean {
  if (invite.revoked_at) return false;
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return false;
  return invite.use_count < invite.max_uses;
}

const ROLE_PRIORITY: Record<string, number> = {
  co_host: 0,
  moderator: 1,
  member: 2,
  guest: 3,
  host: 3,
};

export interface SuccessorCandidate {
  user_id: string;
  role: string;
  status: string;
  joined_at: string;
}

/**
 * Mirrors public.pick_room_successor: joined members other than the leaver,
 * ordered by role priority (co_host > moderator > member > guest), then by
 * earliest joined_at, then user_id as the final tie-break.
 */
export function pickSuccessor(
  members: SuccessorCandidate[],
  leavingUserId: string,
): string | null {
  const eligible = members
    .filter((m) => m.status === "joined" && m.user_id !== leavingUserId)
    .sort((a, b) => {
      const priority = (ROLE_PRIORITY[a.role] ?? 3) - (ROLE_PRIORITY[b.role] ?? 3);
      if (priority !== 0) return priority;
      const joined = new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
      if (joined !== 0) return joined;
      return a.user_id.localeCompare(b.user_id);
    });
  return eligible[0]?.user_id ?? null;
}

/** Deterministic outcome of a host leaving a room. */
export function hostLeaveOutcome(
  members: SuccessorCandidate[],
  leavingUserId: string,
): { outcome: "host_transferred"; successor: string } | { outcome: "room_ended" } {
  const successor = pickSuccessor(members, leavingUserId);
  return successor ? { outcome: "host_transferred", successor } : { outcome: "room_ended" };
}