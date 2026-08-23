/**
 * PHASE 9 — full-screen ad frequency caps.
 *
 * Pure, deterministic and time-injected so it is fully testable. Only the
 * minimum state needed for pacing is kept (timestamps and counters); nothing
 * here records what the user was doing, so no behavioural profile is built.
 */
import type { AdFrequencyConfig } from "./config";

export interface FrequencyState {
  /** Epoch ms when this app session began. */
  sessionStartedAt: number;
  /** Epoch ms of the last full-screen ad shown, or null. */
  lastFullscreenAt: number | null;
  /** Epoch ms of the last app-open ad shown, or null. */
  lastAppOpenAt: number | null;
  /** Full-screen ads shown in this session. */
  fullscreenCount: number;
}

export function newFrequencyState(now: number = Date.now()): FrequencyState {
  return {
    sessionStartedAt: now,
    lastFullscreenAt: null,
    lastAppOpenAt: null,
    fullscreenCount: 0,
  };
}

export type FrequencyVerdict = { allowed: true } | { allowed: false; reason: string };

/** Full-screen formats only; banners are not frequency-capped. */
export function checkFrequency(
  format: "interstitial" | "app_open",
  state: FrequencyState,
  config: AdFrequencyConfig,
  now: number = Date.now(),
): FrequencyVerdict {
  const sessionSeconds = (now - state.sessionStartedAt) / 1000;
  if (sessionSeconds < config.min_session_seconds_before_first_fullscreen) {
    return { allowed: false, reason: "session_warmup" };
  }
  if (state.fullscreenCount >= config.max_fullscreen_per_session) {
    return { allowed: false, reason: "session_cap" };
  }
  if (
    state.lastFullscreenAt !== null &&
    (now - state.lastFullscreenAt) / 1000 < config.min_seconds_between_fullscreen
  ) {
    return { allowed: false, reason: "interval" };
  }
  // An app-open ad must never be stacked with another full-screen ad.
  if (
    state.lastAppOpenAt !== null &&
    (now - state.lastAppOpenAt) / 1000 < config.min_seconds_after_app_open_ad
  ) {
    return { allowed: false, reason: "app_open_stacking" };
  }
  if (format === "app_open" && state.lastFullscreenAt !== null) {
    const since = (now - state.lastFullscreenAt) / 1000;
    if (since < config.min_seconds_after_app_open_ad) {
      return { allowed: false, reason: "app_open_stacking" };
    }
  }
  return { allowed: true };
}

/** Records a shown full-screen ad. Returns a new state (never mutates). */
export function recordFullscreenShown(
  format: "interstitial" | "app_open",
  state: FrequencyState,
  now: number = Date.now(),
): FrequencyState {
  return {
    ...state,
    lastFullscreenAt: now,
    lastAppOpenAt: format === "app_open" ? now : state.lastAppOpenAt,
    fullscreenCount: state.fullscreenCount + 1,
  };
}
