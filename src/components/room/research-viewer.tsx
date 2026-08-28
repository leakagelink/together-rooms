import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe, Loader2, NotebookPen, ShieldCheck } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { displayHost } from "@/lib/url-safety";
import { isNativeRuntime, openResource } from "@/lib/in-app-browser";

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
 * Research reader: opens the resource in an in-app browser surface (Android
 * Custom Tab) instead of throwing the user out into a separate browser app,
 * and keeps a note pad next to it so findings can be captured without leaving
 * the room. Third-party pages render in the platform browser engine — we never
 * re-frame, modify or script them.
 */
export function ResearchViewer({
  target,
  onOpenChange,
  onSaveNote,
  canSaveNotes = false,
}: ResearchViewerProps) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const native = useMemo(() => isNativeRuntime(), []);

  useEffect(() => {
    setNotes("");
  }, [target?.id]);

  const open = async () => {
    if (!target) return;
    setOpening(true);
    const mode = await openResource(target.url);
    setOpening(false);
    if (!mode) toast.error("This link can't be opened.");
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
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92svh] flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base leading-snug">{target?.title ?? "Resource"}</DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-xs">
            <Globe className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{displayHost(target?.host ?? null) || target?.url}</span>
          </DialogDescription>
        </DialogHeader>

        <Button onClick={open} disabled={opening} className="w-full">
          {opening ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink className="size-4" aria-hidden="true" />
          )}
          {native ? "Read inside SyncTogether" : "Open page"}
        </Button>

        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {native
            ? "The page opens in a secure in-app browser tab with its own address bar. SyncTogether never reads, changes or records what you browse."
            : "Your browser opens this page in a new tab. SyncTogether never reads or records what you browse."}
        </p>

        {canSaveNotes && onSaveNote ? (
          <div className="space-y-2">
            <label htmlFor="research-note" className="text-sm font-medium">
              Research notes
            </label>
            <Textarea
              id="research-note"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={6}
              placeholder="What did you find on this page?"
            />
            <p className="text-xs text-muted-foreground">
              Saved as a room note with the source link attached.
            </p>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
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
  );
}
