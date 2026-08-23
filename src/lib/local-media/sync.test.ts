import { describe, expect, it } from "vitest";

import { clampIndex, isNewerSession, localExpectedPosition, shouldCorrectDrift } from "./sync";

describe("local media synchronization maths", () => {
  const started = "2026-01-01T00:00:00.000Z";
  const startedMs = Date.parse(started);

  it("returns the stored position when not playing", () => {
    expect(
      localExpectedPosition(
        { playback_status: "paused", position_seconds: 12, playback_started_at: null },
        startedMs + 60_000,
      ),
    ).toBe(12);
  });

  it("advances by elapsed wall time while playing", () => {
    expect(
      localExpectedPosition(
        { playback_status: "playing", position_seconds: 10, playback_started_at: started },
        startedMs + 5000,
      ),
    ).toBeCloseTo(15, 3);
  });

  it("degrades safely on an unparseable timestamp", () => {
    expect(
      localExpectedPosition(
        { playback_status: "playing", position_seconds: 7, playback_started_at: "nonsense" },
        startedMs,
      ),
    ).toBe(7);
  });

  it("only corrects drift beyond the ignore band", () => {
    expect(shouldCorrectDrift(10, 10.5)).toBe(false);
    expect(shouldCorrectDrift(10, 14)).toBe(true);
  });

  it("clamps photo indexes to the shared item count", () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(1, 0)).toBe(0);
  });

  it("ignores stale or replayed session rows", () => {
    expect(isNewerSession(null, { id: "a", version: 1 })).toBe(true);
    expect(isNewerSession({ id: "a", version: 5 }, { id: "a", version: 4 })).toBe(false);
    expect(isNewerSession({ id: "a", version: 5 }, { id: "a", version: 6 })).toBe(true);
    // A brand new session always wins over a previous one.
    expect(isNewerSession({ id: "a", version: 9 }, { id: "b", version: 1 })).toBe(true);
  });
});
