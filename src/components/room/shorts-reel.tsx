import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Link2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { searchYouTubeShorts, type MediaSearchResult } from "@/lib/media-search.functions";
import { parseShortsReference } from "@/lib/shorts";

/**
 * Shorts Together — picker + reel navigation.
 *
 * Policy notes:
 *  - Results come from the official YouTube Data API search (server-side key),
 *    never from scraping YouTube's own Shorts feed.
 *  - Swiping only changes which Short the room loads through the existing
 *    authoritative `set_room_media` RPC. Nothing is downloaded, proxied or
 *    rehosted, and playback still starts on a user action.
 *  - The list is a plain picker; there are no rewards, watch-time counters or
 *    view-inflating loops.
 */

export interface ShortsReelState {
  items: MediaSearchResult[];
  loading: boolean;
  index: number;
  goNext: () => void;
  goPrevious: () => void;
}

export function useShortsReel(
  enabled: boolean,
  currentMediaId: string | null,
  onPick: (mediaId: string) => void,
) {
  const search = useServerFn(searchYouTubeShorts);
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");

  const results = useQuery({
    queryKey: ["shorts-reel", query],
    queryFn: async () => search({ data: { query: query || undefined } }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const items = useMemo(
    () => (results.data?.status === "ok" ? results.data.results : []),
    [results.data],
  );
  const index = currentMediaId ? items.findIndex((item) => item.media_id === currentMediaId) : -1;

  const step = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const next = index < 0 ? 0 : (index + delta + items.length) % items.length;
      const target = items[next];
      if (target && target.media_id !== currentMediaId) onPick(target.media_id);
    },
    [items, index, currentMediaId, onPick],
  );

  return {
    term,
    setTerm,
    submit: (value: string) => setQuery(value.trim()),
    items,
    loading: results.isPending || results.isFetching,
    unavailable: results.data?.status && results.data.status !== "ok",
    index,
    goNext: () => step(1),
    goPrevious: () => step(-1),
    onPick,
  };
}

export type ShortsReel = ReturnType<typeof useShortsReel>;

export function ShortsReelPanel({
  reel,
  disabled,
  personal = false,
}: {
  reel: ShortsReel;
  disabled: boolean;
  /** Member without playback control: picks play on this device only. */
  personal?: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");

  return (
    <div className="mt-3 space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          reel.submit(reel.term);
        }}
      >
        <label htmlFor="shorts-search" className="sr-only">
          Search Shorts
        </label>
        <Input
          id="shorts-search"
          value={reel.term}
          onChange={(event) => reel.setTerm(event.target.value)}
          placeholder="Search Shorts…"
          enterKeyHint="search"
          autoComplete="off"
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={disabled || reel.loading}>
          {reel.loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )}
          Search
        </Button>
      </form>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || reel.items.length === 0}
          onClick={reel.goPrevious}
        >
          <ChevronUp className="size-4" aria-hidden="true" /> Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || reel.items.length === 0}
          onClick={reel.goNext}
        >
          <ChevronDown className="size-4" aria-hidden="true" /> Next Short
        </Button>
        <span className="text-xs text-muted-foreground">
          {reel.items.length > 0
            ? `${personal ? "Swipe for yourself" : "Swipe up or down"} on the side rail · ${Math.max(reel.index, 0) + 1}/${reel.items.length}`
            : "No Shorts loaded yet"}

        </span>
      </div>

      {reel.loading ? (
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="aspect-[9/16] w-20 shrink-0 rounded-md" />
          ))}
        </div>
      ) : null}

      {!reel.loading && reel.items.length > 0 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Shorts">
          {reel.items.map((item, position) => (
            <li key={item.media_id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => reel.onPick(item.media_id)}
                aria-current={position === reel.index}
                className={`block w-20 shrink-0 overflow-hidden rounded-md border text-left transition-colors disabled:opacity-60 ${
                  position === reel.index ? "border-primary" : "border-border hover:border-primary/60"
                }`}
              >
                {item.thumbnail_url ? (
                  <img
                    src={item.thumbnail_url}
                    alt=""
                    loading="lazy"
                    className="aspect-[9/16] w-full object-cover"
                  />
                ) : (
                  <div className="aspect-[9/16] w-full bg-muted" />
                )}
                <span className="line-clamp-2 p-1 text-[10px] leading-tight">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!reel.loading && reel.unavailable ? (
        <p className="text-xs text-muted-foreground">
          Shorts search is unavailable right now. You can still paste a link below.
        </p>
      ) : null}

      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setLinkOpen((open) => !open)}
          aria-expanded={linkOpen}
        >
          <Link2 className="size-4" aria-hidden="true" /> Paste a link instead
        </Button>
        {linkOpen ? (
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const reference = parseShortsReference(link);
              if (!reference) {
                toast.error("That doesn't look like a YouTube Short or video link.");
                return;
              }
              setLink("");
              reel.onPick(reference.videoId);
            }}
          >
            <label htmlFor="shorts-link" className="sr-only">
              YouTube Shorts link
            </label>
            <Input
              id="shorts-link"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://www.youtube.com/shorts/…"
              inputMode="url"
              autoComplete="off"
              className="min-w-48 flex-1"
            />
            <Button type="submit" size="sm" disabled={disabled || link.trim().length === 0}>
              {personal ? "Watch" : "Play in room"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
