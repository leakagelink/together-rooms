import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, RotateCw, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toBrowseUrl } from "@/lib/in-app-browser";

interface EmbeddedBrowserProps {
  url: string | null;
  onClose: () => void;
}

/**
 * In-app browser surface for the web runtime (native uses the Capacitor
 * in-app web view). The page renders unmodified inside a sandboxed frame and
 * the live address is always visible; we inject nothing and record nothing.
 * Some sites refuse to be embedded — then we say so and offer a plain tab.
 */
export function EmbeddedBrowser({ url, onClose }: EmbeddedBrowserProps) {
  const [current, setCurrent] = useState(url ?? "");
  const [address, setAddress] = useState(url ?? "");
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!url) return;
    setCurrent(url);
    setAddress(url);
    setLoading(true);
    setBlocked(false);
    loadedRef.current = false;
  }, [url]);

  // Sites sending X-Frame-Options / frame-ancestors never fire a usable load.
  useEffect(() => {
    if (!current) return;
    loadedRef.current = false;
    const timer = window.setTimeout(() => {
      if (!loadedRef.current) setBlocked(true);
      setLoading(false);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [current]);

  if (!url) return null;

  const go = (raw: string) => {
    const next = toBrowseUrl(raw);
    if (!next) return;
    setCurrent(next);
    setAddress(next);
    setLoading(true);
    setBlocked(false);
  };

  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col">
      <div className="border-border flex items-center gap-2 border-b p-2">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Back to room">
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            go(address);
          }}
        >
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-label="Address or search"
            inputMode="url"
            className="h-9 text-xs"
          />
          <Button type="submit" size="icon" variant="ghost" aria-label="Reload">
            <RotateCw className="size-4" aria-hidden="true" />
          </Button>
        </form>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close browser">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="relative flex-1">
        {loading && !blocked ? (
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : null}
        {blocked ? (
          <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
            <ShieldCheck className="text-muted-foreground size-6" aria-hidden="true" />
            <p className="text-sm font-medium">This site blocks in-app embedding</p>
            <p className="text-muted-foreground text-xs">
              The site owner does not allow their pages to load inside other apps. Search results
              and most reference sites work here; for this one you can open a normal tab.
            </p>
            <Button
              variant="outline"
              onClick={() => window.open(current, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-4" aria-hidden="true" /> Open in a tab
            </Button>
          </div>
        ) : (
          <iframe
            key={current}
            src={current}
            title="In-app browser"
            className="size-full border-0"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            onLoad={() => {
              loadedRef.current = true;
              setLoading(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
