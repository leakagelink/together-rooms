import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import { isNewerState, type PlaybackState } from "@/lib/playback-sync";
import { getServerTime } from "@/lib/playback.functions";

const PLAYBACK_COLUMNS =
  "room_id, provider, provider_media_id, title, thumbnail_url, playback_status, position_seconds, playback_started_at, version, controlled_by, updated_at";

function toState(row: unknown): PlaybackState | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    ...(r as unknown as PlaybackState),
    position_seconds: Number(r["position_seconds"] ?? 0),
    version: Number(r["version"] ?? 0),
  };
}

export interface RoomPlaybackState {
  state: PlaybackState | null;
  isPending: boolean;
  isError: boolean;
  /** postgres_changes transport state for room_playback_state. */
  connected: boolean;
  authorized: boolean;
  /** Client clock correction, in ms: serverNow - clientNow. */
  clockOffsetMs: number;
  /** Server-corrected wall clock, used for expected-position arithmetic. */
  now: () => number;
  resync: () => void;
}

/**
 * Database-backed playback state for a room.
 *
 * - One stable postgres_changes subscription per (room, viewer). Playback
 *   updates never recreate the channel and never refetch the room.
 * - Rows are applied only when `version` is strictly greater than what we
 *   hold, so a delayed or duplicated realtime event cannot resurrect older
 *   state (out-of-order protection).
 * - Reconnect and tab-resume trigger a single authoritative re-read.
 */
export function useRoomPlayback(roomId: string, userId: string | undefined): RoomPlaybackState {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  const query = useQuery({
    queryKey: queryKeys.playback.state(roomId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_playback_state")
        .select(PLAYBACK_COLUMNS)
        .eq("room_id", roomId)
        .maybeSingle();
      if (error) throw error;
      return toState(data);
    },
    enabled: Boolean(roomId && userId),
  });

  // Measure the client↔server clock offset once per mount (and on resync).
  const measureClock = useCallback(async () => {
    const sent = Date.now();
    try {
      const res = await getServerTime();
      const received = Date.now();
      const rtt = received - sent;
      const serverNow = Date.parse(res.now) + rtt / 2;
      setClockOffsetMs(serverNow - received);
    } catch {
      /* keep the previous offset; expected position degrades gracefully */
    }
  }, []);

  useEffect(() => {
    if (userId) void measureClock();
  }, [measureClock, userId]);

  const applyRow = useCallback(
    (row: unknown) => {
      const incoming = toState(row);
      if (!incoming) return;
      queryClient.setQueryData<PlaybackState | null>(queryKeys.playback.state(roomId), (prev) =>
        isNewerState(prev ?? null, incoming) ? incoming : (prev ?? null),
      );
    },
    [queryClient, roomId],
  );

  const applyRef = useRef(applyRow);
  applyRef.current = applyRow;

  const resync = useCallback(() => {
    void measureClock();
    void queryClient.invalidateQueries({ queryKey: queryKeys.playback.state(roomId) });
  }, [measureClock, queryClient, roomId]);

  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  useEffect(() => {
    if (!roomId || !userId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    void (async () => {
      const { data: allowed, error } = await supabase.rpc("authorize_room_channel", {
        _room_id: roomId,
      });
      if (cancelled) return;
      if (error || allowed !== true) {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);

      channel = supabase
        .channel(`room-playback:${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_playback_state",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") {
              queryClient.setQueryData(queryKeys.playback.state(roomId), null);
              return;
            }
            applyRef.current(payload.new);
          },
        )
        .subscribe((status) => {
          if (cancelled) return;
          const live = status === "SUBSCRIBED";
          setConnected(live);
          if (live) resyncRef.current();
        });
    })();

    const onWake = () => {
      if (document.visibilityState === "visible") resyncRef.current();
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
  }, [applyRow, queryClient, roomId, userId]);

  const now = useCallback(() => Date.now() + clockOffsetMs, [clockOffsetMs]);

  return {
    state: query.data ?? null,
    isPending: query.isPending,
    isError: query.isError,
    connected,
    authorized,
    clockOffsetMs,
    now,
    resync,
  };
}
