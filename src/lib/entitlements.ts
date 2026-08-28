/**
 * PHASE 15 — free-only product model.
 *
 * SyncTogether v1 has NO paid tier, no in-app purchases and no subscriptions.
 * There is therefore no entitlement to grant, buy, restore or spoof: every
 * signed-in account gets the identical product.
 *
 * The limits below are ANTI-ABUSE limits, not monetization gates. They exist
 * so a single account cannot exhaust shared capacity, and the authoritative
 * copy lives in Postgres (`public.product_limits()`, the rooms limit trigger
 * and `set_room_capacity`). The values here are a mirror used for UI copy
 * only — a tampered client can change the label, never the enforcement.
 */

export interface ProductLimits {
  max_active_rooms: number;
  max_room_members: number;
  max_local_media_minutes: number;
  max_playlists: number;
  /** Ads are shown to everyone; consent still decides whether any is served. */
  ads_enabled: boolean;
}

/** Must stay in sync with `public.product_limits()`. */
export const PRODUCT_LIMITS: ProductLimits = {
  max_active_rooms: 25,
  max_room_members: 25,
  max_local_media_minutes: 60,
  max_playlists: 25,
  ads_enabled: true,
};

export interface ProductLimitRow {
  key: keyof ProductLimits | "core";
  label: string;
  value: string;
}

/**
 * What every account gets. There is no comparison column, because there is
 * nothing to compare against and nothing to upsell.
 */
export const INCLUDED_FEATURES: readonly ProductLimitRow[] = [
  {
    key: "core",
    label: "Rooms, chat, synced watching, music and study tools",
    value: "Included for everyone",
  },
  { key: "max_active_rooms", label: "Active rooms you can host", value: "25" },
  { key: "max_room_members", label: "People per room", value: "Up to 25" },
  { key: "max_local_media_minutes", label: "Local media session length", value: "60 minutes" },
  { key: "max_playlists", label: "Saved playlists", value: "25" },
  { key: "ads_enabled", label: "Advertising", value: "Occasional ads, consent-controlled" },
];

/** Plain-language explanation shown wherever a limit is reached. */
export function describeLimit(key: keyof ProductLimits): string {
  switch (key) {
    case "max_active_rooms":
      return `You can host ${PRODUCT_LIMITS.max_active_rooms} rooms at a time. End a room you no longer need to start another.`;
    case "max_room_members":
      return `Rooms hold up to ${PRODUCT_LIMITS.max_room_members} people.`;
    case "max_local_media_minutes":
      return `Local media sessions run for up to ${PRODUCT_LIMITS.max_local_media_minutes} minutes, then stop automatically.`;
    case "max_playlists":
      return `You can keep ${PRODUCT_LIMITS.max_playlists} saved playlists.`;
    case "ads_enabled":
      return "SyncTogether is free and supported by ads. You control ad personalisation in Privacy settings.";
  }
}
