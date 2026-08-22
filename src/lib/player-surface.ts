/**
 * Phase 4.2 — what the watch surface is allowed to draw.
 *
 * Embedded-player integrity rule: once the official YouTube player has a video
 * loaded, NOTHING may cover, obscure, replace or intercept it. Any message we
 * need to show at that point is a notice rendered OUTSIDE the player frame.
 * A blocking in-frame overlay is only legal while no video is rendered.
 */
import type { MediaPolicyStatus } from "@/lib/media-policy";

export interface PlayerSurfaceInput {
  /** Sanitized provider error copy, if the player reported one. */
  providerFailure: string | null;
  /** Whether the viewer still has room playback access. */
  authorized: boolean;
  /** IFrame API player has finished initializing. */
  playerReady: boolean;
  /** Authoritative state or metadata still loading. */
  loading: boolean;
  /** The room has a media id selected. */
  hasMedia: boolean;
  /** Realtime connection is healthy. */
  connected: boolean;
  /** Local autoplay was refused and needs a user gesture. */
  awaitingGesture: boolean;
  /** Server-verified policy status for the current media, if known. */
  policyStatus: MediaPolicyStatus | null;
}

export type PlayerNoticeTone = "info" | "warning";

export interface PlayerNotice {
  id: string;
  tone: PlayerNoticeTone;
  message: string;
}

export interface PlayerSurfacePlan {
  /** Message drawn inside the player frame. Null whenever a video is rendered. */
  overlay: string | null;
  /** Messages drawn outside the player frame; never obscure the video. */
  notices: PlayerNotice[];
  /** Render the "Tap to Sync" control (always outside the player frame). */
  gesturePrompt: boolean;
  /** True when a video is actually rendered in the frame. */
  videoRendered: boolean;
}

const PLAYABLE: readonly MediaPolicyStatus[] = ["ok", "made_for_kids"];

const BLOCKED_COPY: Partial<Record<MediaPolicyStatus, string>> = {
  not_embeddable: "The owner has disabled embedding for this video.",
  privacy_blocked: "This video is private.",
  unavailable: "This video is unavailable.",
  invalid: "That video reference isn't valid.",
  provider_verification_failed:
    "We couldn't verify this video with YouTube. Playback is paused until verification succeeds.",
};

export function planPlayerSurface(input: PlayerSurfaceInput): PlayerSurfacePlan {
  const policyBlocked =
    input.policyStatus !== null && !PLAYABLE.includes(input.policyStatus);

  const videoRendered =
    input.hasMedia &&
    input.authorized &&
    input.playerReady &&
    !input.providerFailure &&
    !policyBlocked;

  const notices: PlayerNotice[] = [];
  if (input.policyStatus === "made_for_kids") {
    notices.push({
      id: "made-for-kids",
      tone: "info",
      message:
        "Marked Made for Kids on YouTube. It plays normally here, and viewing analytics are turned off.",
    });
  }
  if (videoRendered && !input.connected) {
    notices.push({
      id: "connection",
      tone: "warning",
      message: "Connection lost — trying to reconnect. Playback keeps running locally.",
    });
  }

  // Once a video is rendered, no in-frame overlay is permitted.
  let overlay: string | null = null;
  if (!videoRendered) {
    if (input.providerFailure) overlay = input.providerFailure;
    else if (!input.authorized) overlay = "You no longer have access to this room's playback.";
    else if (policyBlocked)
      overlay = BLOCKED_COPY[input.policyStatus as MediaPolicyStatus] ?? "This video can't be played here.";
    else if (!input.hasMedia) overlay = "No video selected yet.";
    else if (!input.playerReady) overlay = "Starting the player…";
    else if (input.loading) overlay = "Loading playback state…";
    else if (!input.connected) overlay = "Connection lost — trying to reconnect…";
  }

  return {
    overlay,
    notices,
    // The gesture prompt lives outside the frame, so it is safe to show while
    // the video is rendered — and pointless when it is not.
    gesturePrompt: input.awaitingGesture && videoRendered,
    videoRendered,
  };
}
