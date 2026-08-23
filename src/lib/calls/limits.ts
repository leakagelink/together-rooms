/**
 * PHASE 8 — real-time voice & video: conservative, documented limits.
 *
 * None of these constants is a security control. Every one has a
 * server-side counterpart (rate limits, session expiry, per-session
 * participant caps, credential TTL); they exist so the UI fails early and so
 * the mesh never tries to do something the architecture cannot sustain.
 *
 * ARCHITECTURAL ASSUMPTION: this is a full-mesh WebRTC topology — every
 * participant sends their stream to every other participant. Upstream cost
 * grows as (N-1) per participant, so the caps below are deliberately small.
 * A selective forwarding unit (SFU) would be required to go beyond them.
 */

/** Default participant caps (also the server-side maximum). */
export const MAX_VOICE_PARTICIPANTS = 8;
export const MAX_VIDEO_PARTICIPANTS = 4;
export const MIN_PARTICIPANTS = 2;

/** Authoritative session lifetime, mirrored from the database default. */
export const CALL_SESSION_MAX_MINUTES = 240;

/** Transport credential lifetime (mirrors the SQL grant TTL). */
export const CALL_GRANT_TTL_SECONDS = 120;

/** Re-issue a credential this long before it expires. */
export const CALL_GRANT_REFRESH_MARGIN_SECONDS = 45;

/** Participant heartbeat cadence and the server-enforced reconnect grace. */
export const CALL_HEARTBEAT_MS = 20_000;
export const CALL_RECONNECT_GRACE_SECONDS = 90;

/** Signaling poll cadence while peers are negotiating. */
export const CALL_SIGNAL_POLL_MS = 1200;

/** How long one peer connection attempt may stall before it is retried. */
export const CALL_CONNECT_TIMEOUT_MS = 25_000;

/** Cap on the mesh we will even attempt to build on one device. */
export function participantCap(mode: "voice" | "video"): number {
  return mode === "video" ? MAX_VIDEO_PARTICIPANTS : MAX_VOICE_PARTICIPANTS;
}
