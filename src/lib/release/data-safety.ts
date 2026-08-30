/**
 * PHASE 15 — Play Data Safety inventory, derived from actual behaviour.
 *
 * Every entry below corresponds to something the implementation demonstrably
 * does. SyncTogether is a free-only product with no subscriptions or
 * in-app purchases.
 */

export type DataCategory =
  | "account_identifiers"
  | "profile"
  | "user_generated_content"
  | "photos_videos_audio"
  | "voice_video_streams"
  | "app_activity"
  | "advertising_id"
  | "diagnostics";

export interface DataSafetyEntry {
  category: DataCategory;
  collected: boolean;
  /** Persisted server-side (as opposed to only transiting). */
  stored: boolean;
  processed: boolean;
  /** Third parties the data is disclosed to, by name. Empty = not shared. */
  sharedWith: readonly string[];
  retention: string;
  purpose: string;
  protection: string;
  requiresOwnerReview: boolean;
}

export const DATA_SAFETY_INVENTORY: readonly DataSafetyEntry[] = [
  {
    category: "account_identifiers",
    collected: true,
    stored: true,
    processed: true,
    sharedWith: [],
    retention: "Until account deletion is completed.",
    purpose: "Authentication and account management.",
    protection: "Encrypted in transit (https); row level security; deletion request pipeline.",
    requiresOwnerReview: false,
  },
  {
    category: "profile",
    collected: true,
    stored: true,
    processed: true,
    sharedWith: [],
    retention: "Until account deletion.",
    purpose: "Display name, avatar and bio shown to other room members.",
    protection: "RLS, privacy visibility settings.",
    requiresOwnerReview: false,
  },
  {
    category: "user_generated_content",
    collected: true,
    stored: true,
    processed: true,
    sharedWith: [],
    retention: "Per room chat retention setting (persistent, room expiry, 24h or 7d).",
    purpose: "Room chat, notes, tasks, resources, reports and moderation.",
    protection: "RLS; writes only via server-authoritative RPCs; moderation archive is admin-only.",
    requiresOwnerReview: false,
  },
  {
    category: "photos_videos_audio",
    collected: false,
    stored: false,
    processed: true,
    sharedWith: [],
    retention: "Not stored. Streamed peer to peer for the lifetime of the sharing session only.",
    purpose: "Temporary local media sharing inside a room.",
    protection: "Encrypted WebRTC transport; time-limited, revocable transport grants.",
    requiresOwnerReview: false,
  },
  {
    category: "voice_video_streams",
    collected: false,
    stored: false,
    processed: false,
    sharedWith: [],
    retention: "Not applicable. Voice and video calling is not available in this release.",
    purpose: "Not used. The feature is not shipped.",
    protection: "Not applicable; no voice or video stream is captured by the app.",
    requiresOwnerReview: false,
  },
  {
    category: "app_activity",
    collected: true,
    stored: true,
    processed: true,
    sharedWith: [],
    retention: "Room events retained with the room; analytics events subject to consent.",
    purpose: "Room lifecycle auditing, abuse investigation and product analytics.",
    protection: "RLS; analytics gated on the user's analytics consent setting.",
    requiresOwnerReview: false,
  },
  {
    category: "advertising_id",
    collected: true,
    stored: false,
    processed: true,
    sharedWith: ["Google AdMob"],
    retention: "Not retained by this application.",
    purpose: "Serving ads to users.",
    protection: "UMP consent gating; personalisation refused when consent is not granted.",
    requiresOwnerReview: true,
  },
  {
    category: "diagnostics",
    collected: true,
    stored: false,
    processed: true,
    sharedWith: [],
    retention: "Structured logs only; no external monitoring vendor is connected today.",
    purpose: "Crash and error diagnosis.",
    protection: "Three-layer redaction before any log or monitor emission.",
    requiresOwnerReview: true,
  },
];
