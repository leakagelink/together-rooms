import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Server-side YouTube search.
 *
 * The Data API key is read inside the handler and never reaches the browser.
 * Only embeddable, safe-search-strict video results are returned, and the
 * payload is reduced to the minimum needed to render a result row.
 */

const SEARCH_TIMEOUT_MS = 5000;
const MAX_RESULTS = 12;

const searchSchema = z.object({
  query: z.string().trim().min(2).max(120),
});

export interface MediaSearchResult {
  media_id: string;
  title: string;
  channel: string;
  thumbnail_url: string | null;
  published_at: string | null;
}

export type MediaSearchOutcome =
  | { status: "ok"; results: MediaSearchResult[] }
  | { status: "unavailable" | "quota" | "error"; results: [] };

export const searchYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => searchSchema.parse(input))
  .handler(async ({ data }): Promise<MediaSearchOutcome> => {
    const key = process.env["YOUTUBE_DATA_API_KEY"];
    if (!key) return { status: "unavailable", results: [] };

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("safeSearch", "strict");
    url.searchParams.set("maxResults", String(MAX_RESULTS));
    url.searchParams.set("q", data.query);
    url.searchParams.set("key", key);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        return { status: response.status === 403 ? "quota" : "error", results: [] };
      }
      const body: unknown = await response.json();
      const parsed = z
        .object({
          items: z
            .array(
              z.object({
                id: z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }),
                snippet: z.object({
                  title: z.string(),
                  channelTitle: z.string().optional(),
                  publishedAt: z.string().optional(),
                  thumbnails: z
                    .object({
                      medium: z.object({ url: z.string().url() }).optional(),
                      default: z.object({ url: z.string().url() }).optional(),
                    })
                    .optional(),
                }),
              }),
            )
            .default([]),
        })
        .safeParse(body);

      if (!parsed.success) return { status: "error", results: [] };

      return {
        status: "ok",
        results: parsed.data.items.map((item) => ({
          media_id: item.id.videoId,
          title: item.snippet.title.slice(0, 200),
          channel: (item.snippet.channelTitle ?? "").slice(0, 120),
          thumbnail_url:
            item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? null,
          published_at: item.snippet.publishedAt ?? null,
        })),
      };
    } catch {
      return { status: "error", results: [] };
    } finally {
      clearTimeout(timer);
    }
  });

/**
 * Shorts picker source.
 *
 * Uses the same official YouTube Data API search as the video picker, with
 * `videoDuration=short` so results are Shorts-length clips. There is NO
 * scraping and no crawling of YouTube's own Shorts feed: results come from the
 * documented search endpoint, remain embeddable + safeSearch strict, and every
 * pick still goes through the authoritative playback RPC which re-validates
 * the id, embeddability and Made-for-Kids status.
 */
const shortsSearchSchema = z.object({
  query: z.string().trim().max(120).optional(),
});

export const searchYouTubeShorts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shortsSearchSchema.parse(input ?? {}))
  .handler(async ({ data }): Promise<MediaSearchOutcome> => {
    const key = process.env["YOUTUBE_DATA_API_KEY"];
    if (!key) return { status: "unavailable", results: [] };

    const term = (data.query ?? "").trim();
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("videoDuration", "short");
    url.searchParams.set("safeSearch", "strict");
    url.searchParams.set("maxResults", String(MAX_RESULTS));
    url.searchParams.set("q", term.length >= 2 ? term : "shorts");
    if (term.length < 2) url.searchParams.set("order", "viewCount");
    url.searchParams.set("key", key);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        return { status: response.status === 403 ? "quota" : "error", results: [] };
      }
      const body: unknown = await response.json();
      const parsed = z
        .object({
          items: z
            .array(
              z.object({
                id: z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }),
                snippet: z.object({
                  title: z.string(),
                  channelTitle: z.string().optional(),
                  publishedAt: z.string().optional(),
                  thumbnails: z
                    .object({
                      medium: z.object({ url: z.string().url() }).optional(),
                      default: z.object({ url: z.string().url() }).optional(),
                    })
                    .optional(),
                }),
              }),
            )
            .default([]),
        })
        .safeParse(body);
      if (!parsed.success) return { status: "error", results: [] };
      return {
        status: "ok",
        results: parsed.data.items.map((item) => ({
          media_id: item.id.videoId,
          title: item.snippet.title.slice(0, 200),
          channel: (item.snippet.channelTitle ?? "").slice(0, 120),
          thumbnail_url:
            item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? null,
          published_at: item.snippet.publishedAt ?? null,
        })),
      };
    } catch {
      return { status: "error", results: [] };
    } finally {
      clearTimeout(timer);
    }
  });
