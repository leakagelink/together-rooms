/**
 * SyncTogether analytics abstraction (Phase 1).
 *
 * Only product-operation events are tracked, and ONLY after the user has
 * given analytics consent (privacy_settings.analytics_consent).
 * Never pass message content, media, tokens or personal data as properties.
 */
import { supabase } from "@/integrations/supabase/client";

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
  | "user_blocked";

export type AnalyticsProperties = Record<string, string | number | boolean | null>;

let consentGranted = false;

export function setAnalyticsConsent(granted: boolean) {
  consentGranted = granted;
}

export function hasAnalyticsConsent() {
  return consentGranted;
}

/** Fire-and-forget. Analytics must never break a user flow. */
export async function track(name: AnalyticsEventName, properties: AnalyticsProperties = {}) {
  if (!consentGranted) return;
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
