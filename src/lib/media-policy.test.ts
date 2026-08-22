import { describe, expect, it } from "vitest";

import {
  canonicalYouTubeThumbnailUrl,
  evaluateYouTubePolicy,
  isPolicyFresh,
  isSafeThumbnailUrl,
  policyFromJsonb,
  policyToJsonb,
  type MediaPolicy,
} from "./media-policy";

const VIDEO_ID = "dQw4w9WgXcQ";

const baseItem = () => ({
  snippet: { title: "Rick Astley - Never Gonna Give You Up" },
  status: {
    madeForKids: false,
    embeddable: true,
    privacyStatus: "public",
  },
});

describe("YT-POLICY-T2: malformed or missing Data API responses are rejected", () => {
  it("returns unavailable for null item", () => {
    const result = evaluateYouTubePolicy(VIDEO_ID, null);
    expect(result.ok).toBe(false);
    expect(result.policy.status).toBe("unavailable");
  });

  it("returns unavailable for a completely missing item", () => {
    const result = evaluateYouTubePolicy(VIDEO_ID, undefined);
    expect(result.ok).toBe(false);
    expect(result.policy.status).toBe("unavailable");
  });
});

describe("YT-POLICY-T3: Made for Kids content stays playable, tracking restricted", () => {
  it("flags madeForKids=true without blocking playback", () => {
    const item = {
      ...baseItem(),
      status: { ...baseItem().status, madeForKids: true },
    };
    const result = evaluateYouTubePolicy(VIDEO_ID, item);
    expect(result.ok).toBe(true);
    expect(result.policy.status).toBe("made_for_kids");
    expect(result.policy.made_for_kids).toBe(true);
    expect(result.policy.playable).toBe(true);
    expect(result.policy.tracking_restricted).toBe(true);
  });
});

describe("YT-POLICY-T4: non-embeddable content is rejected", () => {
  it("flags embeddable=false as a policy violation", () => {
    const item = {
      ...baseItem(),
      status: { ...baseItem().status, embeddable: false },
    };
    const result = evaluateYouTubePolicy(VIDEO_ID, item);
    expect(result.ok).toBe(false);
    expect(result.policy.status).toBe("not_embeddable");
    expect(result.policy.embeddable).toBe(false);
  });
});

describe("YT-POLICY-T5: unavailable or private content is rejected", () => {
  it("flags private videos as privacy blocked", () => {
    const item = {
      ...baseItem(),
      status: { ...baseItem().status, privacyStatus: "private" },
    };
    const result = evaluateYouTubePolicy(VIDEO_ID, item);
    expect(result.ok).toBe(false);
    expect(result.policy.status).toBe("privacy_blocked");
  });

  it("flags missing status as unavailable", () => {
    const item = { snippet: { title: "x" } };
    const result = evaluateYouTubePolicy(VIDEO_ID, item);
    expect(result.ok).toBe(false);
    expect(result.policy.status).toBe("unavailable");
  });

  it("accepts public and unlisted videos", () => {
    for (const privacy of ["public", "unlisted"]) {
      const item = {
        ...baseItem(),
        status: { ...baseItem().status, privacyStatus: privacy },
      };
      const result = evaluateYouTubePolicy(VIDEO_ID, item);
      expect(result.ok).toBe(true);
      expect(result.policy.status).toBe("ok");
      expect(result.policy.privacy_status).toBe(privacy);
    }
  });
});

describe("YT-POLICY-T6: cache TTL and freshness", () => {
  it("defaults to a 24-hour TTL", () => {
    const result = evaluateYouTubePolicy(VIDEO_ID, baseItem());
    expect(result.policy.ttl_seconds).toBe(24 * 60 * 60);
  });

  it("treats a policy as fresh within its TTL", () => {
    const result = evaluateYouTubePolicy(VIDEO_ID, baseItem());
    expect(isPolicyFresh(result.policy)).toBe(true);
  });

  it("treats an expired policy as stale", () => {
    const policy: MediaPolicy = {
      ...evaluateYouTubePolicy(VIDEO_ID, baseItem()).policy,
      checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    expect(isPolicyFresh(policy)).toBe(false);
  });

  it("round-trips through JSONB", () => {
    const original = evaluateYouTubePolicy(VIDEO_ID, baseItem()).policy;
    const jsonb = policyToJsonb(original);
    const parsed = policyFromJsonb(jsonb);
    expect(parsed).toEqual(original);
  });
});

describe("thumbnail safety", () => {
  it("derives a canonical thumbnail from the video id", () => {
    expect(canonicalYouTubeThumbnailUrl(VIDEO_ID)).toBe(
      `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
    );
  });

  it("rejects non-YouTube image hosts", () => {
    expect(isSafeThumbnailUrl("https://evil.test/phish.png")).toBe(false);
    expect(isSafeThumbnailUrl("https://i.ytimg.com/vi/../etc/passwd")).toBe(false);
  });

  it("accepts only the expected YouTube thumbnail path", () => {
    expect(isSafeThumbnailUrl(`https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`)).toBe(true);
  });

  it("falls back to canonical thumbnail when the API thumbnail is from an unexpected host", () => {
    const item = {
      snippet: {
        title: "x",
        thumbnails: {
          default: { url: "https://evil.test/thumb.jpg" },
        },
      },
      status: { madeForKids: false, embeddable: true, privacyStatus: "public" },
    };
    const result = evaluateYouTubePolicy(VIDEO_ID, item);
    expect(result.ok).toBe(true);
    expect(result.policy.thumbnail_url).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
  });
});
