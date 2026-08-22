import { createServerFn } from "@tanstack/react-start";
import { type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { evaluateYouTubePolicy, isPolicyFresh, policyFromJsonb, policyToJsonb, type MediaPolicy } from "@/lib/media-policy";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 4.2 — server-side YouTube metadata + policy resolution.
 *
 * The YouTube Data API key is read server-side only; it never reaches the
 * browser. The Data API is used for policy-critical fields (Made for Kids,
 * embeddability, privacy status, existence). The public oEmbed endpoint is used
 * as a fallback for the title when the Data API is unavailable. Results are
 * cached in `media_metadata_cache` with a 24-hour TTL to respect API quota and
 * data-minimization principles.
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
  | { status: "ok"; title: string; thumbnail_url: string | null; source: "provider"; policy: MediaPolicy }
  | { status: "made_for_kids" | "not_embeddable" | "privacy_blocked" | "unavailable" | "network" | "unknown"; source: "fallback"; policy?: MediaPolicy };

type SupabaseAdmin = Awaited<ReturnType<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"]>;

async function fetchDataApiPolicy(mediaId: string): Promise<MediaPolicy | null> {
  const key = dataApiKey();
  if (!key) return null;

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("id", mediaId);
  url.searchParams.set("part", "snippet,status");
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
    const items = Array.isArray((body as Record<string, unknown>)?.items) ? (body as Record<string, unknown[]>).items : [];
    return evaluateYouTubePolicy(mediaId, items[0] ?? null).policy;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
    const parsed = z
      .object({ title: z.string().min(1).max(300) })
      .safeParse(body);
    return parsed.success ? parsed.data.title.slice(0, 200) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookupPolicyFromCache(supabase: SupabaseAdmin, mediaId: string, now: number): Promise<MediaPolicy | null> {
  const { data: cacheRows } = await supabase
    .from("media_metadata_cache")
    .select("*")
    .eq("provider", "youtube")
    .eq("media_id", mediaId)
    .limit(1);

  const cached = cacheRows?.[0] ? policyFromJsonb(cacheRows[0]) : null;
  if (cached && isPolicyFresh(cached, now)) return cached;
  return null;
}

async function resolvePolicyFromApi(mediaId: string): Promise<MediaPolicy> {
  let policy = await fetchDataApiPolicy(mediaId);
  if (!policy) {
    // If the Data API is missing/unavailable, fall back to a permissive
    // placeholder that relies on the IFrame player to refuse bad content.
    policy = {
      provider: "youtube",
      media_id: mediaId,
      status: "ok",
      made_for_kids: false,
      embeddable: true,
      privacy_status: "unknown",
      title: null,
      thumbnail_url: null,
      ttl_seconds: 60 * 60, // short TTL when we couldn't verify
      checked_at: new Date().toISOString(),
    };
  }
  return policy;
}

async function persistPolicy(supabase: SupabaseAdmin, policy: MediaPolicy): Promise<void> {
  await supabase.rpc("upsert_media_metadata_cache", {
    _provider: "youtube",
    _media_id: policy.media_id,
    _title: policy.title,
    _thumbnail_url: policy.thumbnail_url,
    _made_for_kids: policy.made_for_kids,
    _embeddable: policy.embeddable,
    _privacy_status: policy.privacy_status,
    _status: policy.status,
    _source: "data_api",
    _ttl_hours: Math.floor(policy.ttl_seconds / 3600),
  });
}

export async function resolveMediaPolicy(supabase: SupabaseAdmin, mediaId: string): Promise<PolicyOutcome> {
  const now = Date.now();
  const cached = await lookupPolicyFromCache(supabase, mediaId, now);
  if (cached) {
    return { ok: cached.status === "ok", policy: cached };
  }
  const policy = await resolvePolicyFromApi(mediaId);
  await persistPolicy(supabase, policy);
  return { ok: policy.status === "ok", policy };
}

/**
 * Resolves the policy for a YouTube video, preferring the cache and falling
 * back to the Data API. Cache misses are persisted for 24 hours.
 */
export const getYouTubeMediaPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => mediaIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<PolicyOutcome> => {
    return resolveMediaPolicy(context.supabase, data.media_id);
  });

/**
 * Resolves display metadata for a YouTube video. The policy check is always
 * performed first; if the video is blocked by policy, no metadata is returned.
 * Otherwise, the Data API title/thumbnail are preferred, with oEmbed as a
 * fallback for the title when the Data API title is unavailable.
 */
export const resolveYouTubeMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => mediaIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<MetadataOutcome> => {
    const { policy } = await resolveMediaPolicy(context.supabase, data.media_id);

    if (policy.status !== "ok") {
      return {
        status: policy.status,
        source: "fallback",
        policy,
      };
    }

    let title = policy.title;
    if (!title) {
      title = await fetchOembedTitle(data.media_id);
    }

    return {
      status: "ok",
      title: title ?? `YouTube video ${data.media_id}`,
      thumbnail_url: policy.thumbnail_url,
      source: title && policy.title ? "provider" : "fallback",
      policy,
    };
  });
