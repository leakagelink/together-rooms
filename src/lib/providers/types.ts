/**
 * Provider abstraction layer (Phase 1: interfaces only, no integrations).
 *
 * Every future third-party capability must be reached through one of these
 * interfaces so the core app never couples to a single vendor.
 *
 * POLICY: implementations MUST use official, authorized APIs / SDKs / embedded
 * players. Implementations that scrape protected media, bypass DRM, bypass
 * provider restrictions, or re-stream copyrighted content are forbidden.
 */

export type ProviderId =
  "youtube" | "search" | "ai" | "voice" | "music" | "analytics" | "payments" | "ads";

export interface ProviderCapabilities {
  /** True only when the provider is contractually allowed for this use. */
  authorized: boolean;
  /** Requires an explicit user permission prompt before first use. */
  requiresUserPermission: boolean;
}

export interface BaseProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  isConfigured(): boolean;
}

export interface ContentItem {
  externalId: string;
  provider: ProviderId;
  title: string;
  /** Canonical, provider-hosted URL. Never a proxied or re-hosted media URL. */
  url: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

/** Resolves references to content hosted by an authorized third party. */
export interface ContentProvider extends BaseProvider {
  resolve(reference: string): Promise<ContentItem | null>;
}

/** Wraps an official embedded player. Never handles raw media bytes. */
export interface PlaybackProvider extends BaseProvider {
  canPlay(item: ContentItem): boolean;
}

export interface SearchProvider extends BaseProvider {
  search(query: string, limit?: number): Promise<ContentItem[]>;
}

export interface MusicProvider extends ContentProvider {}

export interface AIProvider extends BaseProvider {
  complete(prompt: string, options?: { signal?: AbortSignal }): Promise<string>;
}

export interface VoiceProvider extends BaseProvider {
  /** Lightweight signalling only: media never transits the core API. */
  createSessionToken(roomId: string): Promise<string>;
}

export interface PaymentsProvider extends BaseProvider {
  listPlans(): Promise<Array<{ id: string; tier: "free" | "pro" | "pro_plus" }>>;
}

export interface AdsProvider extends BaseProvider {
  /** Placement slots must never overlap playback or room controls. */
  isPlacementAllowed(slot: AdSlot): boolean;
}

/** Slots deliberately exclude playback, join/leave and chat controls. */
export type AdSlot = "home_feed" | "settings_footer" | "room_list_footer";
