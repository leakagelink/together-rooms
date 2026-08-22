import { describe, expect, it } from "vitest";

import {
  driftAction,
  expectedPosition,
  isNewerState,
  isValidYouTubeVideoId,
  parseYouTubeVideoId,
  syncLabel,
  type PlaybackState,
} from "./playback-sync";

const base: PlaybackState = {
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
  updated_at: "2026-01-01T10:00:00.000Z",
};

describe("YouTube video id extraction", () => {
  it("accepts the common public URL shapes", () => {
    const cases = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      "dQw4w9WgXcQ",
    ];
    for (const value of cases) expect(parseYouTubeVideoId(value)).toBe("dQw4w9WgXcQ");
  });

  it("rejects malformed, foreign and short ids", () => {
    const cases = [
      "",
      "   ",
      "not a url",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch",
      "javascript:alert(1)",
      "https://vimeo.com/12345678901",
    ];
    for (const value of cases) expect(parseYouTubeVideoId(value)).toBeNull();
    expect(isValidYouTubeVideoId("bad")).toBe(false);
  });
});

describe("SYNC — expected position", () => {
  const at = (iso: string) => Date.parse(iso);

  it("SYNC-T1: joining a paused video starts at the stored position", () => {
    expect(expectedPosition(base, at("2026-01-01T10:05:00Z"))).toBe(120);
  });

  it("SYNC-T2/T3/T4: joining a playing video adds elapsed server time", () => {
    const playing: PlaybackState = {
      ...base,
      playback_status: "playing",
      playback_started_at: "2026-01-01T10:00:00.000Z",
    };
    expect(expectedPosition(playing, at("2026-01-01T10:00:00Z"))).toBe(120);
    expect(expectedPosition(playing, at("2026-01-01T10:00:30Z"))).toBe(150);
    expect(expectedPosition(playing, at("2026-01-01T10:02:00Z"))).toBe(240);
  });

  it("never returns a negative position", () => {
    const playing: PlaybackState = {
      ...base,
      position_seconds: 0,
      playback_status: "playing",
      playback_started_at: "2026-01-01T10:00:00.000Z",
    };
    expect(expectedPosition(playing, at("2026-01-01T09:00:00Z"))).toBe(0);
  });

  it("falls back to the stored position when the timestamp is unusable", () => {
    expect(
      expectedPosition({ ...base, playback_status: "playing", playback_started_at: "nope" }, 0),
    ).toBe(120);
  });
});

describe("SYNC — version ordering", () => {
  it("SYNC-T9: a duplicate realtime row is not applied twice", () => {
    expect(isNewerState(base, { ...base })).toBe(false);
  });

  it("SYNC-T10: an out-of-order (older) version is ignored", () => {
    expect(isNewerState(base, { ...base, version: 3 })).toBe(false);
    expect(isNewerState(base, { ...base, version: 5 })).toBe(true);
  });

  it("accepts the first row and ignores rows for another room", () => {
    expect(isNewerState(null, base)).toBe(true);
    expect(isNewerState(base, { ...base, room_id: "22222222-2222-2222-2222-222222222222" })).toBe(
      false,
    );
  });
});

describe("SYNC — drift policy", () => {
  it("SYNC-T12: small drift does nothing (and never writes)", () => {
    expect(driftAction(0.2)).toBe("none");
    expect(driftAction(-0.9)).toBe("none");
  });

  it("medium and large drift seek locally", () => {
    expect(driftAction(1.5)).toBe("seek");
    expect(driftAction(-8)).toBe("seek");
  });
});

describe("sync labels", () => {
  it("uses accurate, non-absolute wording", () => {
    expect(syncLabel({ authorized: true, connected: true, syncing: false })).toBe("Synced");
    expect(syncLabel({ authorized: true, connected: true, syncing: true })).toBe("Syncing…");
    expect(syncLabel({ authorized: true, connected: false, syncing: false })).toBe(
      "Reconnecting…",
    );
    expect(syncLabel({ authorized: false, connected: false, syncing: false })).toBe(
      "Live updates unavailable",
    );
  });
});
