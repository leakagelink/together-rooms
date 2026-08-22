import { describe, expect, it } from "vitest";

import {
  classifyYouTubePlayerError,
  fallbackMetadata,
  getMediaProvider,
  isValidYouTubeVideoId,
  parseYouTubeVideoId,
  youTubeThumbnailUrl,
  youtubeProvider,
} from "./youtube";

describe("PROVIDER-T1: URL parsing", () => {
  it("accepts the common public URL shapes", () => {
    const cases = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      "  dQw4w9WgXcQ  ",
    ];
    for (const value of cases) expect(parseYouTubeVideoId(value)).toBe("dQw4w9WgXcQ");
  });

  it("rejects malformed URLs safely", () => {
    const cases = [
      "",
      "   ",
      "not a url",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "https://vimeo.com/12345678901",
      "https://www.youtube.com/watch",
      "https://www.youtube.com/embed/",
    ];
    for (const value of cases) expect(parseYouTubeVideoId(value)).toBeNull();
  });
});

describe("PROVIDER-T2: media id validation", () => {
  it("accepts only the canonical 11-character shape", () => {
    expect(isValidYouTubeVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isValidYouTubeVideoId("_-aBc123XyZ")).toBe(true);
    for (const bad of ["", "short", "dQw4w9WgXcQextra", "dQw4w9WgXc!", "dQw4w9WgXc "]) {
      expect(isValidYouTubeVideoId(bad)).toBe(false);
    }
  });
});

describe("PROVIDER-T3: provider lookup", () => {
  it("resolves YouTube and rejects anything else", () => {
    expect(getMediaProvider("youtube")).toBe(youtubeProvider);
    for (const bad of ["spotify", "vimeo", "", null, undefined, "YOUTUBE"]) {
      expect(getMediaProvider(bad)).toBeNull();
    }
  });

  it("embeds through the privacy-enhanced host", () => {
    expect(youtubeProvider.embedHost).toBe("https://www.youtube-nocookie.com");
  });
});

describe("provider error classification", () => {
  it("maps official player error codes to distinct states", () => {
    expect(classifyYouTubePlayerError(2).kind).toBe("invalid_id");
    expect(classifyYouTubePlayerError(5).kind).toBe("player_init_failed");
    expect(classifyYouTubePlayerError(100).kind).toBe("unavailable");
    expect(classifyYouTubePlayerError(101).kind).toBe("embed_disabled");
    expect(classifyYouTubePlayerError(150).kind).toBe("embed_disabled");
    expect(classifyYouTubePlayerError(undefined).kind).toBe("unknown");
  });

  it("never surfaces a raw provider payload, only sanitized diagnostics", () => {
    const failure = classifyYouTubePlayerError(101);
    expect(failure.message).not.toContain("101");
    expect(failure.diagnostic).toBe("yt:101/150");
  });
});

describe("PROVIDER-T5: metadata is never taken on trust", () => {
  it("derives thumbnails deterministically from the media id", () => {
    expect(youTubeThumbnailUrl("dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(youTubeThumbnailUrl("nope")).toBeNull();
  });

  it("marks unresolved metadata as fallback, not provider-verified", () => {
    const meta = fallbackMetadata("dQw4w9WgXcQ");
    expect(meta.source).toBe("fallback");
    expect(meta.thumbnailUrl).toBeNull();
  });
});
