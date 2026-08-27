import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { searchYouTube, type MediaSearchResult } from "@/lib/media-search.functions";
import { providerError } from "@/lib/providers/media-provider";
import { youtubeProvider } from "@/lib/providers/youtube";

export interface MediaSearchPanelProps {
  /** Loads the chosen video into the room. */
  onPick: (mediaId: string) => void;
  disabled?: boolean;
  /** Label of the primary action, e.g. "Play now" or "Add to queue". */
  actionLabel?: string;
}

/**
 * Search-first media picker for watch/music rooms.
 *
 * Search runs through an authenticated server function so the YouTube Data API
 * key stays on the server; results are display-only and every pick still goes
 * through the authoritative playback RPC (which re-checks policy).
 */
export function MediaSearchPanel({
  onPick,
  disabled = false,
  actionLabel = "Play now",
}: MediaSearchPanelProps) {
  const search = useServerFn(searchYouTube);
  const [term, setTerm] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [results, setResults] = useState<MediaSearchResult[] | null>(null);

  const searchMutation = useMutation({
    mutationFn: async (query: string) => search({ data: { query } }),
    onSuccess: (outcome) => {
      if (outcome.status === "ok") {
        setResults(outcome.results);
        if (outcome.results.length === 0) toast.message("No videos matched that search.");
        return;
      }
      setResults([]);
      toast.error(
        outcome.status === "unavailable"
          ? "Search is unavailable right now. Paste a link instead."
          : outcome.status === "quota"
            ? "Search limit reached for today. Paste a link instead."
            : "Search failed. Please try again.",
      );
    },
    onError: () => toast.error("Search failed. Please try again."),
  });

  const onSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = term.trim();
    if (query.length < 2) {
      toast.error("Type at least 2 characters to search.");
      return;
    }
    searchMutation.mutate(query);
  };

  const onSubmitUrl = (event: React.FormEvent) => {
    event.preventDefault();
    const id = youtubeProvider.parseReference(urlInput);
    if (!id) {
      toast.error(providerError("invalid_id", "parse").message);
      return;
    }
    setUrlInput("");
    onPick(id);
  };

  const searching = searchMutation.isPending;

  return (
    <Tabs defaultValue="search" className="w-full">
      <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid">
        <TabsTrigger value="search">
          <Search className="mr-1.5 size-4" aria-hidden="true" /> Search
        </TabsTrigger>
        <TabsTrigger value="link">
          <Link2 className="mr-1.5 size-4" aria-hidden="true" /> Paste link
        </TabsTrigger>
      </TabsList>

      <TabsContent value="search" className="mt-3 space-y-3">
        <form onSubmit={onSearch} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="yt-search" className="sr-only">
            Search YouTube
          </label>
          <Input
            id="yt-search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search songs, movies, lectures…"
            className="flex-1"
            enterKeyHint="search"
            autoComplete="off"
          />
          <Button type="submit" disabled={disabled || searching} className="sm:w-auto">
            {searching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            Search
          </Button>
        </form>

        {searching ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((key) => (
              <li key={key} className="flex gap-3 rounded-lg border border-border p-2">
                <Skeleton className="aspect-video w-28 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2 py-1">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {!searching && results && results.length > 0 ? (
          <ul
            className="grid max-h-[22rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2"
            aria-label="Search results"
          >
            {results.map((item) => (
              <li key={item.media_id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(item.media_id)}
                  className="flex w-full gap-3 rounded-lg border border-border p-2 text-left transition-colors hover:border-primary/60 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {item.thumbnail_url ? (
                    <img
                      src={item.thumbnail_url}
                      alt=""
                      loading="lazy"
                      className="aspect-video w-28 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="aspect-video w-28 shrink-0 rounded-md bg-muted" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.channel}
                    </span>
                    <span className="mt-1 block text-xs font-medium text-primary">
                      {actionLabel}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {!searching && results && results.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No results. Try different words, or paste a link.
          </p>
        ) : null}
      </TabsContent>

      <TabsContent value="link" className="mt-3">
        <form onSubmit={onSubmitUrl} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="yt-url" className="sr-only">
            YouTube video link
          </label>
          <Input
            id="yt-url"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            className="flex-1"
            inputMode="url"
            autoComplete="off"
          />
          <Button type="submit" disabled={disabled}>
            Load video
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  );
}
