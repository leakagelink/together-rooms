import { describe, expect, it } from "vitest";

import {
  formatDuration,
  hasElapsed,
  remainingSeconds,
  type FocusTimerState,
} from "@/lib/study-timer";

const base: FocusTimerState = {
  phase: "focus",
  status: "idle",
  duration_seconds: 1500,
  remaining_seconds: null,
  started_at: null,
  ends_at: null,
  sessions_completed: 0,
  version: 3,
};

describe("focus timer derivation", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");

  it("derives a running countdown from ends_at only", () => {
    const state: FocusTimerState = {
      ...base,
      status: "running",
      started_at: "2026-01-01T11:55:00.000Z",
      ends_at: "2026-01-01T12:10:00.000Z",
    };
    expect(remainingSeconds(state, now)).toBe(600);
  });

  it("never returns a negative countdown", () => {
    const state: FocusTimerState = {
      ...base,
      status: "running",
      ends_at: "2026-01-01T11:00:00.000Z",
    };
    expect(remainingSeconds(state, now)).toBe(0);
    expect(hasElapsed(state, now)).toBe(true);
  });

  it("holds the stored remainder while paused", () => {
    const state: FocusTimerState = { ...base, status: "paused", remaining_seconds: 421 };
    expect(remainingSeconds(state, now)).toBe(421);
    expect(hasElapsed(state, now)).toBe(false);
  });

  it("falls back to the full duration when idle", () => {
    expect(remainingSeconds(base, now)).toBe(1500);
  });

  it("formats mm:ss", () => {
    expect(formatDuration(1500)).toBe("25:00");
    expect(formatDuration(65)).toBe("01:05");
    expect(formatDuration(-5)).toBe("00:00");
  });
});
