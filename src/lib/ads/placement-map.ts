/**
 * PHASE 13.1 — the explicit, reviewable placement map.
 *
 * Phase 11 answered "may an ad be shown given what the user is doing right
 * now". This module answers the complementary question: "is this SURFACE ever
 * an allowed place for this format at all". Both must pass.
 *
 * The lists are allow-lists: a placement string that is not enumerated here is
 * refused, so a new screen cannot accidentally inherit advertising.
 */

/** Screens where a static, clearly-labelled banner is permitted. */
export const APPROVED_BANNER_PLACEMENTS = [
  /** Rooms list, below the list content. Low interaction, no media, no input. */
  "rooms_list_footer",
] as const;

export type ApprovedBannerPlacement = (typeof APPROVED_BANNER_PLACEMENTS)[number];

/**
 * Natural transition points where a full-screen ad may be considered.
 *
 * Deliberately tiny: never at launch, never at exit, never entering a room,
 * never during or around playback, calls, chat, local media or study work.
 */
export const APPROVED_INTERSTITIAL_TRANSITIONS = [
  /** After a room session has fully ended and the user is back on the list. */
  "room_session_ended",
] as const;

export type ApprovedInterstitialTransition = (typeof APPROVED_INTERSTITIAL_TRANSITIONS)[number];

/**
 * Surfaces that are explicitly forbidden. Kept as data so the policy is
 * reviewable and testable rather than implied by the absence of a call site.
 */
export const FORBIDDEN_AD_SURFACES = [
  "home",
  "auth",
  "profile",
  "room_create",
  "room_join",
  "room_active",
  "chat",
  "youtube_room",
  "music_room",
  "study_room",
  "research_board",
  "notes",
  "tasks",
  "local_media",
  "voice_call",
  "video_call",
  "admin",
  "privacy_settings",
  "subscription",
  "billing",
  "app_launch",
  "app_exit",
] as const;

export function isApprovedBannerPlacement(placement: string): boolean {
  return (APPROVED_BANNER_PLACEMENTS as readonly string[]).includes(placement);
}

export function isApprovedInterstitialTransition(placement: string): boolean {
  return (APPROVED_INTERSTITIAL_TRANSITIONS as readonly string[]).includes(placement);
}

export function isForbiddenAdSurface(placement: string): boolean {
  return (FORBIDDEN_AD_SURFACES as readonly string[]).includes(placement);
}
