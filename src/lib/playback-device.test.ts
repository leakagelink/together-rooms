import { describe, expect, it } from "vitest";

import {
  AUTOPLAY_GRACE_MS,
  CLOCK_MAX_AGE_MS,
  isAutoplayBlocked,
  planReconciliation,
  playerEventMayMutate,
  shouldRefreshClock,
  type LocalPlayerSnapshot,
} from "./playback-device";
import type { PlaybackState } from "./playback-sync";

const START = "2026-01-01T10:00:00.000Z";
const at = (iso: string) => Date.parse(iso);

const paused: PlaybackState = {
  room_id: "11111111-1111-1111-1111-111111111111",
  provider: "youtube",
  provider_media_id: "dQw4w9WgXcQ",
  title: null,
  thumbnail_url: null,
  playback_status: "paused",
  position_seconds: 120,
  playback_started_at: null,
  version: 4,
  controlled_by: null,
  updated_at: START,
};

const playing: PlaybackState = {
  ...paused,
  playback_status: "playing",
  playback_started_at: START,
  version: 5,
};

const empty: LocalPlayerSnapshot = { loadedMediaId: null, currentTime: 0, playing: false };

describe("DEVICE-T1/T2/T3: joining a room", () => {
  it("DEVICE-T1: joining a paused video cues it at the stored position", () => {
    const plan = planReconciliation(paused, empty, at("2026-01-01T10:05:00Z"));
    expect(plan.steps).toEqual([
      { kind: "load", mediaId: "dQw4w9WgXcQ", position: 120, autoplay: false },
    ]);
    expect(plan.requiresPlayback).toBe(false);
  });

  it("DEVICE-T2/T3: joining a playing video loads it with autoplay at the live position", () => {
    const plan = planReconciliation(playing, empty, at("2026-01-01T10:00:30Z"));
    expect(plan.steps).toEqual([
      { kind: "load", mediaId: "dQw4w9WgXcQ", position: 150, autoplay: true },
    ]);
    expect(plan.requiresPlayback).toBe(true);
  });

  it("clears the player when the room has no media", () => {
    expect(planReconciliation(null, { ...empty, loadedMediaId: "dQw4w9WgXcQ" }, 0).steps).toEqual([
      { kind: "clear" },
    ]);
    expect(planReconciliation(null, empty, 0).steps).toEqual([]);
  });

  it("does nothing when the player is already in the right place", () => {
    const local: LocalPlayerSnapshot = {
      loadedMediaId: "dQw4w9WgXcQ",
      currentTime: 150.2,
      playing: true,
    };
    expect(planReconciliation(playing, local, at("2026-01-01T10:00:30Z")).steps).toEqual([]);
  });

  it("seeks and applies play/pause when the player has drifted", () => {
    const behind: LocalPlayerSnapshot = {
      loadedMediaId: "dQw4w9WgXcQ",
      currentTime: 10,
      playing: false,
    };
    expect(planReconciliation(playing, behind, at("2026-01-01T10:00:30Z")).steps).toEqual([
      { kind: "seek", position: 150 },
      { kind: "play" },
    ]);
    const ahead: LocalPlayerSnapshot = {
      loadedMediaId: "dQw4w9WgXcQ",
      currentTime: 300,
      playing: true,
    };
    expect(planReconciliation(paused, ahead, at("2026-01-01T10:00:30Z")).steps).toEqual([
      { kind: "seek", position: 120 },
      { kind: "pause" },
    ]);
  });
});

describe("DEVICE-T4/T5/T6: autoplay fallback", () => {
  it("DEVICE-T4: a refused play is detected only after the grace period", () => {
    const base = { authoritativePlaying: true, attemptedPlay: true, playerPlaying: false };
    expect(isAutoplayBlocked({ ...base, msSinceAttempt: 200 })).toBe(false);
    expect(isAutoplayBlocked({ ...base, msSinceAttempt: AUTOPLAY_GRACE_MS })).toBe(true);
  });

  it("DEVICE-T3: allowed autoplay is never treated as blocked", () => {
    expect(
      isAutoplayBlocked({
        authoritativePlaying: true,
        attemptedPlay: true,
        playerPlaying: true,
        msSinceAttempt: 5000,
      }),
    ).toBe(false);
  });

  it("a paused room never asks for a gesture", () => {
    expect(
      isAutoplayBlocked({
        authoritativePlaying: false,
        attemptedPlay: false,
        playerPlaying: false,
        msSinceAttempt: 60000,
      }),
    ).toBe(false);
  });

  it("DEVICE-T5: the gesture path recalculates position from live state", () => {
    // Simulates: play refused at 10:00:30, user taps at 10:02:00.
    const plan = planReconciliation(
      playing,
      { loadedMediaId: "dQw4w9WgXcQ", currentTime: 150, playing: false },
      at("2026-01-01T10:02:00Z"),
    );
    expect(plan.steps).toEqual([{ kind: "seek", position: 240 }, { kind: "play" }]);
  });

  it("DEVICE-T6/T9/T12: no local path can produce an authoritative mutation", () => {
    // Every reconciliation step is a local player command; there is no mutation
    // variant in the plan type, so resync, autoplay fallback and provider
    // failures cannot write to the database.
    const plans = [
      planReconciliation(playing, empty, at("2026-01-01T10:00:30Z")),
      planReconciliation(paused, empty, at("2026-01-01T10:00:30Z")),
      planReconciliation(null, { ...empty, loadedMediaId: "dQw4w9WgXcQ" }, 0),
    ];
    const localKinds = ["clear", "load", "seek", "play", "pause"];
    for (const plan of plans) {
      for (const step of plan.steps) expect(localKinds).toContain(step.kind);
    }
  });
});

describe("DEVICE-T11/T12: player events cannot corrupt room state", () => {
  const allowed = {
    canControl: true,
    roomActive: true,
    applyingRemote: false,
    awaitingGesture: false,
    eventMediaId: "dQw4w9WgXcQ",
    authoritativeMediaId: "dQw4w9WgXcQ",
  };

  it("permits only a controller's own deliberate event on the current video", () => {
    expect(playerEventMayMutate(allowed)).toBe(true);
  });

  it("DEVICE-T11: an event from a replaced video is discarded", () => {
    expect(playerEventMayMutate({ ...allowed, eventMediaId: "oldVideoIdX" })).toBe(false);
  });

  it("blocks events while remote state is being applied", () => {
    expect(playerEventMayMutate({ ...allowed, applyingRemote: true })).toBe(false);
  });

  it("DEVICE-T6: an autoplay-blocked participant never mutates the room", () => {
    expect(playerEventMayMutate({ ...allowed, awaitingGesture: true })).toBe(false);
  });

  it("blocks viewers, closed rooms and empty rooms", () => {
    expect(playerEventMayMutate({ ...allowed, canControl: false })).toBe(false);
    expect(playerEventMayMutate({ ...allowed, roomActive: false })).toBe(false);
    expect(playerEventMayMutate({ ...allowed, authoritativeMediaId: null })).toBe(false);
  });
});

describe("DEVICE-T7/T8/T10: clock offset refresh policy", () => {
  it("always measures on first load", () => {
    expect(shouldRefreshClock({ reason: "initial", msSinceLastMeasurement: 0 })).toBe(true);
  });

  it("DEVICE-T7/T8: foreground and reconnect refresh, but are throttled", () => {
    expect(shouldRefreshClock({ reason: "foreground", msSinceLastMeasurement: 1000 })).toBe(false);
    expect(shouldRefreshClock({ reason: "foreground", msSinceLastMeasurement: 60_000 })).toBe(true);
    expect(shouldRefreshClock({ reason: "reconnect", msSinceLastMeasurement: 60_000 })).toBe(true);
    expect(shouldRefreshClock({ reason: "manual_resync", msSinceLastMeasurement: 60_000 })).toBe(
      true,
    );
  });

  it("DEVICE-T10: long sessions refresh only once the offset is stale", () => {
    expect(shouldRefreshClock({ reason: "interval", msSinceLastMeasurement: 60_000 })).toBe(false);
    expect(
      shouldRefreshClock({ reason: "interval", msSinceLastMeasurement: CLOCK_MAX_AGE_MS }),
    ).toBe(true);
  });

  it("never refreshes on a per-tick cadence", () => {
    for (const reason of ["foreground", "reconnect", "manual_resync", "interval"] as const) {
      expect(shouldRefreshClock({ reason, msSinceLastMeasurement: 1000 })).toBe(false);
    }
  });
});
