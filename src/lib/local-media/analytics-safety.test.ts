import { describe, expect, it } from "vitest";

import { durationBucket, sanitizeLocalMediaProperties } from "./analytics-safety";

describe("local media analytics safety", () => {
  it("keeps only operational properties", () => {
    expect(
      sanitizeLocalMediaProperties({
        media_kind: "video",
        transport_state: "direct",
        item_count: 3,
      }),
    ).toEqual({ media_kind: "video", transport_state: "direct", item_count: 3 });
  });

  it("drops filenames, paths, URLs and device metadata", () => {
    const cleaned = sanitizeLocalMediaProperties({
      media_kind: "image",
      file_name: "IMG_0421.HEIC",
      filePath: "/storage/emulated/0/DCIM/IMG_0421.HEIC",
      url: "blob:https://app/abc",
      exif_make: "Apple",
      gps_latitude: 51.5,
      location: "London",
    });
    expect(cleaned).toEqual({ media_kind: "image" });
  });

  it("drops transport credentials and signaling payloads", () => {
    const cleaned = sanitizeLocalMediaProperties({
      role: "owner",
      token: "secret-token",
      sdp: "v=0",
      ice_candidate: "candidate:1",
      ip_address: "203.0.113.1",
    });
    expect(cleaned).toEqual({ role: "owner" });
  });

  it("refuses long strings even on allowed keys", () => {
    expect(sanitizeLocalMediaProperties({ reason: "x".repeat(200) })).toEqual({});
  });

  it("reports durations as coarse buckets only", () => {
    expect(durationBucket(null)).toBe("unknown");
    expect(durationBucket(30)).toBe("lt_1m");
    expect(durationBucket(300)).toBe("lt_10m");
    expect(durationBucket(1800)).toBe("lt_1h");
    expect(durationBucket(7200)).toBe("gte_1h");
  });
});
