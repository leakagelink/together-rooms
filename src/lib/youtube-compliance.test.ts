import { describe, expect, it } from "vitest";

import {
  isCompliantPlayerVars,
  planBackgroundEnforcement,
  verifyPlayerVisibility,
  YOUTUBE_COMPLIANCE_LIMITS,
} from "./youtube-compliance";

describe("planBackgroundEnforcement", () => {
  it("pauses locally when hidden while playing", () => {
    const plan = planBackgroundEnforcement({
      visibility: "hidden",
      hasMedia: true,
      locallyPlaying: true,
    });
    expect(plan).toEqual({
      pauseLocally: true,
      notify: true,
      reason: "background_playback_not_allowed",
    });
  });

  it("does nothing when hidden but already paused", () => {
    expect(
      planBackgroundEnforcement({ visibility: "hidden", hasMedia: true, locallyPlaying: false })
        .pauseLocally,
    ).toBe(false);
  });

  it("does nothing when visible", () => {
    expect(
      planBackgroundEnforcement({ visibility: "visible", hasMedia: true, locallyPlaying: true })
        .pauseLocally,
    ).toBe(false);
  });

  it("does nothing without media", () => {
    expect(
      planBackgroundEnforcement({ visibility: "hidden", hasMedia: false, locallyPlaying: true })
        .pauseLocally,
    ).toBe(false);
  });
});

describe("verifyPlayerVisibility", () => {
  it("accepts a mini player", () => {
    expect(verifyPlayerVisibility({ width: 144, height: 81, mounted: true }).compliant).toBe(true);
  });

  it("rejects an unmounted player", () => {
    expect(verifyPlayerVisibility({ width: 300, height: 200, mounted: false }).reason).toBe(
      "player_hidden",
    );
  });

  it("rejects a zero-size player", () => {
    expect(verifyPlayerVisibility({ width: 0, height: 0, mounted: true }).reason).toBe(
      "player_hidden",
    );
  });

  it("rejects an audio-only sized player", () => {
    expect(verifyPlayerVisibility({ width: 8, height: 4, mounted: true }).reason).toBe(
      "player_too_small",
    );
  });
});

describe("isCompliantPlayerVars", () => {
  it("accepts the production configuration", () => {
    expect(
      isCompliantPlayerVars({ rel: 0, playsinline: 1, modestbranding: 1, controls: 1, fs: 1 }),
    ).toBe(true);
  });

  it("rejects extraction-style flags", () => {
    expect(isCompliantPlayerVars({ playsinline: 1, controls: 1, audio_only: 1 })).toBe(false);
  });

  it("rejects a player that escapes the frame on mobile", () => {
    expect(isCompliantPlayerVars({ controls: 1 })).toBe(false);
  });
});

describe("compliance copy", () => {
  it("states the user-facing limits", () => {
    expect(YOUTUBE_COMPLIANCE_LIMITS.length).toBeGreaterThanOrEqual(3);
    expect(YOUTUBE_COMPLIANCE_LIMITS.join(" ")).toMatch(/audio-only/i);
  });
});
