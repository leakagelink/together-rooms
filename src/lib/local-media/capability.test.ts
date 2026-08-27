import { describe, expect, it } from "vitest";

import {
  checkSelection,
  describeSelection,
  detectCapability,
  kindForMimeType,
  selectionMessage,
} from "./capability";
import { MAX_IMAGE_ITEMS, MAX_QUEUE_ITEMS, MAX_SESSION_BYTES } from "./limits";

const probe = (answer: string) => ({ canPlayType: () => answer });

describe("local media capability", () => {
  it("classifies media kinds from MIME types only", () => {
    expect(kindForMimeType("image/jpeg")).toBe("image");
    expect(kindForMimeType("VIDEO/MP4")).toBe("video");
    expect(kindForMimeType("audio/mpeg")).toBe("audio");
    expect(kindForMimeType("application/pdf")).toBeNull();
  });

  it("maps canPlayType answers to explicit verdicts", () => {
    expect(detectCapability("video/mp4", probe("probably"))).toBe("supported");
    expect(detectCapability("video/x-matroska", probe("maybe"))).toBe("maybe");
    expect(detectCapability("video/x-weird", probe(""))).toBe("unsupported");
  });

  it("treats HEIC as uncertain rather than promising playback", () => {
    expect(detectCapability("image/heic", null)).toBe("maybe");
    expect(detectCapability("image/png", null)).toBe("supported");
  });

  it("rejects oversized, mixed and over-count selections", () => {
    expect(checkSelection([]).reason).toBe("empty");
    expect(checkSelection([{ type: "text/plain", size: 10 }]).reason).toBe("unsupported_kind");
    expect(checkSelection([{ type: "video/mp4", size: MAX_SESSION_BYTES + 1 }]).reason).toBe(
      "too_large",
    );
    expect(
      checkSelection([
        { type: "video/mp4", size: 10 },
        { type: "image/png", size: 10 },
      ]).reason,
    ).toBe("mixed_kinds");
    const many = Array.from({ length: MAX_IMAGE_ITEMS + 1 }, () => ({
      type: "image/png",
      size: 10,
    }));
    expect(checkSelection(many).reason).toBe("too_many_items");
  });

  it("accepts a valid photo set and a single video", () => {
    expect(checkSelection([{ type: "image/jpeg", size: 100 }]).ok).toBe(true);
    expect(checkSelection([{ type: "video/mp4", size: 100 }]).kind).toBe("video");
  });

  it("accepts a multi-item video or audio queue up to the queue limit", () => {
    const videos = Array.from({ length: MAX_QUEUE_ITEMS }, () => ({
      type: "video/mp4",
      size: 100,
    }));
    expect(checkSelection(videos).ok).toBe(true);
    expect(checkSelection([...videos, { type: "video/mp4", size: 100 }]).reason).toBe(
      "too_many_items",
    );
    expect(
      checkSelection([
        { type: "audio/mpeg", size: 10 },
        { type: "audio/mpeg", size: 10 },
      ]).kind,
    ).toBe("audio");
  });

  it("counts every queued item in the privacy-safe descriptor", () => {
    const descriptor = describeSelection([
      { type: "video/mp4", size: 10 },
      { type: "video/mp4", size: 10 },
    ]);
    expect(descriptor?.item_count).toBe(2);
  });

  it("describes a selection without any identifying metadata", () => {
    const descriptor = describeSelection([{ type: "video/mp4; codecs=avc1", size: 10 }], 12.4);
    expect(descriptor).toEqual({
      media_kind: "video",
      mime_type: "video/mp4",
      item_count: 1,
      duration_seconds: 12,
    });
    expect(Object.keys(descriptor ?? {})).not.toContain("name");
  });

  it("explains every rejection in plain language", () => {
    expect(selectionMessage("too_large")).toMatch(/too large/i);
    expect(selectionMessage("unsupported_kind")).toMatch(/photos, videos and audio/i);
  });
});
