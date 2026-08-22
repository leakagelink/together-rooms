import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { QueueSettings, QueueSnapshot } from "@/lib/queue-rules";

/**
 * Database-backed queue state.
 *
 * The queue snapshot comes from a SECURITY DEFINER read RPC (membership
 * enforced in SQL). One stable postgres_changes subscription per (room, viewer)
 * covers both the queue rows and the queue settings; every event simply
 * re-reads the authoritative snapshot, so ordering can never be inferred from
 * partial payloads.
 */
export interface RoomQueue {
  snapshot: QueueSnapshot | null;
  settings: QueueSettings | null;
  isPending: boolean;
  isError: boolean;
  connected: boolean;
  refresh: () => void;
}

const SETTINGS_COLUMNS = "queue_mode, repeat_mode, shuffle_enabled, queue_version";

export function useRoomQueue(roomId: string, userId: string | undefined): RoomQueue {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  const snapshotQuery = useQuery({
    queryKey: queryKeys.queue.snapshot(roomId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("queue_snapshot", { _room_id: roomId });
      if (error) throw error;
      return (data as unknown as QueueSnapshot | null) ?? null;
    },
    enabled: Boolean(roomId && userId),
  });

  const settingsQuery = useQuery({
    queryKey: queryKeys.queue.settings(roomId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_queue_settings")
        .select(SETTINGS_COLUMNS)
        .eq("room_id", roomId)
        .maybeSingle();
      if (error) throw error;
      return (data as QueueSettings | null) ?? null;
    },
    enabled: Boolean(roomId && userId),
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.queue.snapshot(roomId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.queue.settings(roomId) });
  }, [queryClient, roomId]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!roomId || !userId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    void (async () => {
      const { data, error } = await supabase.rpc("authorize_room_channel", { _room_id: roomId });
      if (cancelled || error || data !== true) return;

      channel = supabase
        .channel(`room-queue:${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_media_queue",
            filter: `room_id=eq.${roomId}`,
          },
          () => refreshRef.current(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_queue_settings",
            filter: `room_id=eq.${roomId}`,
          },
          () => refreshRef.current(),
        )
        .subscribe((status) => {
          if (cancelled) return;
          const live = status === "SUBSCRIBED";
          setConnected(live);
          // Reconnect catch-up: one authoritative re-read, no replay buffer.
          if (live) refreshRef.current();
        });
    })();

    const onWake = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      setConnected(false);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [roomId, userId]);

  return {
    snapshot: snapshotQuery.data ?? null,
    settings: settingsQuery.data ?? null,
    isPending: snapshotQuery.isPending || settingsQuery.isPending,
    isError: snapshotQuery.isError || settingsQuery.isError,
    connected,
    refresh,
  };
}
