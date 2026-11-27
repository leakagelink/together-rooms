import { describe, expect, it } from "vitest";

import {
  isShortsUrl,
  parseShortsReference,
  shortsSwipeScope,
  shouldPublishWatchMode,
  toWatchMode,
  watchModeAspectClass,
} from "./shorts";

const ID = "dQw4w9WgXcQ";

describe("shorts url parsing", () => {
  it("accepts canonical shorts urls", () => {
    for (const url of [
      `https://www.youtube.com/shorts/${ID}`,
      `https://youtube.com/shorts/${ID}`,
      `https://m.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/shorts/${ID}?feature=share`,
    ]) {
      expect(parseShortsReference(url)).toEqual({ videoId: ID, isShortsUrl: true });
    }
  });

  it("accepts youtu.be and standard watch urls, flagged as not shorts urls", () => {
    expect(parseShortsReference(`https://youtu.be/${ID}`)).toEqual({
      videoId: ID,
      isShortsUrl: false,
    });
    expect(parseShortsReference(`https://www.youtube.com/watch?v=${ID}`)).toEqual({
      videoId: ID,
      isShortsUrl: false,
    });
    expect(parseShortsReference(ID)).toEqual({ videoId: ID, isShortsUrl: false });
  });

  it("rejects non-youtube, malformed and unsafe input", () => {
    for (const bad of [
      "",
      "   ",
      "not a url",
      "javascript:alert(1)",
      `https://evil.example.com/shorts/${ID}`,
      `https://youtube.com.evil.com/shorts/${ID}`,
      "https://www.youtube.com/shorts/short",
      "https://www.youtube.com/shorts/",
      `ftp://youtube.com/shorts/${ID}`,
      `<script>${ID}</script>`,
    ]) {
      expect(parseShortsReference(bad)).toBeNull();
    }
  });

  it("detects shorts urls without accepting foreign hosts", () => {
    expect(isShortsUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(true);
    expect(isShortsUrl(`https://evil.example.com/shorts/${ID}`)).toBe(false);
    expect(isShortsUrl(`https://youtu.be/${ID}`)).toBe(false);
  });
});

describe("watch mode", () => {
  it("narrows unknown values conservatively", () => {
    expect(toWatchMode("shorts")).toBe("shorts");
    expect(toWatchMode("video")).toBe("video");
    expect(toWatchMode(null)).toBe("video");
    expect(toWatchMode(undefined)).toBe("video");
    expect(toWatchMode("SHORTS")).toBe("video");
    expect(toWatchMode(42)).toBe("video");
  });

  it("only publishes a real change (sync loop guard)", () => {
    expect(shouldPublishWatchMode("video", "shorts")).toBe(true);
    expect(shouldPublishWatchMode("shorts", "shorts")).toBe(false);
    expect(shouldPublishWatchMode("video", "video")).toBe(false);
  });

  it("uses portrait framing for shorts only", () => {
    expect(watchModeAspectClass("shorts")).toBe("aspect-[9/16]");
    expect(watchModeAspectClass("video")).toBe("aspect-video");
  });
});

describe("shorts swipe scope", () => {
  it("host or controller swipes change the Short for the whole room", () => {
    expect(shortsSwipeScope({ shortsMode: true, roomActive: true, canControl: true })).toBe("room");
  });
  it("joined members can swipe, but only for themselves", () => {
    expect(shortsSwipeScope({ shortsMode: true, roomActive: true, canControl: false })).toBe(
      "personal",
    );
  });
  it("no swiping outside Shorts mode or in a closed room", () => {
    expect(shortsSwipeScope({ shortsMode: false, roomActive: true, canControl: true })).toBe("none");
    expect(shortsSwipeScope({ shortsMode: true, roomActive: false, canControl: false })).toBe("none");
  });
});
