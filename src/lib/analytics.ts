/**
 * SyncTogether analytics abstraction.
 *
 * Only product-operation events are tracked, and ONLY after the user has given
 * analytics consent. The authoritative record is privacy_settings.analytics_consent;
 * the decision is mirrored into localStorage so it survives a page reload and no
 * event can fire before the stored decision has been read back.
 * Never pass message content, media, tokens or personal data as properties.
 */
import { supabase } from "@/integrations/supabase/client";

export const CONSENT_STORAGE_KEY = "synctogether.analytics_consent.v1";

export type AnalyticsEventName =
  | "app_opened"
  | "signup_completed"
  | "login_completed"
  | "room_created"
  | "room_joined"
  | "room_left"
  | "invite_created"
  | "invite_accepted"
  | "feature_used"
  | "report_submitted"
  | "user_blocked"
  | "chat_message_sent"
  | "chat_reaction_added"
  | "playback_media_selected"
  | "playback_started"
  | "playback_paused"
  | "playback_seeked"
  // Phase 7: operational only. Never carries filenames, paths, EXIF/GPS,
  // media bytes or transport credentials (see local-media/analytics-safety).
  | "local_media_session_started"
  | "local_media_session_ended"
  | "local_media_transport_failed"
  // Phase 8: call control only. Never carries audio, video, transcripts,
  // device identity or transport credentials (see calls/analytics-safety).
  | "call_started"
  | "call_joined"
  | "call_left"
  | "call_ended"
  | "call_connection_failed"
  // Ads only. The product is free: there are no paid plans, purchases or
  // subscriptions, so no purchase/entitlement events exist. Operational only —
  // never ad content or behavioural profiles (see ads/analytics-safety).
  | "ad_requested"
  | "ad_blocked"
  | "ad_shown"
  | "rewarded_ad_completed";

export type AnalyticsProperties = Record<string, string | number | boolean | null>;

/**
 * Playback events are suppressed entirely while the room is showing content
 * marked "Made for Kids". The video still plays; we simply collect nothing
 * about the viewing session, per YouTube's kids-content requirements.
 */
export const PLAYBACK_EVENTS: readonly AnalyticsEventName[] = [
  "playback_media_selected",
  "playback_started",
  "playback_paused",
  "playback_seeked",
];

let playbackTrackingRestricted = false;

/** Set when the active media is Made for Kids. */
export function setPlaybackTrackingRestricted(restricted: boolean) {
  playbackTrackingRestricted = restricted;
}

export function isPlaybackTrackingRestricted(): boolean {
  return playbackTrackingRestricted;
}

/** True when this event must not be recorded for the current media. */
export function isEventSuppressed(name: AnalyticsEventName): boolean {
  return playbackTrackingRestricted && PLAYBACK_EVENTS.includes(name);
}

/**
 * Minimal storage contract so the consent logic is testable without a browser.
 */
export interface ConsentStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let store: ConsentStore | null = null;
let consentGranted: boolean | null = null;

function resolveStore(): ConsentStore | null {
  if (store) return store;
  if (typeof window === "undefined") return null;
  try {
    store = window.localStorage;
  } catch {
    store = null;
  }
  return store;
}

/** Test seam: inject a storage implementation. */
export function __setConsentStore(next: ConsentStore | null) {
  store = next;
  consentGranted = null;
}

/** Persists the decision so it survives reloads. Defaults to denied. */
export function setAnalyticsConsent(granted: boolean) {
  consentGranted = granted;
  const target = resolveStore();
  if (!target) return;
  try {
    if (granted) target.setItem(CONSENT_STORAGE_KEY, "granted");
    else target.setItem(CONSENT_STORAGE_KEY, "denied");
  } catch {
    // Storage unavailable (private mode): fall back to the in-memory value.
  }
}

/** Clears the decision entirely, e.g. on sign-out. Consent then defaults to denied. */
export function clearAnalyticsConsent() {
  consentGranted = null;
  const target = resolveStore();
  try {
    target?.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Safe default: no consent unless a stored "granted" decision exists. */
export function hasAnalyticsConsent(): boolean {
  if (consentGranted !== null) return consentGranted;
  const target = resolveStore();
  if (!target) return false;
  try {
    consentGranted = target.getItem(CONSENT_STORAGE_KEY) === "granted";
  } catch {
    consentGranted = false;
  }
  return consentGranted;
}

/** Fire-and-forget. Analytics must never break a user flow. */
export async function track(name: AnalyticsEventName, properties: AnalyticsProperties = {}) {
  if (!hasAnalyticsConsent()) return;
  // Made for Kids content: no playback telemetry, even with consent.
  if (isEventSuppressed(name)) return;
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from("analytics_events").insert({
      user_id: data.user.id,
      name,
      properties,
    });
  } catch {
    // Swallow: analytics is best-effort and must not surface errors to users.
  }
}
