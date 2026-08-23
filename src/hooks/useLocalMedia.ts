import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import { track } from "@/lib/analytics";
import { durationBucket, sanitizeLocalMediaProperties } from "@/lib/local-media/analytics-safety";
import type { LocalMediaKind, LocalMediaTransportState } from "@/lib/local-media/capability";
import {
  GRANT_REFRESH_MARGIN_SECONDS,
  OWNER_GRACE_SECONDS,
  OWNER_HEARTBEAT_MS,
  SIGNAL_POLL_MS,
} from "@/lib/local-media/limits";
import {
  controlLocalMediaPlayback,
  endLocalMediaSession,
  fetchSignals,
  getLocalMediaSnapshot,
  heartbeatLocalMediaSession,
  issueTransportGrant,
  postSignal,
  reapLocalMediaOwnerAbsence,
  startLocalMediaSession,
} from "@/lib/local-media.functions";
import type { SignalEnvelope, TransportCredential } from "@/lib/local-media/transport";

export interface LocalMediaSession {
  id: string;
  room_id: string;
  owner_id: string;
  controller_id: string | null;
  media_kind: LocalMediaKind;
  mime_type: string | null;
  duration_seconds: number | null;
  item_count: number;
  current_index: number;
  status: "active" | "ended" | "expired";
  transport_state: LocalMediaTransportState;
  playback_status: "idle" | "ready" | "playing" | "paused" | "ended";
  position_seconds: number;
  playback_started_at: string | null;
  version: number;
  owner_seen_at: string;
  expires_at: string;
}

const SESSION_COLUMNS =
  "id, room_id, owner_id, controller_id, media_kind, mime_type, duration_seconds, item_count, current_index, status, transport_state, playback_status, position_seconds, playback_started_at, version, owner_seen_at, expires_at";

function toSession(row: unknown): LocalMediaSession | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r["status"] !== "active") return null;
  return {
    ...(r as unknown as LocalMediaSession),
    position_seconds: Number(r["position_seconds"] ?? 0),
    version: Number(r["version"] ?? 0),
    current_index: Number(r["current_index"] ?? 0),
  };
}

export interface UseLocalMediaResult {
  session: LocalMediaSession | null;
  isPending: boolean;
  /** True while the viewer is still an admitted member of the room. */
  authorized: boolean;
  connected: boolean;
  isOwner: boolean;
  transportState: LocalMediaTransportState;
  start: (input: {
    media_kind: LocalMediaKind;
    mime_type?: string;
    duration_seconds?: number;
    item_count?: number;
  }) => Promise<string | null>;
  end: () => Promise<void>;
  control: (input: {
    action: "play" | "pause" | "seek" | "set_index";
    position_seconds?: number;
    index?: number;
  }) => Promise<void>;
  /** Short-lived transport credential; refreshed automatically before expiry. */
  credential: TransportCredential | null;
  sendSignal: (peerId: string, envelope: SignalEnvelope) => Promise<void>;
  incoming: (SignalEnvelope & { sender_id: string })[];
  error: string | null;
}

/**
 * Phase 7 — authoritative local media session state for a room.
 *
 * The database row is the single source of truth for who is sharing, what is
 * playing and where. This hook mirrors it (one stable postgres_changes
 * subscription per room), applies versioned updates only when they are newer,
 * keeps a short-lived transport credential fresh, and relays signaling.
 *
 * When the session ends — owner stops, room closes, session expires, or the
 * owner goes silent past the grace period — the row stops being active, this
 * hook drops it, and every consumer tears playback down. There is no way for a
 * client to keep access after that: credentials are minted per session and the
 * server re-checks membership on every use.
 */
export function useLocalMedia(
  roomId: string,
  userId: string | undefined,
  enabled: boolean,
): UseLocalMediaResult {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [credential, setCredential] = useState<TransportCredential | null>(null);
  const [incoming, setIncoming] = useState<(SignalEnvelope & { sender_id: string })[]>([]);
  const [error, setError] = useState<string | null>(null);

  const snapshot = useServerFn(getLocalMediaSnapshot);
  const startFn = useServerFn(startLocalMediaSession);
  const endFn = useServerFn(endLocalMediaSession);
  const controlFn = useServerFn(controlLocalMediaPlayback);
  const heartbeatFn = useServerFn(heartbeatLocalMediaSession);
  const reapFn = useServerFn(reapLocalMediaOwnerAbsence);
  const grantFn = useServerFn(issueTransportGrant);
  const signalFn = useServerFn(postSignal);
  const pollFn = useServerFn(fetchSignals);

  const key = queryKeys.localMedia.session(roomId);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error: dbError } = await supabase
        .from("room_local_media_sessions")
        .select(SESSION_COLUMNS)
        .eq("room_id", roomId)
        .eq("status", "active")
        .maybeSingle();
      if (dbError) throw dbError;
      return toSession(data);
    },
    enabled: Boolean(enabled && roomId && userId),
  });

  const session = query.data ?? null;
  const isOwner = Boolean(session && userId && session.owner_id === userId);

  const applyRow = useCallback(
    (row: unknown) => {
      const next = toSession(row);
      queryClient.setQueryData<LocalMediaSession | null>(key, (prev) => {
        if (!next) return null; // ended/expired rows revoke access immediately
        if (prev && prev.id === next.id && next.version <= prev.version) return prev;
        return next;
      });
    },
    [queryClient, key],
  );
  const applyRef = useRef(applyRow);
  applyRef.current = applyRow;

  /** One stable subscription per (room, viewer). */
  useEffect(() => {
    if (!enabled || !roomId || !userId) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    void (async () => {
      const { data, error: rpcError } = await supabase.rpc("authorize_room_channel", {
        _room_id: roomId,
      });
      const ok = !rpcError && data === true;
      if (cancelled) return;
      setAuthorized(ok);
      if (!ok) return;

      channel = supabase
        .channel(`local-media:${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_local_media_sessions",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => applyRef.current(payload.new),
        )
        .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, roomId, userId]);

  /** Owner heartbeat: absence past the grace period ends the session server-side. */
  useEffect(() => {
    if (!session || !isOwner) return;
    const sessionId = session.id;
    const tick = () => void heartbeatFn({ data: { session_id: sessionId } }).catch(() => null);
    tick();
    const timer = setInterval(tick, OWNER_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [session, isOwner, heartbeatFn]);

  /** Viewers ask the server to reap a session whose owner has gone silent. */
  useEffect(() => {
    if (!session || isOwner) return;
    const sessionId = session.id;
    const timer = setInterval(() => {
      const silentFor = (Date.now() - Date.parse(session.owner_seen_at)) / 1000;
      if (silentFor <= OWNER_GRACE_SECONDS) return;
      void reapFn({ data: { session_id: sessionId } })
        .then(() => queryClient.invalidateQueries({ queryKey: key }))
        .catch(() => null);
    }, OWNER_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [session, isOwner, reapFn, queryClient, key]);

  /** Keep a valid, short-lived transport credential while a session is active. */
  useEffect(() => {
    if (!session) {
      setCredential(null);
      return;
    }
    let cancelled = false;
    const sessionId = session.id;

    const refresh = async () => {
      const result = await grantFn({ data: { session_id: sessionId } }).catch(() => null);
      if (cancelled) return;
      if (!result || !result.ok) {
        // A revoked member simply stops getting credentials.
        setCredential(null);
        return;
      }
      setCredential({
        token: result.token,
        role: result.role,
        relay_allowed: result.relay_allowed,
        expires_at: result.expires_at,
      });
    };

    void refresh();
    const timer = setInterval(
      () => void refresh(),
      Math.max(30, GRANT_REFRESH_MARGIN_SECONDS) * 1000,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, grantFn]);

  /** Signaling relay: authenticated, credential-bound, short-lived payloads. */
  useEffect(() => {
    if (!session || !credential) return;
    let cancelled = false;
    const sessionId = session.id;
    const timer = setInterval(() => {
      void pollFn({ data: { session_id: sessionId, token: credential.token } })
        .then((result) => {
          if (cancelled || !result.ok) return;
          const rows = Array.isArray(result.signals) ? result.signals : [];
          if (rows.length === 0) return;
          setIncoming(rows as unknown as (SignalEnvelope & { sender_id: string })[]);
        })
        .catch(() => null);
    }, SIGNAL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, credential, pollFn]);

  const sendSignal = useCallback(
    async (peerId: string, envelope: SignalEnvelope) => {
      if (!session || !credential) return;
      await signalFn({
        data: {
          session_id: session.id,
          token: credential.token,
          recipient_id: peerId,
          kind: envelope.kind,
          payload: envelope.payload,
        },
      });
    },
    [session, credential, signalFn],
  );

  const start = useCallback<UseLocalMediaResult["start"]>(
    async (input) => {
      setError(null);
      const result = await startFn({ data: { room_id: roomId, ...input } });
      if (!result.ok) {
        setError(result.reason);
        return null;
      }
      track(
        "local_media_session_started",
        sanitizeLocalMediaProperties({
          media_kind: input.media_kind,
          item_count: input.item_count ?? 1,
          duration_bucket: durationBucket(input.duration_seconds),
        }),
      );
      await queryClient.invalidateQueries({ queryKey: key });
      return result.session_id;
    },
    [startFn, roomId, queryClient, key],
  );

  const end = useCallback(async () => {
    if (!session) return;
    await endFn({ data: { session_id: session.id } });
    track(
      "local_media_session_ended",
      sanitizeLocalMediaProperties({ role: isOwner ? "owner" : "viewer" }),
    );
    queryClient.setQueryData(key, null);
    await queryClient.invalidateQueries({ queryKey: key });
  }, [session, endFn, queryClient, key, isOwner]);

  const control = useCallback<UseLocalMediaResult["control"]>(
    async (input) => {
      if (!session) return;
      setError(null);
      const result = await controlFn({
        data: {
          session_id: session.id,
          action: input.action,
          ...(input.position_seconds != null ? { position_seconds: input.position_seconds } : {}),
          ...(input.index != null ? { index: input.index } : {}),
          expected_version: session.version,
        },
      });
      if (!result.ok) {
        setError(result.reason);
        // Losing an optimistic-concurrency race just means re-reading truth.
        await queryClient.invalidateQueries({ queryKey: key });
        return;
      }
      // The RPC returns the authoritative fields; merge them onto the row we
      // already hold rather than trusting a partially-typed payload.
      queryClient.setQueryData<LocalMediaSession | null>(key, (prev) =>
        prev
          ? {
              ...prev,
              version: result.version,
              playback_status: result.playback_status as LocalMediaSession["playback_status"],
              position_seconds: result.position_seconds,
              playback_started_at: result.playback_started_at,
              current_index: result.current_index,
              transport_state: result.transport_state as LocalMediaTransportState,
            }
          : prev,
      );
    },
    [session, controlFn, queryClient, key],
  );

  // Session-scoped bootstrap read so a late joiner sees the current sharer.
  useEffect(() => {
    if (!enabled || !roomId || !userId) return;
    void snapshot({ data: { room_id: roomId } }).catch(() => null);
  }, [enabled, roomId, userId, snapshot]);

  const transportState = useMemo<LocalMediaTransportState>(
    () => session?.transport_state ?? "unavailable",
    [session],
  );

  return {
    session,
    isPending: query.isPending,
    authorized,
    connected,
    isOwner,
    transportState,
    start,
    end,
    control,
    credential,
    sendSignal,
    incoming,
    error,
  };
}
