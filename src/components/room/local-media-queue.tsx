import { Check, Loader2, Music, Play, Image as ImageIcon, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LocalMediaKind } from "@/lib/local-media/capability";

export interface QueueItemView {
  index: number;
  /** Owner-side filename, or a neutral label for viewers (names never leave the device). */
  label: string;
  /** Viewer-side delivery state for this item. */
  state: "ready" | "pending";
}

interface LocalMediaQueueProps {
  kind: LocalMediaKind;
  items: QueueItemView[];
  /** Item the local user is looking at. */
  activeIndex: number;
  /** Item the sharer has made current for the room. */
  sharedIndex: number;
  canControl: boolean;
  /** Viewer is looking at something other than the shared item. */
  browsing: boolean;
  onSelect: (index: number) => void;
  onFollow: () => void;
}

const KIND_ICON = { image: ImageIcon, video: Video, audio: Music } as const;

/**
 * Shared queue for a device-sharing session. Every item travels over the same
 * peer connection, so switching items — by the sharer for everyone, or by a
 * viewer browsing on their own — never reconnects or restarts the transfer.
 */
export function LocalMediaQueue({
  kind,
  items,
  activeIndex,
  sharedIndex,
  canControl,
  browsing,
  onSelect,
  onFollow,
}: LocalMediaQueueProps) {
  if (items.length <= 1) return null;
  const Icon = KIND_ICON[kind];

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-sm font-medium">
          Queue · {activeIndex + 1} of {items.length}
        </p>
        {browsing ? (
          <Button variant="outline" size="sm" onClick={onFollow}>
            Back to item {sharedIndex + 1}
          </Button>
        ) : null}
      </div>
      <ul className="max-h-56 divide-y divide-border overflow-y-auto">
        {items.map((item) => {
          const isActive = item.index === activeIndex;
          const isShared = item.index === sharedIndex;
          return (
            <li key={item.index}>
              <button
                type="button"
                onClick={() => onSelect(item.index)}
                aria-current={isActive ? "true" : undefined}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                  isActive ? "bg-muted" : ""
                }`}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {isShared ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {canControl ? "Playing" : "Sharer here"}
                  </span>
                ) : null}
                {item.state === "ready" ? (
                  <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Received" />
                ) : (
                  <Loader2
                    className="size-4 shrink-0 animate-spin text-muted-foreground"
                    aria-label="Still receiving"
                  />
                )}
                {isActive ? <Play className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
