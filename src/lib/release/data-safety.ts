/**
 * PHASE 13 — Play Data Safety inventory, derived from actual behaviour.
 *
 * Every entry below corresponds to something the implementation demonstrably
 * does. `validateDataSafetyInventory` refuses inventories that make claims the
 * codebase does not support (for example "shared with third parties" without a
 * named recipient, or "not collected" for data that is stored).
 *
 * Answers marked `requiresOwnerReview` are business/legal statements that this
 * project cannot decide on its own.
 */

export type DataCategory =
  | "account_identifiers"
  | "profile"
  | "user_generated_content"
  | "photos_videos_audio"
  | "voice_video_streams"
  | "app_activity"
  | "purchase_history"
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
    category: "purchase_history",
    collected: true,
    stored: true,
    processed: true,
    sharedWith: ["Google Play Billing"],
    retention:
      "Entitlement and subscription events retained for the life of the account; purchase-token recovery material at most 7 days.",
    purpose: "Subscription entitlement, verification and acknowledgement recovery.",
    protection:
      "Service-role-only tables; token hashed for identity; AES-256-GCM recovery envelope.",
    requiresOwnerReview: false,
  },
  {
    category: "advertising_id",
    collected: true,
    stored: false,
    processed: true,
    sharedWith: ["Google AdMob"],
    retention: "Not retained by this application.",
    purpose: "Serving ads to non-premium users.",
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

export type InventoryProblem =
  | "stored_but_not_collected"
  | "shared_without_recipient"
  | "recipient_without_sharing"
  | "missing_retention"
  | "missing_purpose"
  | "missing_protection";

export function validateDataSafetyInventory(
  entries: readonly DataSafetyEntry[] = DATA_SAFETY_INVENTORY,
): { ok: boolean; problems: { category: DataCategory; problem: InventoryProblem }[] } {
  const problems: { category: DataCategory; problem: InventoryProblem }[] = [];
  for (const entry of entries) {
    if (entry.stored && !entry.collected) {
      problems.push({ category: entry.category, problem: "stored_but_not_collected" });
    }
    if (entry.sharedWith.length > 0 && entry.sharedWith.some((r) => !r.trim())) {
      problems.push({ category: entry.category, problem: "shared_without_recipient" });
    }
    if (!entry.collected && !entry.processed && entry.sharedWith.length > 0) {
      problems.push({ category: entry.category, problem: "recipient_without_sharing" });
    }
    if (!entry.retention.trim()) {
      problems.push({ category: entry.category, problem: "missing_retention" });
    }
    if (!entry.purpose.trim()) {
      problems.push({ category: entry.category, problem: "missing_purpose" });
    }
    if (!entry.protection.trim()) {
      problems.push({ category: entry.category, problem: "missing_protection" });
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Categories whose Play Console answer needs a human decision before submission. */
export function ownerReviewRequired(
  entries: readonly DataSafetyEntry[] = DATA_SAFETY_INVENTORY,
): DataCategory[] {
  return entries.filter((e) => e.requiresOwnerReview).map((e) => e.category);
}
