/**
 * Phase 7 — pure synchronization maths for local media sessions.
 *
 * Same model as Phase 4 YouTube playback: the database owns
 * `position_seconds` + `playback_started_at` + `version`, and clients only
 * derive an expected position from it. Nothing here writes anything.
 */
export interface LocalMediaTiming {
  playback_status: "idle" | "ready" | "playing" | "paused" | "ended";
  position_seconds: number;
  playback_started_at: string | null;
}

/** Drift bands, in seconds. Local media is streamed, so we stay forgiving. */
export const LOCAL_DRIFT_IGNORE_SECONDS = 1.5;
export const LOCAL_DRIFT_CORRECT_SECONDS = 3;

export function localExpectedPosition(state: LocalMediaTiming, nowMs: number): number {
  if (state.playback_status !== "playing" || !state.playback_started_at) {
    return Math.max(0, state.position_seconds);
  }
  const startedMs = Date.parse(state.playback_started_at);
  if (Number.isNaN(startedMs)) return Math.max(0, state.position_seconds);
  return Math.max(0, state.position_seconds + (nowMs - startedMs) / 1000);
}

export function shouldCorrectDrift(actualSeconds: number, expectedSeconds: number): boolean {
  return Math.abs(actualSeconds - expectedSeconds) > LOCAL_DRIFT_IGNORE_SECONDS;
}

/** Photo navigation is index-based; the server clamps, we mirror the clamp. */
export function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), itemCount - 1);
}

/** Newer-wins guard so a delayed realtime event cannot resurrect old state. */
export function isNewerSession(
  prev: { id: string; version: number } | null,
  next: { id: string; version: number },
): boolean {
  if (!prev) return true;
  if (prev.id !== next.id) return true;
  return next.version > prev.version;
}
