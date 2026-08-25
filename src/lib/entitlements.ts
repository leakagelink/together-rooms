/**
 * PHASE 9 — centralized entitlement model.
 *
 * The BACKEND is authoritative. Everything in this module is either a type
 * describing the server's snapshot, or a pure helper used to render that
 * snapshot. No function here can *create* premium access: the worst a tampered
 * client can do is draw the wrong badge, because every protected action is
 * re-checked in Postgres (`entitlement_snapshot`, `entitlement_precheck`,
 * `set_room_capacity`, the rooms limit trigger).
 */

export type PlanKey = "free" | "premium";

/** Lifecycle states mirrored from public.entitlement_status. */
export type EntitlementStatus =
  "active" | "grace_period" | "paused" | "expired" | "revoked" | "pending";

export type EntitlementSource =
  "system" | "grant" | "promo" | "billing" | "admin_grant" | "play_billing";

export interface PlanLimits {
  max_active_rooms: number;
  max_room_members: number;
  max_call_minutes: number;
  max_local_media_minutes: number;
  max_playlists: number;
  ads_enabled: boolean;
}

/**
 * Fallback limits used only for optimistic UI before the first authoritative
 * read resolves. They are deliberately the *free* values: an unknown user is
 * never treated as premium.
 */
export const FALLBACK_FREE_LIMITS: PlanLimits = {
  max_active_rooms: 25,
  max_room_members: 10,
  max_call_minutes: 45,
  max_local_media_minutes: 30,
  max_playlists: 5,
  ads_enabled: true,
};

export interface EntitlementSnapshot {
  plan: PlanKey;
  premium: boolean;
  status: EntitlementStatus;
  source: EntitlementSource;
  entitlement_key: string;
  product_id: string | null;
  starts_at: string | null;
  expires_at: string | null;
  grace_until: string | null;
  cancel_at_period_end: boolean;
  ads_enabled: boolean;
  limits: PlanLimits;
}

export const FREE_SNAPSHOT: EntitlementSnapshot = {
  plan: "free",
  premium: false,
  status: "expired",
  source: "system",
  entitlement_key: "premium",
  product_id: null,
  starts_at: null,
  expires_at: null,
  grace_until: null,
  cancel_at_period_end: false,
  ads_enabled: true,
  limits: FALLBACK_FREE_LIMITS,
};

/**
 * Re-derives premium from a cached snapshot.
 *
 * Safe-caching rule (spec §18): losing connectivity must NOT remove premium.
 * A cached snapshot therefore stays premium until its own authoritative
 * expiry/grace timestamp passes — never because a request failed.
 */
export function isSnapshotPremium(
  snapshot: EntitlementSnapshot | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!snapshot || !snapshot.premium) return false;
  if (snapshot.status === "revoked" || snapshot.status === "expired") return false;
  if (snapshot.status === "paused" || snapshot.status === "pending") return false;
  if (snapshot.status === "grace_period") {
    return !snapshot.grace_until || new Date(snapshot.grace_until) > now;
  }
  if (snapshot.status === "active") {
    return !snapshot.expires_at || new Date(snapshot.expires_at) > now;
  }
  return false;
}

/** Human copy for the subscription screen. Never a countdown, never scarcity. */
export function describeStatus(snapshot: EntitlementSnapshot): string {
  if (!isSnapshotPremium(snapshot)) {
    switch (snapshot.status) {
      case "pending":
        return "Your purchase is being confirmed. Premium starts once it is verified.";
      case "paused":
        return "Your subscription is paused.";
      case "revoked":
        return "Your Premium access was removed.";
      default:
        return "You're on the Free plan.";
    }
  }
  if (snapshot.status === "grace_period") {
    return "Premium is active while a billing issue is resolved with Google Play.";
  }
  if (snapshot.cancel_at_period_end) {
    return "Premium is active. It won't renew, and stays until the current period ends.";
  }
  return "Premium is active.";
}

export interface FeatureRow {
  key: string;
  label: string;
  free: string;
  premium: string;
}

/**
 * The published Free vs Premium matrix. Free keeps the entire core product:
 * Premium buys capacity, control and an ad-free experience.
 */
export const FEATURE_MATRIX: readonly FeatureRow[] = [
  {
    key: "core",
    label: "Rooms, chat, sync playback, study & music",
    free: "Included",
    premium: "Included",
  },
  { key: "rooms", label: "Active rooms you host", free: "Standard limit", premium: "Higher limit" },
  {
    key: "capacity",
    label: "Room capacity",
    free: "Up to the free cap",
    premium: "Up to 50 people",
  },
  { key: "calls", label: "Voice & video session length", free: "Standard", premium: "Extended" },
  { key: "media", label: "Local media session length", free: "Standard", premium: "Extended" },
  { key: "playlists", label: "Saved playlists", free: "Standard limit", premium: "Higher limit" },
  { key: "ads", label: "Advertising", free: "Occasional ads", premium: "No ads" },
];

/** Feature keys accepted by the server-side `entitlement_precheck` RPC. */
export type PremiumFeature =
  "ad_free" | "premium_capacity" | "extended_call" | "extended_local_media";
