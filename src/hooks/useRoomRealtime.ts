import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { parseRoomEvent, type PresenceStatus, type RoomEvent } from "@/lib/realtime/events";

export interface RoomRealtimeState {
  connected: boolean;
  /** Live presence, keyed by user id. Never authoritative for membership. */
  presence: Record<string, PresenceStatus>;
  /** Most recent room events, newest first (capped). */
  events: RoomEvent[];
  /** False when the database refused to authorize this room channel. */
  authorized: boolean;
}

const MAX_EVENTS = 30;

/**
 * Room-scoped realtime: Supabase Presence for who is currently connected, plus
 * a postgres_changes subscription on room_events for the authoritative event
 * stream. Database membership (room_members) remains the source of truth;
 * presence is advisory only.
 *
 * Reconnect: the Supabase client reconnects the socket automatically and
 * re-runs the `SUBSCRIBED` callback, which re-tracks presence. Events seen
 * during a gap are deduplicated by event id, and the caller refetches room
 * state on membership/lifecycle events.
 */
export function useRoomRealtime(
  roomId: string,
  userId: string | undefined,
  onRoomChanged?: () => void,
): RoomRealtimeState {
  const [connected, setConnected] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [presenceRaw, setPresenceRaw] = useState<Record<string, PresenceStatus>>({});
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const changedRef = useRef(onRoomChanged);
  changedRef.current = onRoomChanged;

  useEffect(() => {
    if (!roomId || !userId) return;

    const uid = userId;
    seenIds.current = new Set();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    // Database-backed authorization gate: the server decides whether this user
    // may observe the room at all. postgres_changes payloads are additionally
    // filtered by RLS on room_events / room_members.
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
      subscribe();
    })();

    function subscribe() {
      if (cancelled) return;
      channel = supabase.channel(`room:${roomId}`, {
        config: { presence: { key: uid } },
      });

      channel
        .on("presence", { event: "sync" }, () => {
          if (!channel) return;
          const state = channel.presenceState<{ status?: PresenceStatus }>();
          const next: Record<string, PresenceStatus> = {};
          for (const [key, metas] of Object.entries(state)) {
            next[key] = metas[0]?.status === "away" ? "away" : "online";
          }
          setPresenceRaw(next);
        })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "room_events",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const event = parseRoomEvent(payload.new);
            if (!event || seenIds.current.has(event.id)) return;
            seenIds.current.add(event.id);
            setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
            changedRef.current?.();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` },
          () => changedRef.current?.(),
        )
        .subscribe((status) => {
          if (cancelled) return;
          const isConnected = status === "SUBSCRIBED";
          setConnected(isConnected);
          if (isConnected) {
            void channel?.track({
              user_id: uid,
              status: "online",
              joined_at: new Date().toISOString(),
            });
          }
        });
    }

    return () => {
      cancelled = true;
      setConnected(false);
      setAuthorized(false);
      setPresenceRaw({});
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [roomId, userId]);

  const presence = useMemo(() => presenceRaw, [presenceRaw]);

  return { connected, presence, events, authorized };
}
