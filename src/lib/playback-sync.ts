/**
 * Phase 4 — client-side playback synchronization maths.
 *
 * Everything in this module is pure. The database is authoritative: it owns
 * `position_seconds`, `playback_started_at` and `version`. Clients only
 * *derive* an expected position from that state, and never write a position
 * back for drift.
 */

export type PlaybackStatus = "idle" | "ready" | "playing" | "paused" | "ended";

export interface PlaybackState {
  room_id: string;
  provider: "youtube" | null;
  provider_media_id: string | null;
  title: string | null;
  thumbnail_url: string | null;
  playback_status: PlaybackStatus;
  position_seconds: number;
  playback_started_at: string | null;
  version: number;
  controlled_by: string | null;
  updated_at: string;
}

/** Drift bands, in seconds. Deliberately generous: we never claim frame accuracy. */
export const DRIFT_IGNORE_SECONDS = 1;
export const DRIFT_CORRECT_SECONDS = 3;

/** Minimum gap between local corrective seeks, to avoid seek loops. */
export const DRIFT_CORRECTION_COOLDOWN_MS = 4000;

/** How often the client re-checks drift. No database traffic is involved. */
export const DRIFT_CHECK_INTERVAL_MS = 2000;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts a YouTube video id from the common public URL shapes, or from a
 * bare id. Returns null for anything else — no network call, no guessing.
 * Only the 11-character id is ever persisted; the pasted URL is discarded.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (YOUTUBE_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const allowed = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const id = segments[0];
    return id && YOUTUBE_ID.test(id) ? id : null;
  }
  if (!allowed.includes(host)) return null;

  const v = url.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;

  const [first, second] = segments;
  if (first && ["embed", "v", "shorts", "live"].includes(first) && second) {
    return YOUTUBE_ID.test(second) ? second : null;
  }
  return null;
}

export function isValidYouTubeVideoId(id: string): boolean {
  return YOUTUBE_ID.test(id);
}

/**
 * Authoritative expected position.
 *
 * Paused / ready / ended → the stored position.
 * Playing → stored position + elapsed wall time since `playback_started_at`,
 * measured against the *server-corrected* clock (`nowMs` already includes the
 * measured client↔server offset). Client clocks are never trusted directly for
 * writes; this is a read-side approximation only.
 */
export function expectedPosition(state: PlaybackState, nowMs: number): number {
  if (state.playback_status !== "playing" || !state.playback_started_at) {
    return Math.max(0, state.position_seconds);
  }
  const startedMs = Date.parse(state.playback_started_at);
  if (Number.isNaN(startedMs)) return Math.max(0, state.position_seconds);
  return Math.max(0, state.position_seconds + (nowMs - startedMs) / 1000);
}

export type DriftAction = "none" | "seek";

/** Bounded drift policy. Under ~1s do nothing; beyond that, seek locally. */
export function driftAction(driftSeconds: number): DriftAction {
  return Math.abs(driftSeconds) < DRIFT_IGNORE_SECONDS ? "none" : "seek";
}

/** True when an incoming realtime row is newer than what we already hold. */
export function isNewerState(current: PlaybackState | null, incoming: PlaybackState): boolean {
  if (!current) return true;
  if (incoming.room_id !== current.room_id) return false;
  return incoming.version > current.version;
}

/** Human sync labels. Never claims perfect synchronization. */
export function syncLabel(input: {
  authorized: boolean;
  connected: boolean;
  syncing: boolean;
}): "Synced" | "Syncing…" | "Reconnecting…" | "Live updates unavailable" {
  if (!input.authorized) return "Live updates unavailable";
  if (!input.connected) return "Reconnecting…";
  return input.syncing ? "Syncing…" : "Synced";
}
