import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ListMusic,
  Plus,
  Repeat,
  RotateCcw,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaSearchPanel } from "@/components/room/media-search-panel";
import { WatchTogether } from "@/components/room/watch-together";
import { useRoomQueue } from "@/hooks/useRoomQueue";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { PlaybackState } from "@/lib/playback-sync";
import { rpcMessage, type RpcReason } from "@/lib/rpc-types";
import {
  addIntent,
  canRemoveItem,
  modeLabel,
  moveTargetIndex,
  nextRepeatMode,
  queueSections,
  repeatLabel,
  type QueueItem,
  type QueueMode,
} from "@/lib/queue-rules";
import {
  addToQueue,
  advanceQueue,
  approveQueueItem,
  clearQueue,
  moveQueueItem,
  previousQueueItem,
  rejectQueueItem,
  removeFromQueue,
  restartCurrentItem,
  setQueueMode,
  setRepeatMode,
  setShuffleEnabled,
  startQueue,
  startRoomFromPlaylist,
} from "@/lib/queue.functions";

interface MusicRoomProps {
  roomId: string;
  userId: string | undefined;
  /** Host or a member with playback control. UI gating only — SQL re-checks. */
  canManage: boolean;
  roomActive: boolean;
}

const MODES: QueueMode[] = ["host_only", "collaborative", "host_approval"];

/**
 * Phase 5 music room: the shared player plus the authoritative queue.
 *
 * Every button here calls a queue RPC. The client never decides ordering,
 * permission or what plays next — it only reports and re-reads.
 */
export function MusicRoom({ roomId, userId, canManage, roomActive }: MusicRoomProps) {
  const queryClient = useQueryClient();
  const queue = useRoomQueue(roomId, userId);

  // Read-only view of the playback state the player hook already maintains.
  const playbackCache = useQuery<PlaybackState | null>({
    queryKey: queryKeys.playback.state(roomId),
    enabled: false,
  });
  const version = playbackCache.data?.version ?? null;

  const playlistsQuery = useQuery({
    queryKey: queryKeys.playlists.mine(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlists")
        .select("id, name")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: canManage,
  });

  const add = useServerFn(addToQueue);
  const move = useServerFn(moveQueueItem);
  const remove = useServerFn(removeFromQueue);
  const clear = useServerFn(clearQueue);
  const approve = useServerFn(approveQueueItem);
  const reject = useServerFn(rejectQueueItem);
  const start = useServerFn(startQueue);
  const advance = useServerFn(advanceQueue);
  const previous = useServerFn(previousQueueItem);
  const restart = useServerFn(restartCurrentItem);
  const mode = useServerFn(setQueueMode);
  const repeat = useServerFn(setRepeatMode);
  const shuffle = useServerFn(setShuffleEnabled);
  const fromPlaylist = useServerFn(startRoomFromPlaylist);

  const settings = queue.settings;
  const queueVersion = queue.snapshot?.queue_version ?? settings?.queue_version ?? null;
  const sections = useMemo(() => queueSections(queue.snapshot?.items ?? []), [queue.snapshot]);

  const afterMutation = useCallback(() => {
    queue.refresh();
    void queryClient.invalidateQueries({ queryKey: queryKeys.playback.state(roomId) });
  }, [queryClient, queue, roomId]);

  const run = useMutation({
    mutationFn: async (fn: () => Promise<{ ok: boolean; reason?: string }>) => {
      const result = await fn();
      if (!result.ok) throw new Error(rpcMessage((result.reason ?? "server_error") as RpcReason));
      return result;
    },
    onSuccess: afterMutation,
    onError: (error: Error) => {
      toast.error(error.message);
      afterMutation();
    },
  });

  const busy = run.isPending;

  const intent = addIntent(settings?.queue_mode ?? "host_only", canManage);

  /** Adds a searched or pasted video to the authoritative room queue. */
  const onAddMedia = useCallback(
    (mediaId: string) => {
      run.mutate(() => add({ data: { room_id: roomId, media_id: mediaId } }));
    },
    [add, roomId, run],
  );


  /** End-of-track report from the player. Losing reports get version_conflict. */
  const onTrackEnded = useCallback(
    (seenVersion: number) => {
      void advance({ data: { room_id: roomId, cause: "ended", expected_version: seenVersion } })
        .catch(() => undefined)
        .finally(afterMutation);
    },
    [advance, afterMutation, roomId],
  );

  const transport = canManage ? (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          run.mutate(() => start({ data: { room_id: roomId, expected_version: version } }))
        }
      >
        <ListMusic className="size-4" aria-hidden="true" /> Start queue
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          run.mutate(() => previous({ data: { room_id: roomId, expected_version: version } }))
        }
      >
        <SkipBack className="size-4" aria-hidden="true" /> Previous
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          run.mutate(() =>
            advance({ data: { room_id: roomId, cause: "next", expected_version: version } }),
          )
        }
      >
        <SkipForward className="size-4" aria-hidden="true" /> Next
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          run.mutate(() => restart({ data: { room_id: roomId, expected_version: version } }))
        }
      >
        <RotateCcw className="size-4" aria-hidden="true" /> Restart track
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          run.mutate(() =>
            repeat({
              data: { room_id: roomId, mode: nextRepeatMode(settings?.repeat_mode ?? "off") },
            }),
          )
        }
      >
        <Repeat className="size-4" aria-hidden="true" />{" "}
        {repeatLabel(settings?.repeat_mode ?? "off")}
      </Button>
      <Button
        size="sm"
        variant={settings?.shuffle_enabled ? "default" : "outline"}
        disabled={busy}
        onClick={() =>
          run.mutate(() =>
            shuffle({ data: { room_id: roomId, enabled: !(settings?.shuffle_enabled ?? false) } }),
          )
        }
      >
        <Shuffle className="size-4" aria-hidden="true" /> Shuffle
      </Button>
    </div>
  ) : null;

  const renderItem = (item: QueueItem, index: number, list: QueueItem[]) => (
    <li
      key={item.id}
      className="flex items-center gap-3 rounded-lg border border-border bg-card/60 p-2"
    >
      {item.thumbnail_url ? (
        <img
          src={item.thumbnail_url}
          alt=""
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          className="h-10 w-16 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-10 w-16 shrink-0 rounded bg-muted" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title ?? item.provider_media_id}</p>
        <p className="text-xs text-muted-foreground">
          {item.status === "playing"
            ? "Now playing"
            : item.status === "suggested"
              ? "Suggested"
              : "Up next"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.status === "suggested" && canManage ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Approve track"
              disabled={busy}
              onClick={() => run.mutate(() => approve({ data: { item_id: item.id } }))}
            >
              <Check className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Reject track"
              disabled={busy}
              onClick={() => run.mutate(() => reject({ data: { item_id: item.id } }))}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </>
        ) : null}
        {item.status === "queued" && canManage ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Move up"
              disabled={busy || index === 0}
              onClick={() =>
                run.mutate(() =>
                  move({
                    data: {
                      item_id: item.id,
                      target_index: moveTargetIndex(index, -1, list.length),
                      expected_queue_version: queueVersion ?? 0,
                    },
                  }),
                )
              }
            >
              <ChevronUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Move down"
              disabled={busy || index === list.length - 1}
              onClick={() =>
                run.mutate(() =>
                  move({
                    data: {
                      item_id: item.id,
                      target_index: moveTargetIndex(index, 1, list.length),
                      expected_queue_version: queueVersion ?? 0,
                    },
                  }),
                )
              }
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
          </>
        ) : null}
        {canRemoveItem(item, userId, canManage) ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Remove track"
            disabled={busy}
            onClick={() => run.mutate(() => remove({ data: { item_id: item.id } }))}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </li>
  );

  return (
    <>
      <WatchTogether
        roomId={roomId}
        userId={userId}
        canControl={canManage}
        roomActive={roomActive}
        heading="Listen together"
        audioMode
        {...(roomActive ? { onTrackEnded } : {})}
        transport={transport}
      />


      <section className="surface-panel mt-8 p-5" aria-labelledby="queue-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="queue-heading" className="flex items-center gap-2 text-lg font-semibold">
              <ListMusic className="size-5" aria-hidden="true" /> Queue
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {modeLabel(settings?.queue_mode ?? "host_only")} ·{" "}
              {queue.connected ? "Live" : "Reconnecting"}
            </p>
          </div>
          <Badge variant="secondary">
            {sections.upNext.length} up next
            {sections.suggestions.length ? ` · ${sections.suggestions.length} pending` : ""}
          </Badge>
        </div>

        {canManage ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {MODES.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={settings?.queue_mode === value ? "default" : "outline"}
                disabled={busy}
                onClick={() => run.mutate(() => mode({ data: { room_id: roomId, mode: value } }))}
              >
                {modeLabel(value)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || sections.upNext.length + sections.suggestions.length === 0}
              onClick={() =>
                run.mutate(() =>
                  clear({ data: { room_id: roomId, expected_queue_version: queueVersion } }),
                )
              }
            >
              <Trash2 className="size-4" aria-hidden="true" /> Clear queue
            </Button>
          </div>
        ) : null}

        {roomActive && intent !== "denied" ? (
          <div className="mt-4">
            <MediaSearchPanel
              onPick={onAddMedia}
              disabled={busy}
              actionLabel={intent === "suggest" ? "Suggest" : "Add to queue"}
            />
          </div>
        ) : (

          <p className="mt-4 text-xs text-muted-foreground">
            {roomActive
              ? "Only the host can add tracks in this room."
              : "This room is closed, so the queue is read-only."}
          </p>
        )}

        {canManage && (playlistsQuery.data?.length ?? 0) > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Load a playlist:</span>
            {playlistsQuery.data?.map((playlist) => (
              <Button
                key={playlist.id}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run.mutate(() =>
                    fromPlaylist({ data: { room_id: roomId, playlist_id: playlist.id } }),
                  )
                }
              >
                {playlist.name}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="mt-5 space-y-5">
          {sections.nowPlaying ? (
            <ul className="space-y-2">
              {renderItem(sections.nowPlaying, 0, [sections.nowPlaying])}
            </ul>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold">Up next</h3>
            {sections.upNext.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing queued yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {sections.upNext.map((item, index) => renderItem(item, index, sections.upNext))}
              </ul>
            )}
          </div>

          {sections.suggestions.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">Waiting for approval</h3>
              <ul className="mt-2 space-y-2">
                {sections.suggestions.map((item, index) =>
                  renderItem(item, index, sections.suggestions),
                )}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
