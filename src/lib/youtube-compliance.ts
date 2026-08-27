/**
 * YouTube Terms of Service enforcement for the embedded player.
 *
 * Two rules are enforced here, not merely documented:
 *
 *  1. NO BACKGROUND PLAYBACK — YouTube content may only play while the
 *     embedded player is visible to the user. When the app is backgrounded,
 *     minimised or the tab is hidden, the local player is paused. The pause is
 *     LOCAL ONLY: it never writes to the authoritative room state, so other
 *     members keep watching.
 *  2. NO AUDIO-ONLY EXTRACTION — the video frame must stay rendered. Audio-first
 *     ("music") rooms are allowed to shrink the player into a mini player, but
 *     never to hide, size to zero, or detach it. Any attempt to separate the
 *     audio stream from the official IFrame player is rejected.
 *
 * Everything in this module is pure so it can be unit-tested and reused by the
 * watch surface, the music room and the Android lifecycle bridge.
 */

export const YOUTUBE_COMPLIANCE_LIMITS: readonly string[] = [
  "Video playback pauses automatically when SyncTogether is minimised or the screen is off.",
  "Audio-only playback and downloading YouTube content are not supported.",
  "The official YouTube player always stays visible while a track plays.",
];

export const BACKGROUND_PAUSE_NOTICE =
  "Playback paused because SyncTogether went to the background. YouTube doesn't allow background or audio-only playback.";

export const AUDIO_MODE_NOTICE =
  "Audio-first mode keeps the YouTube video in a mini player. Background and audio-only playback aren't allowed by YouTube.";

/** Minimum rendered size (CSS px) that still counts as a visible player. */
export const MIN_VISIBLE_PLAYER_PX = 64;

export type AppVisibility = "visible" | "hidden";

export interface BackgroundEnforcementInput {
  visibility: AppVisibility;
  /** The room has a YouTube media id selected. */
  hasMedia: boolean;
  /** The local IFrame player is currently playing. */
  locallyPlaying: boolean;
}

export interface BackgroundEnforcementPlan {
  /** Pause the local player. Never a server mutation. */
  pauseLocally: boolean;
  /** Show the compliance notice to the user when they come back. */
  notify: boolean;
  reason: "compliant" | "background_playback_not_allowed";
}

/**
 * Decide what to do when app visibility changes. Returns a pause instruction
 * only while the app is hidden and YouTube audio would otherwise keep running.
 */
export function planBackgroundEnforcement(
  input: BackgroundEnforcementInput,
): BackgroundEnforcementPlan {
  const violating = input.visibility === "hidden" && input.hasMedia && input.locallyPlaying;
  return {
    pauseLocally: violating,
    notify: violating,
    reason: violating ? "background_playback_not_allowed" : "compliant",
  };
}

export interface PlayerSurfaceGeometry {
  /** Rendered width of the player frame in CSS px. */
  width: number;
  /** Rendered height of the player frame in CSS px. */
  height: number;
  /** The frame is attached to the document and not display:none / hidden. */
  mounted: boolean;
}

export interface AudioOnlyVerdict {
  compliant: boolean;
  reason: "compliant" | "player_hidden" | "player_too_small";
}

/**
 * A music/audio-first surface is only compliant while the official player is
 * still mounted and rendered at a human-visible size.
 */
export function verifyPlayerVisibility(geometry: PlayerSurfaceGeometry): AudioOnlyVerdict {
  if (!geometry.mounted || geometry.width <= 0 || geometry.height <= 0) {
    return { compliant: false, reason: "player_hidden" };
  }
  if (geometry.width < MIN_VISIBLE_PLAYER_PX || geometry.height < MIN_VISIBLE_PLAYER_PX / 2) {
    return { compliant: false, reason: "player_too_small" };
  }
  return { compliant: true, reason: "compliant" };
}

/**
 * Reject any player configuration that would strip the video surface or route
 * playback outside the official IFrame player.
 */
export function isCompliantPlayerVars(vars: Record<string, unknown>): boolean {
  if (Number(vars["controls"] ?? 1) < 0) return false;
  // `playsinline: 1` keeps mobile playback inside our visible frame.
  if (Number(vars["playsinline"] ?? 0) !== 1) return false;
  // Nothing may request an extraction / audio-only style surface.
  for (const key of ["audio_only", "audioOnly", "download", "extract"]) {
    if (vars[key]) return false;
  }
  return true;
}
