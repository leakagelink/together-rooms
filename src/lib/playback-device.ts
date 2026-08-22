/**
 * Phase 4.1 — pure device/player reconciliation logic.
 *
 * Everything here is a pure function so real device behaviour (join, resume,
 * autoplay refusal, resync, stale player events) can be tested deterministically
 * without a browser. None of it writes to the database: reconciliation is a
 * purely local operation.
 */
import { expectedPosition, type PlaybackState } from "./playback-sync";

/** Local player state as observed from the IFrame API. */
export interface LocalPlayerSnapshot {
  /** Media id currently loaded in the player, if any. */
  loadedMediaId: string | null;
  /** Player's current time, in seconds. */
  currentTime: number;
  /** Whether the player reports it is playing right now. */
  playing: boolean;
}

export type ReconcileStep =
  | { kind: "clear" }
  | { kind: "load"; mediaId: string; position: number; autoplay: boolean }
  | { kind: "seek"; position: number }
  | { kind: "play" }
  | { kind: "pause" };

export interface ReconcilePlan {
  steps: ReconcileStep[];
  /** Position the player should be at once the plan is applied. */
  targetPosition: number;
  /** True when applying the plan may hit an autoplay restriction. */
  requiresPlayback: boolean;
}

/** Seconds of difference tolerated before a corrective local seek. */
export const RECONCILE_SEEK_THRESHOLD_SECONDS = 1;

/**
 * Produces the local steps that bring a player in line with authoritative
 * state. Never returns a database mutation — by construction, reconciliation
 * cannot change what anyone else sees.
 */
export function planReconciliation(
  state: PlaybackState | null,
  player: LocalPlayerSnapshot,
  nowMs: number,
): ReconcilePlan {
  if (!state || !state.provider_media_id) {
    return {
      steps: player.loadedMediaId ? [{ kind: "clear" }] : [],
      targetPosition: 0,
      requiresPlayback: false,
    };
  }

  const target = expectedPosition(state, nowMs);
  const shouldPlay = state.playback_status === "playing";

  if (player.loadedMediaId !== state.provider_media_id) {
    return {
      steps: [
        { kind: "load", mediaId: state.provider_media_id, position: target, autoplay: shouldPlay },
      ],
      targetPosition: target,
      requiresPlayback: shouldPlay,
    };
  }

  const steps: ReconcileStep[] = [];
  if (Math.abs(target - player.currentTime) >= RECONCILE_SEEK_THRESHOLD_SECONDS) {
    steps.push({ kind: "seek", position: target });
  }
  if (shouldPlay && !player.playing) steps.push({ kind: "play" });
  if (!shouldPlay && player.playing) steps.push({ kind: "pause" });

  return { steps, targetPosition: target, requiresPlayback: shouldPlay };
}

/**
 * Autoplay detection.
 *
 * After we ask the player to play in order to match authoritative state, the
 * browser or WebView may refuse without throwing. We check once, after a grace
 * period: if the room says "playing" and the local player still is not, we
 * treat it as a gesture requirement. We never retry play() in a loop and never
 * write to the database — the room stays playing for everyone else.
 */
export const AUTOPLAY_GRACE_MS = 1500;

export function isAutoplayBlocked(input: {
  authoritativePlaying: boolean;
  attemptedPlay: boolean;
  playerPlaying: boolean;
  msSinceAttempt: number;
}): boolean {
  return (
    input.authoritativePlaying &&
    input.attemptedPlay &&
    !input.playerPlaying &&
    input.msSinceAttempt >= AUTOPLAY_GRACE_MS
  );
}

/**
 * A player event may only produce an authoritative mutation when all of these
 * hold. This is the single gate protecting the room from local player quirks,
 * autoplay refusals, and events left over from a previous video.
 */
export function playerEventMayMutate(input: {
  canControl: boolean;
  roomActive: boolean;
  applyingRemote: boolean;
  awaitingGesture: boolean;
  eventMediaId: string | null;
  authoritativeMediaId: string | null;
}): boolean {
  if (!input.canControl || !input.roomActive) return false;
  if (input.applyingRemote || input.awaitingGesture) return false;
  if (!input.authoritativeMediaId) return false;
  // A late event from a video that is no longer the room's video is discarded.
  return input.eventMediaId === input.authoritativeMediaId;
}

/** Reasons the server-time offset may be re-measured. */
export type ClockRefreshReason =
  "initial" | "reconnect" | "foreground" | "manual_resync" | "interval";

/** Longest we trust a measured offset before refreshing it in a long session. */
export const CLOCK_MAX_AGE_MS = 10 * 60 * 1000;
/** Floor between two measurements, so events cannot cause a request storm. */
export const CLOCK_MIN_INTERVAL_MS = 30 * 1000;

/**
 * Offset refresh policy: bounded, event-driven, never per tick. `initial`
 * always measures; every other reason is throttled, and `interval` only fires
 * once the offset is genuinely stale.
 */
export function shouldRefreshClock(input: {
  reason: ClockRefreshReason;
  msSinceLastMeasurement: number;
}): boolean {
  if (input.reason === "initial") return true;
  if (input.msSinceLastMeasurement < CLOCK_MIN_INTERVAL_MS) return false;
  if (input.reason === "interval") return input.msSinceLastMeasurement >= CLOCK_MAX_AGE_MS;
  return true;
}
