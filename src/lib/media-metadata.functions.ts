import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Phase 4.1 — provider metadata resolution.
 *
 * Source: YouTube's official public oEmbed endpoint (no API key, no Data API
 * quota). It is fetched server-side so participant browsers do not make an
 * extra third-party request, and so the response can be sanitized before it
 * reaches the UI.
 *
 * What is stored: nothing. Metadata is resolved on demand and cached in the
 * client's in-memory query cache only. `room_playback_state` keeps provider +
 * media id and nothing else, so caller-supplied metadata can never be
 * presented as provider-verified.
 *
 * Failure behaviour: any non-200, malformed body, timeout or network error
 * returns a classified, non-verified result. Callers must render fallback copy
 * rather than claiming provider-verified metadata.
 */

const OEMBED_TIMEOUT_MS = 4000;

export type MetadataOutcome =
  | { status: "ok"; title: string; thumbnail_url: string | null; source: "provider" }
  | { status: "unavailable" | "restricted" | "network" | "unknown"; source: "fallback" };

export const resolveYouTubeMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ media_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }).parse(input),
  )
  .handler(async ({ data }): Promise<MetadataOutcome> => {
    const target = `https://www.youtube.com/watch?v=${data.media_id}`;
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (response.status === 404) return { status: "unavailable", source: "fallback" };
      if (response.status === 401 || response.status === 403) {
        return { status: "restricted", source: "fallback" };
      }
      if (!response.ok) return { status: "unknown", source: "fallback" };

      const body: unknown = await response.json();
      const parsed = z
        .object({
          title: z.string().min(1).max(300),
          thumbnail_url: z.string().url().max(500).optional(),
        })
        .safeParse(body);
      if (!parsed.success) return { status: "unknown", source: "fallback" };

      // Only accept a thumbnail served from YouTube's own image host.
      const thumb = parsed.data.thumbnail_url ?? null;
      const safeThumb =
        thumb && /^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\//.test(thumb) ? thumb : null;

      return {
        status: "ok",
        title: parsed.data.title.slice(0, 200),
        thumbnail_url: safeThumb,
        source: "provider",
      };
    } catch {
      return { status: "network", source: "fallback" };
    } finally {
      clearTimeout(timer);
    }
  });
