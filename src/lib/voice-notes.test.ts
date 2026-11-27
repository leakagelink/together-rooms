import { describe, expect, it } from "vitest";

import {
  MAX_VOICE_NOTE_MS,
  buildVoiceNotePath,
  clampVoiceNoteDuration,
  formatVoiceDuration,
  pickRecorderMime,
  voiceNoteFileFormat,
} from "./voice-notes";

describe("voice note rules", () => {
  it("allows voice notes up to 5 minutes", () => {
    expect(MAX_VOICE_NOTE_MS).toBe(300_000);
    expect(clampVoiceNoteDuration(300_000)).toBe(300_000);
    expect(clampVoiceNoteDuration(320_000)).toBe(300_000);
  });

  it("discards accidental taps shorter than 1 second", () => {
    expect(clampVoiceNoteDuration(999)).toBeNull();
    expect(clampVoiceNoteDuration(1000)).toBe(1000);
  });

  it("stores each note in the sender's folder inside the room", () => {
    expect(buildVoiceNotePath("room-1", "user-1", "file-1", "webm")).toBe("room-1/user-1/file-1.webm");
  });

  it("prefers Opus WebM and falls back to MP4 audio", () => {
    expect(pickRecorderMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecorderMime(() => false)).toBeNull();
  });

  it("maps recorder formats to accepted uploads", () => {
    expect(voiceNoteFileFormat("audio/webm;codecs=opus")).toEqual({ contentType: "audio/webm", ext: "webm" });
    expect(voiceNoteFileFormat("audio/mp4")).toEqual({ contentType: "audio/mp4", ext: "m4a" });
    expect(voiceNoteFileFormat("video/webm")).toBeNull();
  });

  it("formats durations as m:ss", () => {
    expect(formatVoiceDuration(65_000)).toBe("1:05");
    expect(formatVoiceDuration(300_000)).toBe("5:00");
  });
});
