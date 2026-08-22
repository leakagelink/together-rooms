/**
 * Phase 4.2 — YouTube Data API policy decisions.
 *
 * Pure functions that translate a YouTube Data API `videos().list` response
 * into a provider-agnostic policy record. No secrets, no network I/O, no
 * provider-specific leakage outside this module.
 */

export type MediaPrivacyStatus = "public" | "unlisted" | "private" | "unknown";

export type MediaPolicyStatus = "ok" | "unavailable" | "made_for_kids" | "not_embeddable" | "privacy_blocked" | "network" | "invalid";

export interface MediaPolicy {
  provider: "youtube";
  media_id: string;
  status: MediaPolicyStatus;
  made_for_kids: boolean;
  embeddable: boolean;
  privacy_status: MediaPrivacyStatus;
  title: string | null;
  thumbnail_url: string | null;
  /** TTL in seconds. */
  ttl_seconds: number;
  /** Timestamp when the policy was computed. */
  checked_at: string;
}

export interface MediaPolicyOutcome {
  ok: boolean;
  policy: MediaPolicy;
}

const YOUTUBE_API_THUMBNAIL_HOST = "https://i.ytimg.com/vi/";

/** Canonical Data API thumbnail URL for a given video id. */
export function canonicalYouTubeThumbnailUrl(videoId: string): string | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return `${YOUTUBE_API_THUMBNAIL_HOST}${videoId}/hqdefault.jpg`;
}

/** A valid thumbnail URL must be served from YouTube's own image host. */
export function isSafeThumbnailUrl(url: string): boolean {
  return url.startsWith(YOUTUBE_API_THUMBNAIL_HOST) && /^[A-Za-z0-9_/-.]+$/.test(url.slice(YOUTUBE_API_THUMBNAIL_HOST.length));
}

/**
 * Derive a policy from a YouTube Data API response item.
 *
 * The input is a single `video` resource from `videos().list` with `part=snippet,status`.
 * If the item is missing (video not found), the policy is `unavailable`.
 */
export function evaluateYouTubePolicy(
  videoId: string,
  item: unknown,
): MediaPolicyOutcome {
  const now = new Date().toISOString();
  const base = {
    provider: "youtube" as const,
    media_id: videoId,
    title: null as string | null,
    thumbnail_url: null as string | null,
    ttl_seconds: 24 * 60 * 60,
    checked_at: now,
  };

  if (!item || typeof item !== "object") {
    return {
      ok: false,
      policy: {
        ...base,
        status: "unavailable",
        made_for_kids: false,
        embeddable: false,
        privacy_status: "unknown",
      },
    };
  }

  const resource = item as Record<string, unknown>;

  const status = (resource["status"] as Record<string, unknown> | undefined) ?? {};
  const snippet = (resource["snippet"] as Record<string, unknown> | undefined) ?? {};
  const thumbnails = (snippet["thumbnails"] as Record<string, Record<string, string>> | undefined) ?? {};

  const madeForKids = Boolean(status["madeForKids"]);
  const embeddable = Boolean(status["embeddable"]);
  const privacyStatus = String(status["privacyStatus"] ?? "unknown").toLowerCase() as MediaPrivacyStatus;
  const title = typeof snippet["title"] === "string" ? snippet["title"].slice(0, 200) : null;

  let thumbnailUrl: string | null = null;
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const thumb = thumbnails[key];
    if (thumb?.url) {
      thumbnailUrl = isSafeThumbnailUrl(thumb.url) ? thumb.url : null;
      break;
    }
  }
  if (!thumbnailUrl) {
    thumbnailUrl = canonicalYouTubeThumbnailUrl(videoId);
  }

  let policyStatus: MediaPolicyStatus;
  if (madeForKids) {
    policyStatus = "made_for_kids";
  } else if (!embeddable) {
    policyStatus = "not_embeddable";
  } else if (privacyStatus === "private") {
    policyStatus = "privacy_blocked";
  } else if (privacyStatus !== "public" && privacyStatus !== "unlisted") {
    policyStatus = "unavailable";
  } else {
    policyStatus = "ok";
  }

  return {
    ok: policyStatus === "ok",
    policy: {
      ...base,
      status: policyStatus,
      made_for_kids: madeForKids,
      embeddable: embeddable,
      privacy_status: privacyStatus,
      title,
      thumbnail_url: thumbnailUrl,
    },
  };
}

/** Convert a policy outcome to a storable JSONB shape. */
export function policyToJsonb(policy: MediaPolicy): Record<string, unknown> {
  return {
    provider: policy.provider,
    media_id: policy.media_id,
    status: policy.status,
    made_for_kids: policy.made_for_kids,
    embeddable: policy.embeddable,
    privacy_status: policy.privacy_status,
    title: policy.title,
    thumbnail_url: policy.thumbnail_url,
    ttl_seconds: policy.ttl_seconds,
    checked_at: policy.checked_at,
  };
}

/** Parse a policy from a JSONB record. */
export function policyFromJsonb(value: unknown): MediaPolicy | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r["provider"] !== "youtube" || typeof r["media_id"] !== "string") return null;
  return {
    provider: "youtube",
    media_id: r["media_id"],
    status: String(r["status"] ?? "unknown") as MediaPolicyStatus,
    made_for_kids: Boolean(r["made_for_kids"]),
    embeddable: Boolean(r["embeddable"]),
    privacy_status: String(r["privacy_status"] ?? "unknown") as MediaPrivacyStatus,
    title: r["title"] === null ? null : String(r["title"]),
    thumbnail_url: r["thumbnail_url"] === null ? null : String(r["thumbnail_url"]),
    ttl_seconds: Number(r["ttl_seconds"] ?? 24 * 60 * 60),
    checked_at: String(r["checked_at"] ?? new Date().toISOString()),
  };
}

/**
 * Whether a policy is still usable, given a TTL and a reference time.
 * The default TTL is 24 hours; policies are considered expired once the TTL
 * has passed to respect YouTube Data API quota and data minimization.
 */
export function isPolicyFresh(policy: MediaPolicy, nowMs: number = Date.now()): boolean {
  const checked = Date.parse(policy.checked_at);
  if (Number.isNaN(checked)) return false;
  return nowMs - checked < policy.ttl_seconds * 1000;
}
