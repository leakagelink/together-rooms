import { describe, expect, it } from "vitest";

import {
  CALL_ALLOWED_KEYS,
  callDurationBucket,
  participantBucket,
  sanitizeCallProperties,
} from "./analytics-safety";

describe("call analytics safety", () => {
  it("CALL-A1 keeps only allow-listed operational fields", () => {
    const out = sanitizeCallProperties({
      call_mode: "video",
      role: "host",
      participant_bucket: "pair",
      connection_state: "connected",
    });
    expect(Object.keys(out).sort()).toEqual(
      ["call_mode", "connection_state", "participant_bucket", "role"].sort(),
    );
  });

  it("CALL-A2 drops media, transcript, device and credential fields", () => {
    const out = sanitizeCallProperties({
      audio_blob: "....",
      video_track: "track-1",
      transcript: "hello there",
      token: "secret-token",
      device_label: "Jane's AirPods",
      ip_address: "203.0.113.4",
      sdp: "v=0",
      candidate: "candidate:1",
      recording_url: "https://example.com/x.webm",
    });
    expect(out).toEqual({});
  });

  it("CALL-A3 rejects oversized values instead of truncating them", () => {
    const out = sanitizeCallProperties({ reason_code: "x".repeat(200) });
    expect(out["reason_code"]).toBeUndefined();
  });

  it("CALL-A4 never exposes an exact participant count", () => {
    expect(participantBucket(1)).toBe("solo");
    expect(participantBucket(2)).toBe("pair");
    expect(participantBucket(4)).toBe("small");
    expect(participantBucket(7)).toBe("group");
    expect(CALL_ALLOWED_KEYS).not.toContain("participant_count");
  });

  it("CALL-A5 buckets duration rather than reporting it precisely", () => {
    expect(callDurationBucket(10)).toBe("under_1m");
    expect(callDurationBucket(120)).toBe("under_5m");
    expect(callDurationBucket(1000)).toBe("under_30m");
    expect(callDurationBucket(5000)).toBe("over_30m");
    expect(callDurationBucket(null)).toBe("unknown");
  });
});
