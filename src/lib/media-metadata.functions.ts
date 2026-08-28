import { createServerFn } from "@tanstack/react-start";
import { type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canAuthorizeEmbed,
  evaluateYouTubePolicy,
  policyFromJsonb,
  providerVerificationFailedPolicy,
  type MediaPolicy,
  type MediaPolicyStatus,
} from "@/lib/media-policy";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 4.2 — server-side YouTube metadata + policy resolution.
 *
 * Trust boundary:
 *  - POLICY-CRITICAL data (made_for_kids, embeddable, privacy/playability) may
 *    ONLY come from a fresh trusted cache row or from the official YouTube Data
 *    API. If neither is available the lookup FAILS CLOSED with
 *    `provider_verification_failed` and no new embed is authorized.
 *  - DISPLAY data (title, thumbnail) may fall back to the public oEmbed
 *    endpoint, but only after a policy decision has already authorized the
 *    video. oEmbed is never used to determine Made for Kids status.
 *
 * The YouTube Data API key is read server-side only; it never reaches the
 * browser. Results are cached in `media_metadata_cache` with a 24-hour TTL to
 * respect API quota and data-minimization principles.
 */

const DATA_API_TIMEOUT_MS = 4000;
const OEMBED_TIMEOUT_MS = 4000;

const dataApiKey = () => process.env["YOUTUBE_DATA_API_KEY"] ?? null;

const mediaIdSchema = z.object({ media_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/) });

export interface PolicyOutcome {
  ok: boolean;
  policy: MediaPolicy;
}

export type MetadataOutcome =
  | {
      status: "ok" | "made_for_kids";
      title: string;
      thumbnail_url: string | null;
      source: "provider" | "fallback";
      policy: MediaPolicy;
    }
  | {
      status: Exclude<MediaPolicyStatus, "ok" | "made_for_kids">;
      source: "fallback";
      policy: MediaPolicy;
    };

type DbClient = SupabaseClient<Database>;

async function fetchDataApiPolicy(mediaId: string): Promise<MediaPolicy | null> {
  const key = dataApiKey();
  if (!key) return null;

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("id", mediaId);
  url.searchParams.set("part", "snippet,status,contentDetails");
  url.searchParams.set("key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_API_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const record = body as Record<string, unknown>;
    if (!Array.isArray(record["items"])) return null;
    const items = record["items"] as unknown[];
    return evaluateYouTubePolicy(mediaId, items[0] ?? null).policy;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Display-only fallback. Never consulted for a policy decision — by the time
 * this runs the video has already been authorized by the Data API or cache.
 */
async function fetchOembedTitle(mediaId: string): Promise<string | null> {
  const target = `https://www.youtube.com/watch?v=${mediaId}`;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = z.object({ title: z.string().min(1).max(300) }).safeParse(body);
    return parsed.success ? parsed.data.title.slice(0, 200) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookupPolicyFromCache(
  supabase: DbClient,
  mediaId: string,
  now: number,
): Promise<MediaPolicy | null> {
  const { data: cacheRows } = await supabase
    .from("media_metadata_cache")
    .select("*")
    .eq("provider", "youtube")
    .eq("media_id", mediaId)
    .limit(1);

  const row = cacheRows?.[0];
  if (!row) return null;

  // The authoritative expiration is expires_at. An expired row can never
  // authorize a new embed, so it is treated as a cache miss.
  const expiresAt = Date.parse(row.expires_at as string);
  if (Number.isNaN(expiresAt) || now >= expiresAt) return null;

  const cached = policyFromJsonb(row);
  if (cached) {
    cached.checked_at = (row.recorded_at as string) ?? cached.checked_at;
    // Remaining TTL, derived from the row rather than the payload.
    cached.ttl_seconds = Math.max(
      1,
      Math.floor((expiresAt - Date.parse(cached.checked_at)) / 1000),
    );
  }
  return cached;
}

async function persistPolicy(policy: MediaPolicy): Promise<void> {
  // Cache writes are privileged: only the server-side resolver can populate the
  // policy table. End users cannot execute upsert_media_metadata_cache.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.rpc("upsert_media_metadata_cache", {
    _provider: "youtube",
    _media_id: policy.media_id,
    _title: policy.title ?? undefined,
    _thumbnail_url: policy.thumbnail_url ?? undefined,
    _made_for_kids: policy.made_for_kids,
    _embeddable: policy.embeddable,
    _privacy_status: policy.privacy_status,
    _status: policy.status,
    _source: "data_api",
    _ttl_hours: Math.max(1, Math.floor(policy.ttl_seconds / 3600)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

/**
 * Authoritative policy resolution.
 *
 * A. fresh trusted cache → use it
 * B. otherwise call the official Data API
 * C. Data API answered → persist to the trusted cache and use it
 * D. Data API failed and no valid cache → provider_verification_failed
 */
export async function resolveMediaPolicy(
  supabase: DbClient,
  mediaId: string,
): Promise<PolicyOutcome> {
  const now = Date.now();
  const cached = await lookupPolicyFromCache(supabase, mediaId, now);
  if (cached) {
    return { ok: canAuthorizeEmbed(cached, now), policy: cached };
  }

  const fresh = await fetchDataApiPolicy(mediaId);
  if (!fresh) {
    // FAIL CLOSED. No oEmbed substitution, no permissive placeholder, and
    // nothing is written to the trusted cache.
    const policy = providerVerificationFailedPolicy(mediaId);
    return { ok: false, policy };
  }

  await persistPolicy(fresh);
  return { ok: canAuthorizeEmbed(fresh, Date.now()), policy: fresh };
}

/**
 * Resolves the policy for a YouTube video, preferring the trusted cache and
 * falling back to the official Data API. Cache misses are persisted.
 */
export const getYouTubeMediaPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => mediaIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<PolicyOutcome> => {
    return resolveMediaPolicy(context.supabase, data.media_id);
  });

/**
 * Resolves display metadata for a YouTube video. The policy check always runs
 * first; if the video is not playable, no display metadata is returned. For a
 * playable video the Data API title/thumbnail are preferred, with oEmbed as a
 * display-only fallback for the title.
 */
export const resolveYouTubeMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => mediaIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<MetadataOutcome> => {
    const { policy } = await resolveMediaPolicy(context.supabase, data.media_id);

    if (!policy.playable) {
      return {
        status: policy.status as Exclude<MediaPolicyStatus, "ok" | "made_for_kids">,
        source: "fallback",
        policy,
      };
    }

    let title = policy.title;
    let source: "provider" | "fallback" = title ? "provider" : "fallback";
    if (!title) {
      title = await fetchOembedTitle(data.media_id);
      source = "fallback";
    }

    return {
      status: policy.status as "ok" | "made_for_kids",
      title: title ?? `YouTube video ${data.media_id}`,
      thumbnail_url: policy.thumbnail_url,
      source,
      policy,
    };
  });
