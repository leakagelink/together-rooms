/**
 * Voice notes in room chat. The database (send_room_voice_note) is
 * authoritative for every limit here; these copies drive the recorder UI.
 */
export const VOICE_NOTE_BUCKET = "voice-notes";
/** Longest voice note a member can record (5 minutes). */
export const MAX_VOICE_NOTE_MS = 5 * 60 * 1000;
/** Shorter taps are treated as accidental and discarded. */
export const MIN_VOICE_NOTE_MS = 1000;
/** Keeps a 5-minute note well under the bucket's 6 MB limit. */
export const VOICE_NOTE_BITRATE = 48_000;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/aac",
] as const;

/** First recorder format the device supports, or null when none is. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string | null {
  for (const mime of MIME_CANDIDATES) {
    if (isSupported(mime)) return mime;
  }
  return null;
}

/** Upload content type (no codec suffix) and file extension for a recorder mime. */
export function voiceNoteFileFormat(mime: string): { contentType: string; ext: string } | null {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (base) {
    case "audio/webm":
      return { contentType: "audio/webm", ext: "webm" };
    case "audio/ogg":
      return { contentType: "audio/ogg", ext: "ogg" };
    case "audio/mp4":
      return { contentType: "audio/mp4", ext: "m4a" };
    case "audio/mpeg":
      return { contentType: "audio/mpeg", ext: "mp3" };
    case "audio/aac":
      return { contentType: "audio/aac", ext: "aac" };
    default:
      return null;
  }
}

/** `<room>/<sender>/<uuid>.<ext>` — the folder layout storage rules depend on. */
export function buildVoiceNotePath(roomId: string, userId: string, fileId: string, ext: string) {
  return `${roomId}/${userId}/${fileId}.${ext}`;
}

/** Recorded length clamped to what the server accepts, or null if too short. */
export function clampVoiceNoteDuration(ms: number): number | null {
  if (!Number.isFinite(ms) || ms < MIN_VOICE_NOTE_MS) return null;
  return Math.min(Math.round(ms), MAX_VOICE_NOTE_MS);
}

export function formatVoiceDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
