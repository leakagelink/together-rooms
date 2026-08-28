import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Loader2,
  MessagesSquare,
  RotateCw,
  Search,
  Share2,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toBrowseUrl } from "@/lib/in-app-browser";
import { researchSearch, type ResearchSearchResult } from "@/lib/research-search.functions";
import {
  RESEARCH_FRAME_ALLOW,
  RESEARCH_FRAME_SANDBOX,
  SURF_BLOCKED_MESSAGE,
  buildShareCandidate,
  canGoBack,
  canGoForward,
  canRenderInApp,
  classifyScheme,
  createHistory,
  currentUrl,
  goBack,
  goForward,
  isEmbedBlocked,
  isSearchQuery,
  pushHistory,
  type SurfHistory,
} from "@/lib/research-surf";
import { displayHost } from "@/lib/url-safety";

interface ResearchBrowserProps {
  /** Non-null while Surf Mode is open. The Research Room stays mounted behind it. */
  url: string | null;
  onClose: () => void;
  /** Server-authoritative resource share. Undefined when the member may not add. */
  onShareWithRoom?: ((url: string, title: string) => Promise<void>) | undefined;
  /** Focuses the existing room chat; no second chat system is created. */
  onDiscussInRoom?: (() => void) | undefined;
  roomLabel?: string | undefined;
}

/**
 * SURF MODE — the in-app Research Browser.
 *
 * Rendered *inside* the Research Room: the room component, its realtime
 * subscriptions and its presence are untouched while this is open, and closing
 * it simply returns to the board. It is mounted only while Surf Mode is open,
 * so no Research Room pays for it by default.
 *
 * Web content loads in a sandboxed cross-origin frame with no `allow-same-origin`
 * and no top-navigation, so page JavaScript cannot reach the Capacitor bridge,
 * the Supabase session, room/invite tokens or any SyncTogether native action.
 * Sites that refuse embedding are reported honestly with an explicit — never
 * automatic — handoff to the system browser.
 */
export function ResearchBrowser({
  url,
  onClose,
  onShareWithRoom,
  onDiscussInRoom,
  roomLabel,
}: ResearchBrowserProps) {
  const [history, setHistory] = useState<SurfHistory | null>(null);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [results, setResults] = useState<ResearchSearchResult[] | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const loadedRef = useRef(false);

  const active = history ? currentUrl(history) : "";

  useEffect(() => {
    if (!url) {
      // Session-scoped: history and frame are dropped when Surf Mode closes.
      setHistory(null);
      setAddress("");
      setBlocked(false);
      setLoading(false);
      return;
    }
    setResults(null);
    if (!canRenderInApp(url) || isEmbedBlocked(url)) {
      setHistory(createHistory(url));
      setAddress(url);
      setBlocked(true);
      setLoading(false);
      return;
    }
    setHistory(createHistory(url));
    setAddress(url);
    setBlocked(false);
    setLoading(true);
    loadedRef.current = false;
  }, [url]);

  // A site sending X-Frame-Options / frame-ancestors never fires a usable load.
  useEffect(() => {
    if (!active || blocked) return;
    loadedRef.current = false;
    const timer = window.setTimeout(() => {
      if (!loadedRef.current) setBlocked(true);
      setLoading(false);
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [active, blocked]);

  const runSearch = useCallback(async (term: string) => {
    setQuery(term);
    setSearching(true);
    setResults([]);
    try {
      const data = await researchSearch({ data: { query: term } });
      setResults(data.results);
    } catch {
      setResults([]);
      toast.error("Search is unavailable right now.");
    } finally {
      setSearching(false);
    }
  }, []);

  const navigate = useCallback((next: string) => {
    setResults(null);
    if (!canRenderInApp(next) || isEmbedBlocked(next)) {
      setHistory((prev) => (prev ? pushHistory(prev, next) : createHistory(next)));
      setAddress(next);
      setBlocked(true);
      setLoading(false);
      return;
    }
    setHistory((prev) => (prev ? pushHistory(prev, next) : createHistory(next)));
    setAddress(next);
    setBlocked(false);
    setLoading(true);
  }, []);

  const host = useMemo(() => {
    try {
      return displayHost(new URL(active).hostname);
    } catch {
      return "";
    }
  }, [active]);

  if (!url || !history) return null;

  const openExternally = () => {
    // Explicit, user-initiated fallback only. Custom/app schemes are refused.
    const decision = classifyScheme(active);
    if (decision === "blocked") {
      toast.error("That address can't be opened.");
      return;
    }
    window.open(active, "_blank", "noopener,noreferrer");
  };

  const share = async () => {
    if (!onShareWithRoom) return;
    const candidate = buildShareCandidate(active);
    if (!candidate.ok) {
      toast.error(candidate.error);
      return;
    }
    setSharing(true);
    try {
      await onShareWithRoom(candidate.resource.url, candidate.resource.title);
      toast.success("Shared with the room.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not share this page.");
    } finally {
      setSharing(false);
    }
  };

  const move = (direction: "back" | "forward") => {
    setHistory((prev) => {
      if (!prev) return prev;
      const next = direction === "back" ? goBack(prev) : goForward(prev);
      setAddress(currentUrl(next));
      setBlocked(false);
      setLoading(true);
      return next;
    });
  };

  return (
    <div
      className="bg-background fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-label="SyncTogether research browser"
    >
      <div className="border-border flex flex-col gap-2 border-b p-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => move("back")}
            disabled={!canGoBack(history)}
            aria-label="Back"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => move("forward")}
            disabled={!canGoForward(history)}
            aria-label="Forward"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (isSearchQuery(address)) {
                void runSearch(address.trim());
                return;
              }
              const next = toBrowseUrl(address);
              if (!next) {
                toast.error("Enter a search term or a website address.");
                return;
              }
              navigate(next);
            }}
          >
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              aria-label="Address or search"
              inputMode="url"
              className="h-9 min-w-0 flex-1 text-xs"
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              aria-label={isSearchQuery(address) ? "Search" : "Go"}
            >
              {isSearchQuery(address) ? (
                <Search className="size-4" aria-hidden="true" />
              ) : (
                <RotateCw className="size-4" aria-hidden="true" />
              )}
            </Button>
          </form>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close research browser">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Research browser{roomLabel ? ` · ${roomLabel}` : ""}
          </span>
          {onShareWithRoom ? (
            <Button size="sm" variant="outline" onClick={share} disabled={sharing || !active}>
              {sharing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Share2 className="size-3.5" aria-hidden="true" />
              )}
              Share with room
            </Button>
          ) : null}
          {onDiscussInRoom ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onClose();
                onDiscussInRoom();
              }}
            >
              <MessagesSquare className="size-3.5" aria-hidden="true" /> Discuss in room
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto">
        {results !== null ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4">
            <p className="text-muted-foreground text-xs">
              {searching ? "Searching…" : `Results for “${query}”`}
            </p>
            {searching ? (
              <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
            ) : results.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No results. Try different words, or type a website address.
              </p>
            ) : (
              results.map((result) => (
                <button
                  key={result.url}
                  type="button"
                  onClick={() => navigate(result.url)}
                  className="border-border hover:bg-muted/60 rounded-xl border p-3 text-left transition"
                >
                  <span className="line-clamp-2 text-sm font-medium">{result.title}</span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px]">
                    {result.host}
                  </span>
                  {result.snippet ? (
                    <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs">
                      {result.snippet}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}

        {results === null && loading && !blocked ? (
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : null}

        {results === null && blocked ? (
          <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
            <ShieldCheck className="text-muted-foreground size-6" aria-hidden="true" />
            <p className="text-sm font-medium">{SURF_BLOCKED_MESSAGE}</p>
            <p className="text-muted-foreground text-xs">
              {host ? `${host} does not allow` : "This site does not allow"} its pages to load
              inside other apps. Most reference sites and search results work here; for this one you
              can open your browser.
            </p>
            <Button variant="outline" onClick={openExternally}>
              <ExternalLink className="size-4" aria-hidden="true" /> Open in Browser
            </Button>
          </div>
        ) : results === null ? (
          <iframe
            key={active}
            src={active}
            title="Research browser"
            className="size-full border-0"
            referrerPolicy="no-referrer"
            sandbox={RESEARCH_FRAME_SANDBOX}
            allow={RESEARCH_FRAME_ALLOW}
            onLoad={() => {
              loadedRef.current = true;
              setLoading(false);
            }}
          />
        ) : null}
      </div>

      <p className="text-muted-foreground border-border border-t p-2 text-[11px]">
        You stay in the room while you research. Nothing you browse is recorded, sent to the room or
        shared with other members until you choose “Share with room”.
      </p>
    </div>
  );
}
