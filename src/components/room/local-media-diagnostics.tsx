import { useState } from "react";
import { Activity, ChevronDown, ChevronUp, Copy, Eraser } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDiagEvent, shortPeer, type DiagEvent, type PeerDiag } from "@/lib/local-media/diagnostics";

interface Props {
  isOwner: boolean;
  peers: PeerDiag[];
  events: DiagEvent[];
  onClear: () => void;
}

function stateTone(peer: PeerDiag): "default" | "secondary" | "destructive" {
  if (peer.connectionState === "failed" || peer.connectionState === "disconnected")
    return "destructive";
  if (peer.connectionState === "connected" && peer.channelState === "open") return "default";
  return "secondary";
}

function stateLabel(peer: PeerDiag): string {
  if (peer.connectionState === "failed") return "Failed";
  if (peer.connectionState === "disconnected") return "Disconnected";
  if (peer.channelState === "open" && peer.chunks > 0) return "Streaming";
  if (peer.connectionState === "connected") return "Connected";
  if (peer.answered) return "Negotiating";
  return "Waiting";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Per-viewer connection status plus a readable delivery log. This is a support
 * surface: it exposes only connection metadata (states, counters, reasons),
 * never media contents or identifiers beyond a truncated member id.
 */
export function LocalMediaDiagnostics({ isOwner, peers, events, onClear }: Props) {
  const [open, setOpen] = useState(false);

  const copyLog = async () => {
    const text = events.map(formatDiagEvent).join("\n");
    try {
      await navigator.clipboard.writeText(text || "No events recorded yet.");
      toast.success("Troubleshooting log copied");
    } catch {
      toast.error("Couldn't copy the log on this device");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1">
          Connection status
          {peers.length > 0 ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {isOwner ? `${peers.length} viewer${peers.length === 1 ? "" : "s"}` : stateLabel(peers[0]!)}
            </span>
          ) : (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {isOwner ? "No viewers connected yet" : "Not connected"}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <ul className="space-y-2">
            {peers.length === 0 ? (
              <li className="text-xs text-muted-foreground">
                {isOwner
                  ? "Nobody has requested the media yet. Viewers appear here as soon as they send an offer."
                  : "No connection attempt recorded yet."}
              </li>
            ) : (
              peers.map((peer) => (
                <li
                  key={peer.peerId}
                  className="rounded-md border border-border/60 bg-background/60 p-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {peer.role === "viewer" ? "Viewer" : "Sharer"} {shortPeer(peer.peerId)}
                    </span>
                    <Badge variant={stateTone(peer)}>{stateLabel(peer)}</Badge>
                  </div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground sm:grid-cols-3">
                    <div>
                      <dt className="inline">Peer: </dt>
                      <dd className="inline">{peer.connectionState}</dd>
                    </div>
                    <div>
                      <dt className="inline">ICE: </dt>
                      <dd className="inline">{peer.iceState}</dd>
                    </div>
                    <div>
                      <dt className="inline">Channel: </dt>
                      <dd className="inline">{peer.channelState}</dd>
                    </div>
                    <div>
                      <dt className="inline">Offers: </dt>
                      <dd className="inline">
                        {peer.role === "viewer" ? peer.offersReceived : peer.offersSent} ·{" "}
                        {peer.answered ? "answered" : "no answer"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Chunks: </dt>
                      <dd className="inline">{peer.chunks}</dd>
                    </div>
                    <div>
                      <dt className="inline">Data: </dt>
                      <dd className="inline">{formatBytes(peer.bytes)}</dd>
                    </div>
                  </dl>
                  {peer.lastReason ? (
                    <p className="mt-1 text-amber-600 dark:text-amber-400">
                      Last issue: {peer.lastReason}
                    </p>
                  ) : null}
                </li>
              ))
            )}
          </ul>

          <div className="max-h-56 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events yet.</p>
            ) : (
              <ol className="space-y-1 text-xs">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className={
                      event.level === "error"
                        ? "text-destructive"
                        : event.level === "warn"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    {formatDiagEvent(event)}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void copyLog()}>
              <Copy className="size-4" aria-hidden="true" /> Copy log
            </Button>
            <Button variant="ghost" size="sm" onClick={onClear}>
              <Eraser className="size-4" aria-hidden="true" /> Clear
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
