/**
 * YouTube Shorts Together — pure helpers.
 *
 * This module adds NOTHING to the playback transport: Shorts reuse the exact
 * same authoritative room playback state, the same RPCs and the same official
 * YouTube IFrame player as regular Watch Together. What lives here is only:
 *
 *  - reference parsing restricted to legitimate YouTube URL shapes,
 *  - the watch-mode value object shared by the room player and the database.
 *
 * No scraping, no feed crawling, no stream extraction, no rehosting: the only
 * thing ever derived from user input is an 11-character video id.
 */
import { parseYouTubeVideoId, isValidYouTubeVideoId } from "@/lib/providers/youtube";

export type WatchMode = "video" | "shorts";

export const WATCH_MODES: readonly WatchMode[] = ["video", "shorts"];

/** Narrows an unknown value (database row, realtime payload) to a watch mode. */
export function toWatchMode(value: unknown): WatchMode {
  return value === "shorts" ? "shorts" : "video";
}

export interface ShortsReference {
  videoId: string;
  /** True when the pasted URL was explicitly a /shorts/ link. */
  isShortsUrl: boolean;
}

const SHORTS_HOSTS = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];

/** True when the input is a youtube.com/shorts/<id> style link. */
export function isShortsUrl(input: string): boolean {
  const raw = input.trim();
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!SHORTS_HOSTS.includes(host)) return false;
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[0] === "shorts" && Boolean(segments[1]);
}

/**
 * Parses a Shorts (or plain YouTube) reference.
 *
 * Accepted inputs — everything else returns null:
 *   https://www.youtube.com/shorts/VIDEO_ID
 *   https://youtube.com/shorts/VIDEO_ID          (also m./music./nocookie hosts)
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://www.youtube.com/embed|v|live/VIDEO_ID
 *   a bare 11-character video id
 *
 * Validation is delegated to the existing provider parser, so Shorts can never
 * accept a URL shape the rest of the app rejects. The result is re-validated
 * against the id pattern before it is returned, and the server RPC validates it
 * again independently.
 */
export function parseShortsReference(input: string): ShortsReference | null {
  const videoId = parseYouTubeVideoId(input);
  if (!videoId || !isValidYouTubeVideoId(videoId)) return null;
  return { videoId, isShortsUrl: isShortsUrl(input) };
}

/**
 * Whether a mode change should be sent to the server.
 *
 * Loop guard #1: the room mode is authoritative, so a device only writes when
 * the requested mode actually differs from the state it last received. An
 * incoming realtime update that merely echoes our own write therefore produces
 * no further write.
 */
export function shouldPublishWatchMode(current: WatchMode, requested: WatchMode): boolean {
  return current !== requested;
}

/** Aspect classes for the stage. Shorts are portrait 9:16, never stretched. */
export function watchModeAspectClass(mode: WatchMode): string {
  return mode === "shorts" ? "aspect-[9/16]" : "aspect-video";
}

/**
 * What a Shorts swipe does for this member.
 *  - "room": host/controller — changes the Short for everyone (authoritative RPC).
 *  - "personal": other members — browse locally only; the room is untouched and
 *    they can rejoin the room's Short at any time.
 *  - "none": not in Shorts mode or the room is closed.
 */
export type ShortsSwipeScope = "room" | "personal" | "none";

export function shortsSwipeScope(input: {
  shortsMode: boolean;
  roomActive: boolean;
  canControl: boolean;
}): ShortsSwipeScope {
  if (!input.shortsMode || !input.roomActive) return "none";
  return input.canControl ? "room" : "personal";
}
