import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import { track } from "@/lib/analytics";
import {
  callDurationBucket,
  participantBucket,
  sanitizeCallProperties,
} from "@/lib/calls/analytics-safety";
import {
  CALL_GRANT_REFRESH_MARGIN_SECONDS,
  CALL_HEARTBEAT_MS,
  CALL_SIGNAL_POLL_MS,
} from "@/lib/calls/limits";
import {
  isLiveSession,
  shouldInitiateOffer,
  type CallConnectionState,
  type CallMode,
  type CallParticipant,
  type CallSession,
} from "@/lib/calls/media-state";
import {
  CallMeshTransport,
  type CallSignalEnvelope,
  type CallTransportCredential,
} from "@/lib/calls/transport";
import {
  releaseStream,
  requestCallMedia,
  supportsRealtimeMedia,
  type CallDeviceFailure,
} from "@/lib/calls/capability";
import {
  callHeartbeat,
  endCallSession,
  fetchCallSignals,
  getCallSnapshot,
  issueCallGrant,
  joinCallSession,
  leaveCallSession,
  postCallSignal,
  setCallMediaState,
  setCallSettings,
  startCallSession,
} from "@/lib/calls.functions";

const SESSION_COLUMNS =
  "id, room_id, started_by, call_mode, session_status, allow_relay, max_participants, version, expires_at, created_at";
const PARTICIPANT_COLUMNS =
  "user_id, mic_enabled, camera_enabled, connection_state, joined_at, left_at";

export interface CallSettings {
  control_mode: "host_only" | "collaborative";
  admission: "open_to_room" | "host_approval";
  allow_relay: boolean;
  max_voice_participants: number;
  max_video_participants: number;
}

export interface UseRoomCallResult {
  session: CallSession | null;
  participants: CallParticipant[];
  settings: CallSettings | null;
  /** True while this viewer is an admitted room member (realtime authorized). */
  authorized: boolean;
  connected: boolean;
  joined: boolean;
  supported: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  peerStates: Record<string, CallConnectionState>;
  deviceFailure: CallDeviceFailure | null;
  error: string | null;
  start: (mode: CallMode) => Promise<void>;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  endForEveryone: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  updateSettings: (input: Partial<CallSettings>) => Promise<void>;
}

function toSession(row: unknown): CallSession | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const status = r["session_status"];
  if (status !== "active" && status !== "starting") return null;
  return {
    ...(r as unknown as CallSession),
    version: Number(r["version"] ?? 0),
    max_participants: Number(r["max_participants"] ?? 0),
  };
}

/**
 * PHASE 8 — authoritative room call state.
 *
 * The database owns the session, the roster and every permission decision.
 * This hook mirrors that state over one realtime subscription per room, keeps
 * a short-lived transport credential fresh, relays signaling through
 * authenticated RPCs, and builds a WebRTC mesh for the live media itself.
 *
 * Access is never client-side: when the row ends/expires, membership is
 * revoked, or a credential stops being issued, the mesh is torn down and local
 * capture is stopped. Nothing is recorded, buffered or persisted anywhere.
 */
export function useRoomCall(
  roomId: string,
  userId: string | undefined,
  enabled: boolean,
): UseRoomCallResult {
  const queryClient = useQueryClient();
  const key = queryKeys.calls.snapshot(roomId);

  const [authorized, setAuthorized] = useState(true);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [settings, setSettings] = useState<CallSettings | null>(null);
  const [credential, setCredential] = useState<CallTransportCredential | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [peerStates, setPeerStates] = useState<Record<string, CallConnectionState>>({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [deviceFailure, setDeviceFailure] = useState<CallDeviceFailure | null>(null);
  const [error, setError] = useState<string | null>(null);

  const snapshotFn = useServerFn(getCallSnapshot);
  const startFn = useServerFn(startCallSession);
  const endFn = useServerFn(endCallSession);
  const joinFn = useServerFn(joinCallSession);
  const leaveFn = useServerFn(leaveCallSession);
  const mediaStateFn = useServerFn(setCallMediaState);
  const heartbeatFn = useServerFn(callHeartbeat);
  const grantFn = useServerFn(issueCallGrant);
  const signalFn = useServerFn(postCallSignal);
  const pollFn = useServerFn(fetchCallSignals);
  const settingsFn = useServerFn(setCallSettings);

  const supported = useMemo(() => supportsRealtimeMedia(), []);

  const sessionQuery = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error: dbError } = await supabase
        .from("room_call_sessions")
        .select(SESSION_COLUMNS)
        .eq("room_id", roomId)
        .in("session_status", ["starting", "active"])
        .maybeSingle();
      if (dbError) throw dbError;
      return toSession(data);
    },
    enabled: Boolean(enabled && roomId && userId),
  });

  const session = isLiveSession(sessionQuery.data ?? null) ? (sessionQuery.data ?? null) : null;
  const sessionId = session?.id ?? null;

  const participantsQuery = useQuery({
    queryKey: [...key, "participants", sessionId ?? "none"],
    queryFn: async () => {
      if (!sessionId) return [] as CallParticipant[];
      const { data, error: dbError } = await supabase
        .from("room_call_participants")
        .select(PARTICIPANT_COLUMNS)
        .eq("session_id", sessionId)
        .is("left_at", null)
        .order("joined_at", { ascending: true });
      if (dbError) throw dbError;
      return (data ?? []) as unknown as CallParticipant[];
    },
    enabled: Boolean(enabled && sessionId && userId),
  });

  const participants = useMemo(() => participantsQuery.data ?? [], [participantsQuery.data]);

  /** Realtime: one stable channel per (room, viewer), authorized server-side. */
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
        .channel(`call:${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_call_sessions",
            filter: `room_id=eq.${roomId}`,
          },
          () => void queryClient.invalidateQueries({ queryKey: key }),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_call_participants",
            filter: `room_id=eq.${roomId}`,
          },
          () => void queryClient.invalidateQueries({ queryKey: key }),
        )
        .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, roomId, userId, queryClient, key]);

  /** Bootstrap read: settings + current session for a late arrival. */
  useEffect(() => {
    if (!enabled || !roomId || !userId) return;
    void snapshotFn({ data: { room_id: roomId } })
      .then((result) => {
        if (!result.ok) return;
        setSettings({
          control_mode: result.control_mode as CallSettings["control_mode"],
          admission: result.admission as CallSettings["admission"],
          allow_relay: result.allow_relay,
          max_voice_participants: result.max_voice_participants,
          max_video_participants: result.max_video_participants,
        });
      })
      .catch(() => null);
  }, [enabled, roomId, userId, snapshotFn]);

  /** Credential lifecycle: only issued while the server still admits us. */
  useEffect(() => {
    if (!sessionId || !joined) {
      setCredential(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const result = await grantFn({ data: { session_id: sessionId } }).catch(() => null);
      if (cancelled) return;
      if (!result || !result.ok) {
        setCredential(null);
        return;
      }
      setCredential({
        token: result.token,
        relay_allowed: result.relay_allowed,
        expires_at: result.expires_at,
      });
    };
    void refresh();
    const timer = setInterval(() => void refresh(), CALL_GRANT_REFRESH_MARGIN_SECONDS * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, joined, grantFn]);

  /** Participant heartbeat: silence past the grace period drops us server-side. */
  useEffect(() => {
    if (!sessionId || !joined) return;
    const tick = () => void heartbeatFn({ data: { session_id: sessionId } }).catch(() => null);
    tick();
    const timer = setInterval(tick, CALL_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [sessionId, joined, heartbeatFn]);

  // ---- WebRTC mesh -------------------------------------------------------
  const meshRef = useRef<CallMeshTransport | null>(null);
  const credentialRef = useRef<CallTransportCredential | null>(null);
  credentialRef.current = credential;
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  const sendSignal = useCallback(
    async (peerId: string, envelope: CallSignalEnvelope) => {
      const cred = credentialRef.current;
      const sid = sessionIdRef.current;
      if (!cred || !sid) return;
      await signalFn({
        data: {
          session_id: sid,
          token: cred.token,
          recipient_id: peerId,
          kind: envelope.kind,
          payload: envelope.payload,
        },
      }).catch(() => null);
    },
    [signalFn],
  );

  useEffect(() => {
    if (!joined || !sessionId) return;
    const mesh = new CallMeshTransport(
      {
        sendSignal,
        onRemoteStream: (peerId, stream) =>
          setRemoteStreams((prev) => ({ ...prev, [peerId]: stream })),
        onPeerState: (peerId, state) => setPeerStates((prev) => ({ ...prev, [peerId]: state })),
        onPeerClosed: (peerId) => {
          setRemoteStreams((prev) => {
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
          setPeerStates((prev) => {
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
        },
      },
      undefined,
      session?.allow_relay ?? true,
    );
    meshRef.current = mesh;
    return () => {
      mesh.close();
      meshRef.current = null;
      setRemoteStreams({});
      setPeerStates({});
    };
  }, [joined, sessionId, sendSignal, session?.allow_relay]);

  /** Keep the mesh in step with the authoritative roster. */
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !joined || !userId) return;
    const roster = participants.map((p) => p.user_id).filter((id) => id !== userId);
    for (const peerId of roster) {
      if (mesh.hasPeer(peerId)) continue;
      if (shouldInitiateOffer(userId, peerId)) void mesh.offer(peerId);
    }
    for (const peerId of mesh.peerIds()) {
      if (!roster.includes(peerId)) mesh.closePeer(peerId);
    }
  }, [participants, joined, userId]);

  /** Signaling relay. Only delivered to us, only while our credential is valid. */
  useEffect(() => {
    if (!sessionId || !credential) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void pollFn({ data: { session_id: sessionId, token: credential.token } })
        .then((result) => {
          if (cancelled || !result.ok) return;
          const rows = Array.isArray(result.signals) ? result.signals : [];
          const mesh = meshRef.current;
          if (!mesh) return;
          for (const raw of rows) {
            const row = raw as unknown as {
              sender_id: string;
              kind: CallSignalEnvelope["kind"];
              payload: Record<string, unknown>;
            };
            void mesh.accept(row.sender_id, { kind: row.kind, payload: row.payload });
          }
        })
        .catch(() => null);
    }, CALL_SIGNAL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, credential, pollFn]);

  /** Session gone (ended, expired, revoked) → stop capture and tear the mesh down. */
  useEffect(() => {
    if (session) return;
    setJoined(false);
    meshRef.current?.close();
    setLocalStream((prev) => {
      releaseStream(prev);
      return null;
    });
  }, [session]);

  // Final safety net: never leave the mic/camera running on unmount.
  useEffect(
    () => () => {
      meshRef.current?.close();
      setLocalStream((prev) => {
        releaseStream(prev);
        return null;
      });
    },
    [],
  );

  const acquireMedia = useCallback(
    async (mode: CallMode, wantCamera: boolean) => {
      const { stream, failure } = await requestCallMedia({
        audio: true,
        video: mode === "video" && wantCamera,
      });
      setDeviceFailure(failure);
      if (stream) {
        setLocalStream((prev) => {
          releaseStream(prev);
          return stream;
        });
        meshRef.current?.setLocalStream(stream);
      }
      return stream;
    },
    [],
  );

  const join = useCallback(async () => {
    if (!session) return;
    setError(null);
    const result = await joinFn({
      data: { session_id: session.id, mic: micEnabled, camera: cameraEnabled },
    });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setJoined(true);
    await acquireMedia(session.call_mode, cameraEnabled);
    track(
      "call_joined",
      sanitizeCallProperties({
        call_mode: session.call_mode,
        participant_bucket: participantBucket(participants.length + 1),
      }),
    );
    await queryClient.invalidateQueries({ queryKey: key });
  }, [
    session,
    joinFn,
    micEnabled,
    cameraEnabled,
    acquireMedia,
    participants.length,
    queryClient,
    key,
  ]);

  const start = useCallback(
    async (mode: CallMode) => {
      setError(null);
      const result = await startFn({ data: { room_id: roomId, call_mode: mode } });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      track("call_started", sanitizeCallProperties({ call_mode: mode }));
      const joinResult = await joinFn({
        data: { session_id: result.session_id, mic: true, camera: false },
      });
      if (joinResult.ok) {
        setJoined(true);
        await acquireMedia(mode, false);
      }
      await queryClient.invalidateQueries({ queryKey: key });
    },
    [startFn, joinFn, roomId, acquireMedia, queryClient, key],
  );

  const leave = useCallback(async () => {
    const sid = sessionId;
    setJoined(false);
    meshRef.current?.close();
    setLocalStream((prev) => {
      releaseStream(prev);
      return null;
    });
    setCredential(null);
    if (sid) await leaveFn({ data: { session_id: sid } }).catch(() => null);
    track(
      "call_left",
      sanitizeCallProperties({
        duration_bucket: callDurationBucket(
          session ? (Date.now() - Date.parse(session.created_at)) / 1000 : null,
        ),
      }),
    );
    await queryClient.invalidateQueries({ queryKey: key });
  }, [sessionId, leaveFn, session, queryClient, key]);

  const endForEveryone = useCallback(async () => {
    if (!session) return;
    const result = await endFn({
      data: { session_id: session.id, expected_version: session.version },
    });
    if (!result.ok) setError(result.reason);
    setJoined(false);
    meshRef.current?.close();
    setLocalStream((prev) => {
      releaseStream(prev);
      return null;
    });
    track("call_ended", sanitizeCallProperties({ role: "host" }));
    await queryClient.invalidateQueries({ queryKey: key });
  }, [session, endFn, queryClient, key]);

  const toggleMic = useCallback(async () => {
    const next = !micEnabled;
    setMicEnabled(next);
    for (const track_ of localStream?.getAudioTracks() ?? []) track_.enabled = next;
    if (sessionId) await mediaStateFn({ data: { session_id: sessionId, mic: next } });
  }, [micEnabled, localStream, sessionId, mediaStateFn]);

  const toggleCamera = useCallback(async () => {
    if (!session || session.call_mode !== "video") return;
    const next = !cameraEnabled;
    setCameraEnabled(next);
    if (next) {
      await acquireMedia("video", true);
    } else {
      for (const track_ of localStream?.getVideoTracks() ?? []) {
        track_.stop();
      }
      const audioOnly = await requestCallMedia({ audio: true, video: false });
      if (audioOnly.stream) {
        setLocalStream((prev) => {
          releaseStream(prev);
          return audioOnly.stream;
        });
        meshRef.current?.setLocalStream(audioOnly.stream);
      }
    }
    await mediaStateFn({ data: { session_id: session.id, camera: next } });
  }, [session, cameraEnabled, localStream, acquireMedia, mediaStateFn]);

  const updateSettings = useCallback(
    async (input: Partial<CallSettings>) => {
      const result = await settingsFn({
        data: {
          room_id: roomId,
          ...(input.control_mode ? { control_mode: input.control_mode } : {}),
          ...(input.allow_relay != null ? { allow_relay: input.allow_relay } : {}),
          ...(input.max_voice_participants != null
            ? { max_voice: input.max_voice_participants }
            : {}),
          ...(input.max_video_participants != null
            ? { max_video: input.max_video_participants }
            : {}),
        },
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              control_mode: result.control_mode as CallSettings["control_mode"],
              allow_relay: result.allow_relay,
              max_voice_participants: result.max_voice_participants,
              max_video_participants: result.max_video_participants,
            }
          : prev,
      );
    },
    [settingsFn, roomId],
  );

  return {
    session,
    participants,
    settings,
    authorized,
    connected,
    joined,
    supported,
    micEnabled,
    cameraEnabled,
    localStream,
    remoteStreams,
    peerStates,
    deviceFailure,
    error,
    start,
    join,
    leave,
    endForEveryone,
    toggleMic,
    toggleCamera,
    updateSettings,
  };
}
