/**
 * PHASE 8 — pure call-state helpers.
 *
 * Nothing here touches the network, the DOM or getUserMedia; it exists so the
 * rules that decide what the UI shows are testable in isolation. The database
 * remains authoritative for every value these functions read.
 */
export type CallMode = "voice" | "video";
export type CallSessionStatus = "starting" | "active" | "ended" | "expired";
export type CallConnectionState = "connecting" | "connected" | "reconnecting" | "failed";

export interface CallParticipant {
  user_id: string;
  mic_enabled: boolean;
  camera_enabled: boolean;
  connection_state: CallConnectionState;
  joined_at: string;
}

export interface CallSession {
  id: string;
  room_id: string;
  started_by: string | null;
  call_mode: CallMode;
  session_status: CallSessionStatus;
  allow_relay: boolean;
  max_participants: number;
  version: number;
  expires_at: string;
  created_at: string;
}

/** A session only counts as live while the server says so and it has not expired. */
export function isLiveSession(session: CallSession | null, now: number = Date.now()): boolean {
  if (!session) return false;
  if (session.session_status !== "active" && session.session_status !== "starting") return false;
  return Date.parse(session.expires_at) > now;
}

/**
 * Who may end the call for everyone. Mirrors end_call_session() in SQL, which
 * is the actual enforcement point; this only decides whether to show the button.
 */
export function canEndCall(
  session: CallSession | null,
  userId: string | undefined,
  canModerate: boolean,
): boolean {
  if (!session || !userId) return false;
  return session.started_by === userId || canModerate;
}

/** Client-side mirror of the SQL control_mode check for starting a call. */
export function canStartCall(controlMode: string, canModerate: boolean): boolean {
  return controlMode === "collaborative" || canModerate;
}

/** Camera is only meaningful in a video call; voice calls never request it. */
export function cameraAllowed(mode: CallMode): boolean {
  return mode === "video";
}

/** Remaining seats, never negative. */
export function remainingSeats(session: CallSession | null, participants: number): number {
  if (!session) return 0;
  return Math.max(0, session.max_participants - participants);
}

/** Grid columns for a mobile-first participant tile layout. */
export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

/** Short human label for a peer's connection state. */
export function connectionLabel(state: CallConnectionState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "reconnecting":
      return "Reconnecting";
    case "failed":
      return "Disconnected";
    default:
      return "Connecting";
  }
}

/**
 * Peer ordering rule for the mesh: the lexicographically smaller user id makes
 * the offer. Deterministic on both sides, so two peers never glare-collide.
 */
export function shouldInitiateOffer(selfId: string, peerId: string): boolean {
  return selfId < peerId;
}

/**
 * Background/foreground policy. Returning to the foreground never mutates
 * anyone else's state — it only refreshes our own authorization.
 */
export function lifecycleAction(visibility: "visible" | "hidden"): "refresh" | "keep" {
  return visibility === "visible" ? "refresh" : "keep";
}
