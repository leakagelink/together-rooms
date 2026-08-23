/**
 * Phase 6 — pure client-side derivation of the shared focus timer.
 *
 * The database stores only transitions (started_at / ends_at / remaining /
 * version). Nothing is written per second; every client derives the countdown
 * locally from the authoritative timestamps, so all clocks agree without any
 * per-tick traffic.
 */

export type FocusPhase = "focus" | "short_break" | "long_break" | "custom";
export type FocusStatus = "idle" | "running" | "paused" | "completed";

export interface FocusTimerState {
  phase: FocusPhase;
  status: FocusStatus;
  duration_seconds: number;
  remaining_seconds: number | null;
  started_at: string | null;
  ends_at: string | null;
  sessions_completed: number;
  version: number;
}

export const FOCUS_PRESETS: { phase: FocusPhase; label: string; seconds: number }[] = [
  { phase: "focus", label: "Focus 25m", seconds: 25 * 60 },
  { phase: "short_break", label: "Short break 5m", seconds: 5 * 60 },
  { phase: "long_break", label: "Long break 15m", seconds: 15 * 60 },
];

/** Seconds left, derived from authoritative timestamps. Never negative. */
export function remainingSeconds(state: FocusTimerState, now: Date = new Date()): number {
  if (state.status === "running" && state.ends_at) {
    return Math.max(0, Math.ceil((new Date(state.ends_at).getTime() - now.getTime()) / 1000));
  }
  if (state.status === "paused") {
    return Math.max(0, state.remaining_seconds ?? state.duration_seconds);
  }
  if (state.status === "completed") return 0;
  return state.duration_seconds;
}

/** True once a running timer has passed its authoritative end instant. */
export function hasElapsed(state: FocusTimerState, now: Date = new Date()): boolean {
  return state.status === "running" && !!state.ends_at && new Date(state.ends_at) <= now;
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function phaseLabel(phase: FocusPhase): string {
  switch (phase) {
    case "focus":
      return "Focus";
    case "short_break":
      return "Short break";
    case "long_break":
      return "Long break";
    default:
      return "Custom";
  }
}
