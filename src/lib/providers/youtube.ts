/**
 * Phase 4.1 — the YouTube provider. The only implemented MediaProvider.
 *
 * Official surfaces only: the IFrame Player API for playback and the public
 * oEmbed endpoint for metadata. No scraping, no stream extraction, no
 * downloading, no proxying, no restriction bypass.
 */
import {
  providerError,
  type MediaProvider,
  type ProviderError,
  type ProviderMetadata,
} from "./media-provider";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_HOSTS = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];

/**
 * Extracts a YouTube video id from the common public URL shapes, or from a
 * bare id. Pure and offline — no network call, no guessing. Only the
 * 11-character id is ever transmitted; the pasted URL is discarded.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (YOUTUBE_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const id = segments[0];
    return id && YOUTUBE_ID.test(id) ? id : null;
  }
  if (!ALLOWED_HOSTS.includes(host)) return null;

  const v = url.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;

  const [first, second] = segments;
  if (first && ["embed", "v", "shorts", "live"].includes(first) && second) {
    return YOUTUBE_ID.test(second) ? second : null;
  }
  return null;
}

export function isValidYouTubeVideoId(id: string): boolean {
  return YOUTUBE_ID.test(id);
}

/**
 * IFrame Player API error codes (official):
 *  2   — invalid parameter (bad video id)
 *  5   — HTML5 player error
 *  100 — video removed or private
 *  101 — embedding disallowed by the owner
 *  150 — same as 101 (restricted playback / rights holder)
 *
 * The API cannot distinguish "removed" from "private", nor region from
 * age-gating, so those are reported honestly rather than guessed.
 */
export function classifyYouTubePlayerError(code: unknown): ProviderError {
  switch (Number(code)) {
    case 2:
      return providerError("invalid_id", "yt:2");
    case 5:
      return providerError("player_init_failed", "yt:5");
    case 100:
      return providerError("unavailable", "yt:100");
    case 101:
    case 150:
      return providerError("embed_disabled", "yt:101/150");
    case 153:
      // Client identity error: the site origin is not allowed by YouTube's
      // referrer restrictions. We report this as a playback failure, not as a
      // generic sync error.
      return providerError("unavailable", "yt:153");
    default:
      return providerError("unknown", `yt:${String(code ?? "none")}`);
  }
}

/** Canonical thumbnail for a video id. Deterministic — never caller-supplied. */
export function youTubeThumbnailUrl(videoId: string): string | null {
  return isValidYouTubeVideoId(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

/** Fallback display metadata when the provider cannot be reached or refuses. */
export function fallbackMetadata(videoId: string): ProviderMetadata {
  return {
    title: `YouTube video ${videoId}`,
    thumbnailUrl: null,
    source: "fallback",
  };
}

export const youtubeProvider: MediaProvider = {
  id: "youtube",
  displayName: "YouTube",
  parseReference: parseYouTubeVideoId,
  isValidMediaId: isValidYouTubeVideoId,
  // Privacy-enhanced host: no YouTube cookies are set until playback starts.
  embedHost: "https://www.youtube-nocookie.com",
  classifyPlayerError: classifyYouTubePlayerError,
};

/** The single supported provider. Unknown ids are rejected, not defaulted. */
export function getMediaProvider(id: string | null | undefined): MediaProvider | null {
  return id === "youtube" ? youtubeProvider : null;
}
