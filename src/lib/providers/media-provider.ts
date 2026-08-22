/**
 * Phase 4.1 — minimal media-provider boundary.
 *
 * Deliberately small: one interface, one implementation (YouTube), one lookup.
 * Its only job is to keep provider-specific parsing, validation, embed
 * configuration and error classification out of the sync engine and the UI.
 * It is NOT a plugin system and does not add providers.
 */

export type MediaProviderId = "youtube";

/** Every provider failure the UI can distinguish. Never a raw provider string. */
export type ProviderErrorKind =
  | "invalid_id"
  | "unavailable"
  | "private"
  | "embed_disabled"
  | "region_restricted"
  | "sign_in_required"
  | "player_init_failed"
  | "network"
  | "policy_blocked"
  | "made_for_kids"
  | "origin_not_allowed"
  | "provider_verification_failed"
  | "not_embeddable"
  | "privacy_blocked"
  | "unknown";

export interface ProviderError {
  kind: ProviderErrorKind;
  /** User-facing copy. Provider errors are never surfaced verbatim. */
  message: string;
  /** Short sanitized token for logs/diagnostics. Never a provider payload. */
  diagnostic: string;
}

export interface ProviderMetadata {
  title: string;
  thumbnailUrl: string | null;
  /**
   * Where the values came from. Only "provider" may be presented as coming
   * from the provider; "fallback" means we could not verify anything.
   */
  source: "provider" | "fallback";
}

export interface MediaProvider {
  readonly id: MediaProviderId;
  readonly displayName: string;
  /** Extracts a canonical media id from a pasted reference, or null. */
  parseReference(input: string): string | null;
  /** Canonical media-id shape check, mirrored server-side and in SQL. */
  isValidMediaId(id: string): boolean;
  /** Player host used for embedding. */
  readonly embedHost: string;
  /** Maps a provider player error code to a stable app-level error. */
  classifyPlayerError(code: unknown): ProviderError;
}

const messages: Record<ProviderErrorKind, string> = {
  invalid_id: "That doesn't look like a valid YouTube video link.",
  unavailable: "This video is unavailable.",
  private: "This video is private.",
  embed_disabled: "The owner doesn't allow this video to be played outside YouTube.",
  region_restricted: "This video isn't available in this region.",
  sign_in_required: "YouTube requires sign-in to play this video.",
  player_init_failed: "Unable to load the YouTube player.",
  network: "Connection problem while loading the video.",
  policy_blocked: "This video can't be played in this room.",
  made_for_kids:
    "This video is marked Made for Kids. Playback works normally, but usage analytics are turned off.",
  origin_not_allowed: "YouTube isn't allowing playback from this site right now.",
  provider_verification_failed:
    "We couldn't verify this video with YouTube. Please try again in a moment.",
  not_embeddable: "The owner doesn't allow this video to be played outside YouTube.",
  privacy_blocked: "This video is private.",
  unknown: "This video can't be played here.",
};

export function providerError(kind: ProviderErrorKind, diagnostic: string): ProviderError {
  return { kind, message: messages[kind], diagnostic };
}

/** True when the failure is the provider's, not our synchronization engine's. */
export function isProviderError(value: unknown): value is ProviderError {
  return Boolean(value && typeof value === "object" && "kind" in value && "message" in value);
}
