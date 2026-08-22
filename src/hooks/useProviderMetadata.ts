import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { resolveYouTubeMetadata } from "@/lib/media-metadata.functions";
import { fallbackMetadata, isValidYouTubeVideoId } from "@/lib/providers/youtube";
import type { ProviderMetadata } from "@/lib/providers/media-provider";

/**
 * Display metadata for the room's current video.
 *
 * Resolved on demand from the provider's official oEmbed endpoint via a server
 * function, held in the in-memory query cache for the session, and never
 * persisted. When resolution fails we return clearly-marked fallback copy
 * instead of presenting unverified text as provider metadata.
 */
export function useProviderMetadata(mediaId: string | null | undefined) {
  const resolve = useServerFn(resolveYouTubeMetadata);
  const enabled = Boolean(mediaId && isValidYouTubeVideoId(mediaId));

  const query = useQuery({
    queryKey: ["provider-metadata", "youtube", mediaId],
    enabled,
    // Session-lifetime cache: one lookup per video per client.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<ProviderMetadata> => {
      const result = await resolve({ data: { media_id: mediaId as string } });
      if (result.status !== "ok") return fallbackMetadata(mediaId as string);
      return {
        title: result.title,
        thumbnailUrl: result.thumbnail_url,
        source: "provider",
      };
    },
  });

  const metadata = mediaId
    ? (query.data ?? (query.isPending ? null : fallbackMetadata(mediaId)))
    : null;

  return { metadata, isPending: enabled && query.isPending };
}
