import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import { isNewerState, type PlaybackState } from "@/lib/playback-sync";
import {
  CLOCK_MAX_AGE_MS,
  shouldRefreshClock,
  type ClockRefreshReason,
} from "@/lib/playback-device";
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
  /** False when the viewer is not (or no longer) an admitted room member. */
  authorized: boolean;
  /** Client clock correction, in ms: serverNow - clientNow. */
  clockOffsetMs: number;
  /** Server-corrected wall clock, used for expected-position arithmetic. */
  now: () => number;
  /** Local-only reconciliation. Never writes to the database. */
  resync: (reason?: ClockRefreshReason) => void;
}

/**
 * Database-backed playback state for a room.
 *
 * - One stable postgres_changes subscription per (room, viewer). Playback
 *   updates never recreate the channel and never refetch the room.
 * - Rows are applied only when `version` is strictly greater than what we
 *   hold, so a delayed or duplicated realtime event cannot resurrect older
 *   state (out-of-order protection).
 * - Reconnect, app foreground and manual resync trigger one authoritative
 *   re-read plus a throttled clock re-measurement, and re-verify membership.
 *   Nothing here mutates authoritative state.
 */
export function useRoomPlayback(roomId: string, userId: string | undefined): RoomPlaybackState {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const lastClockMeasurement = useRef(0);

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

  /**
   * Measures the client↔server clock offset. Bounded by
   * `shouldRefreshClock`: initial load always measures; reconnect, foreground
   * and manual resync are throttled; a background interval only fires once the
   * offset is genuinely stale. Never per playback tick.
   */
  const measureClock = useCallback(async (reason: ClockRefreshReason) => {
    const since = lastClockMeasurement.current
      ? Date.now() - lastClockMeasurement.current
      : Number.POSITIVE_INFINITY;
    if (!shouldRefreshClock({ reason, msSinceLastMeasurement: since })) return;
    lastClockMeasurement.current = Date.now();
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

  /** Re-checks membership; a revoked member stops synchronizing entirely. */
  const verifyMembership = useCallback(async () => {
    const { data, error } = await supabase.rpc("authorize_room_channel", { _room_id: roomId });
    const ok = !error && data === true;
    setAuthorized(ok);
    return ok;
  }, [roomId]);

  const resync = useCallback(
    (reason: ClockRefreshReason = "manual_resync") => {
      void (async () => {
        const stillMember = await verifyMembership();
        if (!stillMember) return;
        await measureClock(reason);
        await queryClient.invalidateQueries({ queryKey: queryKeys.playback.state(roomId) });
      })();
    },
    [measureClock, queryClient, roomId, verifyMembership],
  );

  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  useEffect(() => {
    if (userId) void measureClock("initial");
  }, [measureClock, userId]);

  useEffect(() => {
    if (!roomId || !userId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    void (async () => {
      const allowed = await verifyMembership();
      if (cancelled || !allowed) return;

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
          if (live) resyncRef.current("reconnect");
        });
    })();

    // App foreground / network return: re-verify membership, refresh state,
    // and re-measure the clock (throttled). No duplicate subscription is made.
    const onWake = () => {
      if (document.visibilityState === "visible") resyncRef.current("foreground");
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);

    // Long sessions: bounded staleness check, not a polling loop.
    const clockTimer = setInterval(() => resyncRef.current("interval"), CLOCK_MAX_AGE_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      clearInterval(clockTimer);
      setConnected(false);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [applyRow, queryClient, roomId, userId, verifyMembership]);

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
