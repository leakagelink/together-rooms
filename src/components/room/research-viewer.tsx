import { useEffect, useState } from "react";
import { Compass, ExternalLink, Globe, Loader2, NotebookPen, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { displayHost } from "@/lib/url-safety";
import { ResearchBrowser } from "@/components/room/research-browser";
import { toBrowseUrl } from "@/lib/in-app-browser";

export interface ResearchTarget {
  id: string;
  title: string;
  url: string;
  host: string | null;
}

interface ResearchViewerProps {
  target: ResearchTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Saves a note for the room; resolves when the note is stored. */
  onSaveNote?: (title: string, content: string) => Promise<void>;
  canSaveNotes?: boolean;
}

/**
 * Research reader: the resource opens in SyncTogether's own in-app browser —
 * full screen, with the live URL, toolbar and back/forward controls — so the
 * user never leaves the app. Pages render unmodified; we inject nothing and
 * store nothing about the browsing itself. When the browser is dismissed the
 * note pad is waiting so findings can be captured straight into the room.
 */
export function ResearchViewer({
  target,
  onOpenChange,
  onSaveNote,
  canSaveNotes = false,
}: ResearchViewerProps) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [visited, setVisited] = useState(false);
  const [surf, setSurf] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  useEffect(() => {
    setNotes("");
    setVisited(false);
    setSurf("");
  }, [target?.id]);

  // Surf Mode always stays inside SyncTogether; the system browser is only
  // reachable from the in-app browser's explicit "Open in Browser" fallback.
  const browse = (url: string) => {
    setEmbedUrl(url);
  };

  const save = async () => {
    if (!target || !onSaveNote) return;
    const content = notes.trim();
    if (!content) {
      toast.error("Write something first.");
      return;
    }
    setSaving(true);
    try {
      await onSaveNote(target.title.slice(0, 80), `${target.url}\n\n${content}`);
      setNotes("");
      toast.success("Saved to room notes.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[92svh] flex-col gap-4 overflow-y-auto sm:max-w-lg">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base leading-snug">
              {target?.title ?? "Resource"}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 text-xs">
              <Globe className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{displayHost(target?.host ?? null) || target?.url}</span>
            </DialogDescription>
          </DialogHeader>

          <Button
            onClick={() => target && browse(target.url)}
            disabled={!target}
            className="w-full"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open in SyncTogether browser
          </Button>

          {/* Free surfing from the same sheet: search terms or a bare domain. */}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const url = toBrowseUrl(surf);
              if (!url) {
                toast.error("Enter a search term or a website address.");
                return;
              }
              void browse(url);
            }}
          >
            <Input
              value={surf}
              onChange={(event) => setSurf(event.target.value)}
              placeholder="Search the web or enter a site"
              inputMode="url"
              aria-label="Search the web or enter a site"
            />
            <Button type="submit" variant="outline">
              <Compass className="size-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Surf</span>
            </Button>
          </form>

          <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Pages open inside SyncTogether with the real address shown. Sites load exactly as their
            owners published them, and your browsing is never recorded or shared with the room.
          </p>

          {canSaveNotes && onSaveNote ? (
            <div className="space-y-2">
              <label htmlFor="research-note" className="text-sm font-medium">
                Research notes{" "}
                {visited ? <span className="text-muted-foreground">· ready</span> : null}
              </label>
              <Textarea
                id="research-note"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={6}
                placeholder="What did you find on this page?"
                autoFocus={visited}
              />
              <p className="text-xs text-muted-foreground">
                Saved as a room note with the source link attached.
              </p>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto"
            >
              Close
            </Button>
            {canSaveNotes && onSaveNote ? (
              <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <NotebookPen className="size-4" aria-hidden="true" />
                )}
                Save note
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ResearchBrowser
        url={embedUrl}
        onClose={() => {
          setEmbedUrl(null);
          setVisited(true);
        }}
      />
    </>
  );
}
