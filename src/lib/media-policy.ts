/**
 * Phase 4.2 — YouTube Data API policy decisions.
 *
 * Pure functions that translate a YouTube Data API `videos().list` response
 * into a provider-agnostic policy record. No secrets, no network I/O, no
 * provider-specific leakage outside this module.
 *
 * Policy states are deliberately distinct — "Made for Kids" is NOT the same as
 * "unavailable", "not embeddable" or "malformed". An otherwise playable MFK
 * video stays playable; it only carries a tracking restriction.
 */

export type MediaPrivacyStatus = "public" | "unlisted" | "private" | "unknown";

/**
 * A. `provider_verification_failed` — policy lookup failed (fail closed)
 * B. `made_for_kids`               — MFK video (playable, tracking restricted)
 * C. `unavailable` / `privacy_blocked` — missing, deleted or private video
 * D. `not_embeddable`              — owner disallows embedding
 * E. `invalid`                     — malformed media id / malformed response
 */
export type MediaPolicyStatus =
  | "ok"
  | "made_for_kids"
  | "age_restricted"
  | "not_embeddable"
  | "privacy_blocked"
  | "unavailable"
  | "provider_verification_failed"
  | "invalid";

export interface MediaPolicy {
  provider: "youtube";
  media_id: string;
  status: MediaPolicyStatus;
  /** True when the video may be embedded and synchronized in a room. */
  playable: boolean;
  /** True when SyncTogether must suppress playback analytics for this video. */
  tracking_restricted: boolean;
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
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Statuses that permit embedding. MFK is playable; everything else is not. */
export const PLAYABLE_STATUSES: readonly MediaPolicyStatus[] = ["ok", "made_for_kids"];

export function isPlayableStatus(status: MediaPolicyStatus): boolean {
  return PLAYABLE_STATUSES.includes(status);
}

/** Canonical Data API thumbnail URL for a given video id. */
export function canonicalYouTubeThumbnailUrl(videoId: string): string | null {
  if (!MEDIA_ID_PATTERN.test(videoId)) return null;
  return `${YOUTUBE_API_THUMBNAIL_HOST}${videoId}/hqdefault.jpg`;
}

const YOUTUBE_THUMBNAIL_NAMES = [
  "default",
  "mqdefault",
  "hqdefault",
  "sddefault",
  "maxresdefault",
  "0",
  "1",
  "2",
  "3",
];

/** A valid thumbnail URL must be a canonical YouTube image path. */
export function isSafeThumbnailUrl(url: string): boolean {
  const prefix = YOUTUBE_API_THUMBNAIL_HOST;
  if (!url.startsWith(prefix)) return false;
  const path = url.slice(prefix.length);
  const namePattern = YOUTUBE_THUMBNAIL_NAMES.join("|");
  return new RegExp(`^[A-Za-z0-9_-]{11}/(${namePattern})\\.jpg$`).test(path);
}

function basePolicy(videoId: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
  return {
    provider: "youtube" as const,
    media_id: videoId,
    title: null as string | null,
    thumbnail_url: null as string | null,
    ttl_seconds: ttlSeconds,
    checked_at: new Date().toISOString(),
  };
}

function blockedPolicy(
  videoId: string,
  status: MediaPolicyStatus,
  ttlSeconds?: number,
): MediaPolicyOutcome {
  return {
    ok: false,
    policy: {
      ...basePolicy(videoId, ttlSeconds),
      status,
      playable: false,
      tracking_restricted: false,
      made_for_kids: false,
      embeddable: false,
      privacy_status: "unknown",
    },
  };
}

/**
 * Fail-closed policy used when the YouTube Data API cannot be reached and no
 * valid trusted cache entry exists. It is never playable and is never treated
 * as an authorization to embed.
 */
export function providerVerificationFailedPolicy(videoId: string): MediaPolicy {
  return blockedPolicy(videoId, "provider_verification_failed", 0).policy;
}

/** Malformed media id — distinct from "unavailable". */
export function invalidMediaPolicy(videoId: string): MediaPolicy {
  return blockedPolicy(videoId, "invalid", 0).policy;
}

/**
 * Derive a policy from a YouTube Data API response item.
 *
 * The input is a single `video` resource from `videos().list` with
 * `part=snippet,status`. If the item is missing (video not found), the policy
 * is `unavailable`. If the item exists but is structurally malformed, the
 * policy is `invalid`.
 */
export function evaluateYouTubePolicy(videoId: string, item: unknown): MediaPolicyOutcome {
  if (!MEDIA_ID_PATTERN.test(videoId)) {
    return { ok: false, policy: invalidMediaPolicy(videoId) };
  }

  // No item at all: the video does not exist / is not visible.
  if (item === null || item === undefined) {
    return blockedPolicy(videoId, "unavailable");
  }
  // Item present but not an object: malformed provider payload.
  if (typeof item !== "object") {
    return blockedPolicy(videoId, "invalid", 0);
  }

  const resource = item as Record<string, unknown>;
  const status = resource["status"] as Record<string, unknown> | undefined;
  if (!status || typeof status !== "object") {
    // A video resource without a status part cannot be policy-evaluated.
    return blockedPolicy(videoId, "unavailable");
  }

  const snippet = (resource["snippet"] as Record<string, unknown> | undefined) ?? {};
  const thumbnails =
    (snippet["thumbnails"] as Record<string, Record<string, string>> | undefined) ?? {};

  const madeForKids = Boolean(status["madeForKids"]);
  const embeddable = Boolean(status["embeddable"]);
  const privacyStatus = String(
    status["privacyStatus"] ?? "unknown",
  ).toLowerCase() as MediaPrivacyStatus;
  const title = typeof snippet["title"] === "string" ? snippet["title"].slice(0, 200) : null;

  let thumbnailUrl: string | null = null;
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const thumb = thumbnails[key];
    const thumbUrl = thumb?.["url"];
    if (typeof thumbUrl === "string") {
      thumbnailUrl = isSafeThumbnailUrl(thumbUrl) ? thumbUrl : null;
      break;
    }
  }
  thumbnailUrl ??= canonicalYouTubeThumbnailUrl(videoId);

  // Order matters: hard blocks first, then the MFK classification. MFK alone
  // never downgrades an otherwise playable video.
  let policyStatus: MediaPolicyStatus;
  if (!embeddable) {
    policyStatus = "not_embeddable";
  } else if (privacyStatus === "private") {
    policyStatus = "privacy_blocked";
  } else if (privacyStatus !== "public" && privacyStatus !== "unlisted") {
    policyStatus = "unavailable";
  } else if (madeForKids) {
    policyStatus = "made_for_kids";
  } else {
    policyStatus = "ok";
  }

  const playable = isPlayableStatus(policyStatus);

  return {
    ok: playable,
    policy: {
      ...basePolicy(videoId),
      status: policyStatus,
      playable,
      tracking_restricted: madeForKids,
      made_for_kids: madeForKids,
      embeddable,
      privacy_status: privacyStatus,
      title: playable ? title : null,
      thumbnail_url: playable ? thumbnailUrl : null,
    },
  };
}

/** Convert a policy outcome to a storable JSONB shape. */
export function policyToJsonb(policy: MediaPolicy): Record<string, unknown> {
  return {
    provider: policy.provider,
    media_id: policy.media_id,
    status: policy.status,
    playable: policy.playable,
    tracking_restricted: policy.tracking_restricted,
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

  const mediaId = r["media_id"];
  let thumbnailUrl: string | null =
    r["thumbnail_url"] === null || r["thumbnail_url"] === undefined
      ? null
      : String(r["thumbnail_url"]);
  if (thumbnailUrl && !isSafeThumbnailUrl(thumbnailUrl)) {
    thumbnailUrl = canonicalYouTubeThumbnailUrl(mediaId);
  }

  const status = String(r["status"] ?? "unknown") as MediaPolicyStatus;
  const madeForKids = Boolean(r["made_for_kids"]);
  const embeddable = Boolean(r["embeddable"]);
  const privacyStatus = String(r["privacy_status"] ?? "unknown") as MediaPrivacyStatus;

  // The stored status is authoritative, but playability is always re-derived
  // so a poisoned or partial row cannot claim to be playable.
  const playable = isPlayableStatus(status) && embeddable && privacyStatus !== "private";

  return {
    provider: "youtube",
    media_id: mediaId,
    status,
    playable,
    tracking_restricted: madeForKids,
    made_for_kids: madeForKids,
    embeddable,
    privacy_status: privacyStatus,
    title: r["title"] === null || r["title"] === undefined ? null : String(r["title"]),
    thumbnail_url: thumbnailUrl,
    ttl_seconds: Number(r["ttl_seconds"] ?? DEFAULT_TTL_SECONDS),
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
  if (policy.ttl_seconds <= 0) return false;
  return nowMs - checked < policy.ttl_seconds * 1000;
}

/**
 * Whether a policy may authorize a *new* embed. Requires a playable status and
 * a fresh, provider-verified result. Expired policies never authorize.
 */
export function canAuthorizeEmbed(policy: MediaPolicy | null, nowMs: number = Date.now()): boolean {
  if (!policy) return false;
  return policy.playable && isPolicyFresh(policy, nowMs);
}
