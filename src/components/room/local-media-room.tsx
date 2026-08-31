import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Images, MonitorPlay, Pause, Play, RotateCcw, Square, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocalMedia } from "@/hooks/useLocalMedia";
import { useLocalMediaTransfer } from "@/hooks/useLocalMediaTransfer";
import { LocalMediaDiagnostics } from "@/components/room/local-media-diagnostics";
import { LocalMediaPreflight } from "@/components/room/local-media-preflight";
import { LocalMediaQueue, type QueueItemView } from "@/components/room/local-media-queue";
import {
  capabilityMessage,
  checkSelection,
  describeSelection,
  detectCapability,
  selectionMessage,
  type LocalMediaKind,
} from "@/lib/local-media/capability";
import { MAX_IMAGE_ITEMS, MAX_QUEUE_ITEMS } from "@/lib/local-media/limits";
import {
  buildPreflight,
  canStartSharing,
  detectTransportSupport,
} from "@/lib/local-media/permissions";
import { localExpectedPosition, shouldCorrectDrift } from "@/lib/local-media/sync";

interface LocalMediaRoomProps {
  roomId: string;
  userId: string | undefined;
  /** Client-side gating only; SQL re-enforces who may share and control. */
  canShare: boolean;
  roomActive: boolean;
}
/** Compact byte label used in the resume hints. */
function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Phase 7 — private local media sharing surface.
 *
 * What this deliberately is NOT: an upload feature. Selected files never leave
 * the device except as a live, encrypted peer stream to authorized members of
 * this room, and nothing is stored on any server. When the session ends the
 * object URLs are revoked and playback stops for everyone.
 */
export function LocalMediaRoom({ roomId, userId, canShare, roomActive }: LocalMediaRoomProps) {
  const media = useLocalMedia(roomId, userId, roomActive);
  const [files, setFiles] = useState<File[]>([]);
  const [objectUrls, setObjectUrls] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [decodeVerdict, setDecodeVerdict] = useState<"supported" | "maybe" | "unsupported">(
    "maybe",
  );
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [consented, setConsented] = useState(false);
  const [starting, setStarting] = useState(false);
  /** Viewer-only: an item being browsed instead of the sharer's current one. */
  const [browseIndex, setBrowseIndex] = useState<number | null>(null);
  /** Read inside the drift effect, which runs before `browsing` is computed. */
  const browsingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const session = media.session;
  const isOwner = media.isOwner;

  /** Object URLs are the only handle to the bytes and are always revoked. */
  const releaseUrls = useCallback(() => {
    setObjectUrls((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
  }, []);

  useEffect(() => releaseUrls, [releaseUrls]);

  // Session gone (ended, expired, owner absent, membership revoked) → stop.
  useEffect(() => {
    if (!session) {
      releaseUrls();
      setFiles([]);
      setConsented(false);
      setBrowseIndex(null);
    }
  }, [session, releaseUrls]);

  const onPick = useCallback((picked: FileList | null) => {
    const list = picked ? [...picked] : [];
    const check = checkSelection(list);
    if (!check.ok) {
      setWarning(selectionMessage(check.reason ?? "empty"));
      setFiles([]);
      return;
    }
    const probe =
      check.kind === "image"
        ? null
        : document.createElement(check.kind === "audio" ? "audio" : "video");
    const verdict = detectCapability(list[0]!.type, probe);
    setWarning(capabilityMessage(verdict, list[0]!.type));
    setDecodeVerdict(verdict === "unsupported" ? "unsupported" : verdict);
    if (verdict === "unsupported") {
      setFiles([]);
      return;
    }
    setFiles(list);
    setObjectUrls(list.map((file) => URL.createObjectURL(file)));
  }, []);

  /** Device permission / capability gate evaluated before any bytes are sent. */
  const preflightChecks = useMemo(
    () =>
      buildPreflight({
        fileCount: files.length,
        decode: decodeVerdict,
        transportAvailable: detectTransportSupport(),
        consented,
      }),
    [files.length, decodeVerdict, consented],
  );

  const startShare = useCallback(async () => {
    if (!canStartSharing(preflightChecks)) return;
    const descriptor = describeSelection(files);
    if (!descriptor) return;
    setStarting(true);
    const id = await media.start(descriptor);
    setStarting(false);
    if (!id) {
      toast.error("Couldn't start sharing. Check you're still in this room.");
      return;
    }
    setPreflightOpen(false);
  }, [files, media, preflightChecks]);

  const stopShare = useCallback(async () => {
    await media.end();
    releaseUrls();
    setFiles([]);
    toast.success("Sharing stopped. Access ended for everyone.");
  }, [media, releaseUrls]);

  /** Viewer-side drift correction against the authoritative timestamps. */
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !session || session.media_kind === "image") return;
    // While a viewer browses another queue item, don't fight their playback.
    if (browsingRef.current) return;
    const target = localExpectedPosition(
      {
        playback_status: session.playback_status,
        position_seconds: session.position_seconds,
        playback_started_at: session.playback_started_at,
      },
      Date.now(),
    );
    if (shouldCorrectDrift(element.currentTime, target)) element.currentTime = target;
    if (session.playback_status === "playing" && element.paused) {
      void element.play().catch(() => setWarning("Tap play once to allow sound on this device."));
    }
    if (session.playback_status !== "playing" && !element.paused) element.pause();
  }, [session]);

  // Viewers receive the owner's bytes over an authenticated peer connection.
  const transfer = useLocalMediaTransfer({
    sessionId: session?.id ?? null,
    ownerId: session?.owner_id ?? null,
    isOwner,
    userId,
    files,
    sendSignal: media.sendSignal,
    onSignal: media.onSignal,
    ready: Boolean(session && media.credential),
  });

  const transferError = transfer.errorMessage;
  useEffect(() => {
    if (isOwner || !transferError) return;
    toast.error(transferError);
  }, [isOwner, transferError]);

  const kind: LocalMediaKind | null = session?.media_kind ?? null;
  const sourceUrls = isOwner ? objectUrls : transfer.urls;
  const sharedIndex = session?.current_index ?? 0;
  // The sharer always shows the authoritative item; viewers may browse the
  // queue locally — every item already arrives over the same connection.
  const activeIndex = isOwner ? sharedIndex : (browseIndex ?? sharedIndex);
  const browsing = !isOwner && browseIndex != null && browseIndex !== sharedIndex;
  browsingRef.current = browsing;
  const currentUrl = sourceUrls[activeIndex] ?? (isOwner ? (sourceUrls[0] ?? null) : null);

  const queueItems = useMemo<QueueItemView[]>(() => {
    const count = session?.item_count ?? 0;
    return Array.from({ length: count }, (_, index) => ({
      index,
      // Filenames never leave the device, so viewers see neutral labels.
      label: isOwner ? (files[index]?.name ?? `Item ${index + 1}`) : `Item ${index + 1}`,
      state: (sourceUrls[index] ? "ready" : "pending") as QueueItemView["state"],
    }));
  }, [session?.item_count, isOwner, files, sourceUrls]);

  const selectQueueItem = useCallback(
    (index: number) => {
      if (isOwner) {
        void media.control({ action: "set_index", index });
        return;
      }
      setBrowseIndex(index);
    },
    [isOwner, media],
  );

  const transportLabel = useMemo(() => {
    if (!isOwner) {
      if (transfer.status === "receiving")
        return `Receiving ${Math.round(transfer.progress * 100)}%`;
      if (transfer.status === "connecting") return "Connecting to sharer…";
      if (transfer.status === "failed") return "Connection failed";
      if (transfer.status === "ready") return "Direct encrypted connection";
    }
    switch (media.transportState) {
      case "direct":
        return "Direct encrypted connection";
      case "relay":
        return "Encrypted via relay";
      default:
        return isOwner && transfer.status === "sending"
          ? `Sending ${Math.round(transfer.progress * 100)}%`
          : "Not connected";
    }
  }, [media.transportState, isOwner, transfer.status, transfer.progress]);

  return (
    <section className="surface-panel mt-8 p-5" aria-labelledby="local-media-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="local-media-heading" className="text-lg font-semibold">
            My Media
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Photos, video and audio you pick are streamed live to people in this room. Nothing is
            uploaded or stored, and access ends the moment you stop streaming.
          </p>
        </div>
        <Badge variant={media.transportState === "unavailable" ? "secondary" : "default"}>
          {transportLabel}
        </Badge>
      </div>

      {!media.authorized ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          You no longer have access to this room's shared media.
        </p>
      ) : null}

      {session ? (
        <div className="mt-5 space-y-3">
          <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
            {kind === "image" ? (
              currentUrl ? (
                <img
                  src={currentUrl}
                  alt={`Shared photo ${activeIndex + 1} of ${session.item_count}`}
                  className="max-h-[60dvh] w-full object-contain"
                />
              ) : (
                <p className="p-6 text-sm text-muted-foreground">
                  {transfer.status === "failed"
                    ? (transfer.errorMessage ?? "Couldn't receive the shared photo.")
                    : `Receiving photo from the sharer… ${Math.round(transfer.progress * 100)}%`}
                </p>
              )
            ) : currentUrl ? (
              <video
                ref={videoRef}
                src={currentUrl}
                controls={isOwner}
                playsInline
                className="max-h-[60dvh] w-full bg-stage"
                // Background playback is allowed for device-shared media only:
                // it is the user's own file, not third-party embedded content.
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                {transfer.status === "failed"
                  ? (transfer.errorMessage ?? "Couldn't connect to the sharer's device.")
                  : `Receiving ${session.media_kind} from the sharer… ${Math.round(transfer.progress * 100)}%`}
                {transfer.canResume ? ` · ${formatKb(transfer.resumeBytes)} already received` : ""}
              </p>
            )}
          </div>

          {!isOwner && transfer.status === "failed" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <span className="flex-1">
                {transfer.errorMessage ?? "The shared media couldn't be delivered."}
                {transfer.canResume
                  ? ` Transfer will continue from ${formatKb(transfer.resumeBytes)} — nothing already received is lost.`
                  : ""}
              </span>
              <Button variant="outline" size="sm" onClick={transfer.retry}>
                <RotateCcw className="size-4" aria-hidden="true" />{" "}
                {transfer.canResume ? "Resume" : "Retry"}
              </Button>
            </div>
          ) : null}

          {!isOwner && transfer.status === "connecting" ? (
            <Button variant="outline" size="sm" onClick={transfer.retry}>
              <RotateCcw className="size-4" aria-hidden="true" />{" "}
              {transfer.canResume ? "Resume transfer" : "Reconnect"}
            </Button>
          ) : null}

          {session.item_count > 1 && kind ? (
            <LocalMediaQueue
              kind={kind}
              items={queueItems}
              activeIndex={activeIndex}
              sharedIndex={sharedIndex}
              canControl={isOwner}
              browsing={browsing}
              onSelect={selectQueueItem}
              onFollow={() => setBrowseIndex(null)}
            />
          ) : null}

          <LocalMediaDiagnostics
            isOwner={isOwner}
            peers={transfer.peers}
            events={transfer.events}
            onClear={transfer.clearLog}
          />

          <p className="text-xs text-muted-foreground">
            {session.item_count > 1
              ? `${session.media_kind === "image" ? "Photo" : session.media_kind === "audio" ? "Track" : "Video"} ${activeIndex + 1} of ${session.item_count}`
              : `Live ${session.media_kind} from ${isOwner ? "your device" : "another member's device"}`}
            {" · "}
            Ends {new Date(session.expires_at).toLocaleTimeString()}
          </p>

          {isOwner ? (
            <div className="flex flex-wrap gap-2">
              {session.item_count > 1 ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void media.control({
                        action: "set_index",
                        index: Math.max(0, session.current_index - 1),
                      })
                    }
                    disabled={session.current_index === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void media.control({
                        action: "set_index",
                        index: Math.min(session.item_count - 1, session.current_index + 1),
                      })
                    }
                    disabled={session.current_index >= session.item_count - 1}
                  >
                    Next
                  </Button>
                </>
              ) : null}
              {session.media_kind !== "image" ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void media.control({
                        action: "play",
                        position_seconds: videoRef.current?.currentTime ?? 0,
                      })
                    }
                  >
                    <Play className="size-4" aria-hidden="true" /> Play
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void media.control({
                        action: "pause",
                        position_seconds: videoRef.current?.currentTime ?? 0,
                      })
                    }
                  >
                    <Pause className="size-4" aria-hidden="true" /> Pause
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void media.control({
                        action: "seek",
                        position_seconds: videoRef.current?.currentTime ?? 0,
                      })
                    }
                  >
                    <RotateCcw className="size-4" aria-hidden="true" /> Resync here
                  </Button>
                </>
              ) : null}
              <Button variant="destructive" onClick={() => void stopShare()}>
                <Square className="size-4" aria-hidden="true" /> Stop sharing
              </Button>
            </div>
          ) : null}
        </div>
      ) : canShare ? (
        <div className="mt-5 space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            className="sr-only"
            onChange={(event) => onPick(event.target.files)}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" aria-hidden="true" /> Choose from this device
            </Button>
            <Button
              onClick={() => setPreflightOpen(true)}
              disabled={files.length === 0 || !roomActive}
            >
              <MonitorPlay className="size-4" aria-hidden="true" /> Review &amp; share
            </Button>
          </div>
          {files.length > 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Images className="size-4" aria-hidden="true" />
              {files.length === 1
                ? `1 ${files[0]!.type.split("/")[0]} ready to share`
                : `${files.length} items queued — the room can browse through them (up to ${
                    files[0]!.type.startsWith("image/") ? MAX_IMAGE_ITEMS : MAX_QUEUE_ITEMS
                  })`}
            </p>
          ) : null}
          {warning ? (
            <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
              {warning}
            </p>
          ) : null}
          <LocalMediaPreflight
            open={preflightOpen}
            onOpenChange={(open) => {
              setPreflightOpen(open);
              if (!open) setStarting(false);
            }}
            checks={preflightChecks}
            consented={consented}
            onConsentChange={setConsented}
            fileNames={files.map((file) => file.name)}
            onConfirm={() => void startShare()}
            starting={starting}
          />
          <p className="text-xs text-muted-foreground">
            Only share media you have the right to share. Sharing is peer-to-peer and encrypted in
            transit, but people in the room can record their own screen — treat it as visible to
            everyone here.
          </p>
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          Only the host can share media from their device in this room.
        </p>
      )}
    </section>
  );
}
