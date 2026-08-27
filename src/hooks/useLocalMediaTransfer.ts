import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDiagnostics,
  type DiagEvent,
  type PeerDiag,
} from "@/lib/local-media/diagnostics";
import { BUFFERED_HIGH_WATER, BUFFERED_LOW_WATER, CHUNK_BYTES } from "@/lib/local-media/limits";
import {
  clampResumePoint,
  describeResume,
  planResume,
  type PartialProgress,
  type ResumePoint,
} from "@/lib/local-media/resume";
import type { SignalEnvelope } from "@/lib/local-media/transport";

/**
 * Phase 7 — actual peer-to-peer delivery of the owner's selected files.
 *
 * The session row says *who* is sharing and *what* is playing; this hook moves
 * the bytes. The viewer is the offerer (it knows `session.owner_id`, so no peer
 * discovery is needed) and opens one ordered data channel. The owner answers
 * and streams every selected file over that channel with backpressure. Nothing
 * is uploaded: the bytes only ever exist in the sender's file handle and in the
 * receiver's in-memory blob, which is revoked when the session ends.
 *
 * Delivery is resumable: the viewer keeps the chunks it already received and,
 * on every (re)connection, asks the sharer to continue from the first missing
 * byte instead of restarting the file. Every negotiation step is recorded in an
 * in-memory diagnostics store for the room's troubleshooting panel.
 */

interface TransferArgs {
  sessionId: string | null;
  ownerId: string | null;
  isOwner: boolean;
  userId: string | undefined;
  /** Owner side only: the files the user picked. */
  files: File[];
  sendSignal: (peerId: string, envelope: SignalEnvelope) => Promise<void>;
  onSignal: (listener: (signal: SignalEnvelope & { sender_id: string }) => void) => () => void;
  ready: boolean;
}

export interface TransferResult {
  /** Viewer side: object URLs per shared item, filled in as they arrive. */
  urls: (string | null)[];
  /** 0..1 for the item currently being received (viewer) or sent (owner). */
  progress: number;
  status: "idle" | "connecting" | "receiving" | "sending" | "ready" | "failed";
  /** Human-readable reason shown when delivery fails. Null while healthy. */
  errorMessage: string | null;
  retry: () => void;
  /** True when partial bytes are held and a retry would resume, not restart. */
  canResume: boolean;
  /** Bytes already buffered for the item currently being received. */
  resumeBytes: number;
  /** Per-peer connection status: viewers for the sharer, the sharer for a viewer. */
  peers: PeerDiag[];
  /** Newest-first troubleshooting log. */
  events: DiagEvent[];
  clearLog: () => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

/** Re-send the offer while the sharer has not answered yet. */
const OFFER_RETRY_MS = 4000;
const MAX_OFFER_ATTEMPTS = 6;
/** No bytes at all within this window counts as a failed delivery. */
const STALL_TIMEOUT_MS = 45_000;
/** Diagnostics are mutated per chunk; publish them to React on a timer. */
const DIAG_FLUSH_MS = 600;
/** Older viewers never send a resume request; start from scratch after this. */
const RESUME_WAIT_MS = 1500;
/** Automatic resume attempts after a dropped transfer, before asking the user. */
const AUTO_RESUME_LIMIT = 3;
const AUTO_RESUME_DELAY_MS = 4000;

type Header = {
  file: { index: number; size: number; mime: string; count: number; offset?: number };
};
type Footer = { fileEnd: number };
type Unavailable = { unavailable: true };
type ResumeRequest = { resume: ResumePoint };

function isHeader(value: unknown): value is Header {
  return Boolean(value && typeof value === "object" && "file" in (value as object));
}
function isFooter(value: unknown): value is Footer {
  return Boolean(value && typeof value === "object" && "fileEnd" in (value as object));
}
function isUnavailable(value: unknown): value is Unavailable {
  return Boolean(value && typeof value === "object" && "unavailable" in (value as object));
}
function isResumeRequest(value: unknown): value is ResumeRequest {
  return Boolean(value && typeof value === "object" && "resume" in (value as object));
}

interface PartialFile {
  chunks: ArrayBuffer[];
  received: number;
  size: number;
  mime: string;
  complete: boolean;
}

export function useLocalMediaTransfer(args: TransferArgs): TransferResult {
  const { sessionId, ownerId, isOwner, userId, files, sendSignal, onSignal, ready } = args;

  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<TransferResult["status"]>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [peers, setPeers] = useState<PeerDiag[]>([]);
  const [events, setEvents] = useState<DiagEvent[]>([]);
  const [resumeBytes, setResumeBytes] = useState(0);

  const filesRef = useRef(files);
  filesRef.current = files;
  const sendRef = useRef(sendSignal);
  sendRef.current = sendSignal;
  const urlsRef = useRef<(string | null)[]>([]);
  const diagRef = useRef(createDiagnostics());
  /** Viewer: partially received items, deliberately kept across reconnects. */
  const partialsRef = useRef(new Map<number, PartialFile>());
  const itemCountRef = useRef(0);
  const autoResumeRef = useRef(0);

  /** Publish diagnostics on a timer: chunk counters change far too often. */
  useEffect(() => {
    let lastVersion = -1;
    const timer = setInterval(() => {
      const version = diagRef.current.version();
      if (version === lastVersion) return;
      lastVersion = version;
      const snapshot = diagRef.current.snapshot();
      setEvents(snapshot.events);
      setPeers(snapshot.peers);
    }, DIAG_FLUSH_MS);
    return () => clearInterval(timer);
  }, []);

  const clearLog = useCallback(() => {
    diagRef.current.clear();
    setEvents([]);
    setPeers([]);
  }, []);

  const releaseUrls = useCallback(() => {
    urlsRef.current.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    urlsRef.current = [];
    setUrls([]);
  }, []);

  /** A new session invalidates every buffered byte from the previous one. */
  useEffect(() => {
    return () => {
      partialsRef.current.clear();
      itemCountRef.current = 0;
      autoResumeRef.current = 0;
      setResumeBytes(0);
      releaseUrls();
    };
  }, [sessionId, releaseUrls]);

  const retry = useCallback(() => {
    diagRef.current.log("info", "Retry requested — resuming from the last received byte");
    setErrorMessage(null);
    setAttempt((value) => value + 1);
  }, []);

  const fail = useCallback((message: string, peerId: string | null = null) => {
    diagRef.current.log("error", message, peerId);
    setStatus("failed");
    setErrorMessage(message);
  }, []);

  /** Owner: answer incoming offers and stream every file over the channel. */
  useEffect(() => {
    if (!ready || !sessionId || !isOwner) return;
    const diag = diagRef.current;
    const peerMap = new Map<string, RTCPeerConnection>();
    let disposed = false;
    diag.log("info", "Sharing session live — waiting for viewers to request media");

    const streamFiles = async (channel: RTCDataChannel, peerId: string, from: ResumePoint) => {
      const list = filesRef.current;
      diag.peer(peerId, "viewer", { channelState: channel.readyState });
      if (list.length === 0) {
        // The sharer reloaded or lost the file handle: tell the viewer plainly
        // instead of leaving them on an endless spinner.
        diag.peer(peerId, "viewer", { lastReason: "No file handle on this device" });
        diag.log("warn", "Viewer asked for media but no file is selected here", peerId);
        if (channel.readyState === "open") {
          channel.send(JSON.stringify({ unavailable: true } satisfies Unavailable));
        }
        return;
      }
      const start = clampResumePoint(from, list.length, list[Math.min(from.index, list.length - 1)]!.size);
      setStatus("sending");
      diag.log("info", describeResume(start, list[start.index]!.size), peerId);
      for (let index = start.index; index < list.length; index += 1) {
        const file = list[index]!;
        if (disposed || channel.readyState !== "open") return;
        let offset = index === start.index ? Math.min(start.offset, file.size) : 0;
        channel.send(
          JSON.stringify({
            file: { index, size: file.size, mime: file.type, count: list.length, offset },
          } satisfies Header),
        );
        while (offset < file.size) {
          if (disposed || channel.readyState !== "open") return;
          while (channel.bufferedAmount > BUFFERED_HIGH_WATER) {
            await new Promise<void>((resolve) => {
              const onLow = () => {
                channel.removeEventListener("bufferedamountlow", onLow);
                resolve();
              };
              channel.addEventListener("bufferedamountlow", onLow);
              setTimeout(onLow, 250);
            });
            if (disposed || channel.readyState !== "open") return;
          }
          const end = Math.min(offset + CHUNK_BYTES, file.size);
          const buffer = await file.slice(offset, end).arrayBuffer();
          channel.send(buffer);
          diag.bumpChunk(peerId, "viewer", buffer.byteLength);
          offset = end;
          setProgress(offset / Math.max(1, file.size));
        }
        channel.send(JSON.stringify({ fileEnd: index } satisfies Footer));
        diag.log("info", `File ${index + 1}/${list.length} sent`, peerId);
      }
      if (!disposed) setStatus("ready");
    };

    const attachChannel = (channel: RTCDataChannel, peerId: string) => {
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = BUFFERED_LOW_WATER;
      let started = false;
      let waitTimer: ReturnType<typeof setTimeout> | null = null;

      const begin = (from: ResumePoint) => {
        if (started || disposed) return;
        started = true;
        if (waitTimer) clearTimeout(waitTimer);
        void streamFiles(channel, peerId, from);
      };

      channel.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const parsed: unknown = JSON.parse(event.data);
          if (isResumeRequest(parsed)) {
            diag.log(
              "info",
              `Viewer asked to resume at item ${parsed.resume.index + 1}, byte ${parsed.resume.offset}`,
              peerId,
            );
            begin(parsed.resume);
          }
        } catch {
          // Control messages are best-effort; ignore malformed frames.
        }
      };
      channel.onclose = () => {
        diag.peer(peerId, "viewer", { channelState: "closed" });
        diag.log("warn", "Data channel closed", peerId);
      };
      channel.onerror = () => {
        diag.peer(peerId, "viewer", { lastReason: "Data channel error" });
        diag.log("error", "Data channel error while sending", peerId);
      };
      const armFallback = () => {
        // Viewers that never ask (old clients) still get the whole thing.
        waitTimer = setTimeout(() => begin({ index: 0, offset: 0 }), RESUME_WAIT_MS);
      };
      if (channel.readyState === "open") armFallback();
      channel.onopen = () => {
        diag.log("info", "Data channel open — awaiting resume point", peerId);
        armFallback();
      };
    };

    const unsubscribe = onSignal((signal) => {
      const peerId = signal.sender_id;
      if (!peerId || peerId === userId) return;
      void (async () => {
        if (signal.kind === "offer") {
          const previous = peerMap.get(peerId);
          if (previous) {
            diag.log("warn", "New offer received — replacing previous connection", peerId);
            diag.peer(peerId, "viewer", { lastReason: "Viewer re-offered (reconnect)" });
            previous.close();
          }
          const existingOffers = diag
            .snapshot()
            .peers.find((entry) => entry.peerId === peerId)?.offersReceived;
          diag.peer(peerId, "viewer", { offersReceived: (existingOffers ?? 0) + 1 });
          diag.log("info", "Offer received from viewer", peerId);
          const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
          peerMap.set(peerId, pc);
          pc.onconnectionstatechange = () => {
            diag.peer(peerId, "viewer", { connectionState: pc.connectionState });
            diag.log(
              pc.connectionState === "failed" ? "error" : "info",
              `Peer connection: ${pc.connectionState}`,
              peerId,
            );
          };
          pc.oniceconnectionstatechange = () => {
            diag.peer(peerId, "viewer", { iceState: pc.iceConnectionState });
          };
          pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            void sendRef.current(peerId, {
              kind: "ice",
              payload: { candidate: event.candidate.toJSON() as unknown as Record<string, unknown> },
            });
          };
          pc.ondatachannel = (event) => attachChannel(event.channel, peerId);
          await pc.setRemoteDescription({
            type: "offer",
            sdp: String(signal.payload["sdp"] ?? ""),
          });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendRef.current(peerId, {
            kind: "answer",
            payload: { sdp: answer.sdp ?? "", type: "answer" },
          });
          diag.peer(peerId, "viewer", { answered: true });
          diag.log("info", "Answer sent to viewer", peerId);
          return;
        }
        const pc = peerMap.get(peerId);
        if (!pc) return;
        if (signal.kind === "ice" && signal.payload["candidate"]) {
          await pc
            .addIceCandidate(signal.payload["candidate"] as RTCIceCandidateInit)
            .catch(() => null);
        } else if (signal.kind === "bye") {
          diag.log("info", "Viewer left the transfer", peerId);
          pc.close();
          peerMap.delete(peerId);
          diag.drop(peerId);
        }
      })().catch(() => {
        diag.log("error", "Failed to negotiate with viewer", peerId);
      });
    });

    return () => {
      disposed = true;
      unsubscribe();
      peerMap.forEach((pc) => pc.close());
      peerMap.clear();
      diag.log("info", "Sharing stopped — all viewer connections closed");
      setStatus("idle");
      setProgress(0);
    };
  }, [ready, sessionId, isOwner, userId, onSignal]);

  /** Viewer: offer to the owner and rebuild each file as it streams in. */
  useEffect(() => {
    if (!ready || !sessionId || isOwner || !ownerId) return;
    const diag = diagRef.current;
    const partials = partialsRef.current;
    let disposed = false;
    setStatus("connecting");
    setErrorMessage(null);
    diag.peer(ownerId, "sharer", { lastReason: attempt > 0 ? "Reconnecting to resume" : null });
    diag.log("info", "Connecting to the sharer's device", ownerId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const pending: RTCIceCandidateInit[] = [];
    let remoteSet = false;
    let answered = false;
    let lastActivity = Date.now();
    let current: number | null = null;

    const snapshotProgress = (): PartialProgress[] =>
      [...partials.entries()].map(([index, item]) => ({
        index,
        received: item.received,
        complete: item.complete,
      }));

    const channel = pc.createDataChannel("local-media", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      lastActivity = Date.now();
      diag.peer(ownerId, "sharer", { channelState: "open" });
      const point = planResume(snapshotProgress(), itemCountRef.current);
      setResumeBytes(point.offset);
      diag.log(
        "info",
        point.offset > 0
          ? `Asking the sharer to resume item ${point.index + 1} at byte ${point.offset}`
          : "Data channel open — requesting media from the start",
        ownerId,
      );
      channel.send(JSON.stringify({ resume: point } satisfies ResumeRequest));
      setStatus("receiving");
    };
    channel.onmessage = (event) => {
      lastActivity = Date.now();
      if (typeof event.data === "string") {
        const parsed: unknown = JSON.parse(event.data);
        if (isUnavailable(parsed)) {
          fail("The sharer's device no longer has this file. Ask them to pick it again.", ownerId);
          return;
        }
        if (isHeader(parsed)) {
          const meta = parsed.file;
          itemCountRef.current = meta.count;
          current = meta.index;
          const existing = partials.get(meta.index);
          const resumedAt = meta.offset ?? 0;
          if (!existing || resumedAt === 0 || existing.received !== resumedAt) {
            // Either a fresh item, or the sharer restarted it: drop stale bytes
            // so the rebuilt blob can never be a mix of two streams.
            if (existing && resumedAt !== existing.received) {
              diag.log("warn", "Sharer restarted this item — discarding partial bytes", ownerId);
            }
            partials.set(meta.index, {
              chunks: [],
              received: resumedAt === 0 ? 0 : 0,
              size: meta.size,
              mime: meta.mime,
              complete: false,
            });
          } else {
            existing.size = meta.size;
            existing.mime = meta.mime;
            diag.log(
              "info",
              `Resuming item ${meta.index + 1} at ${Math.round((resumedAt / Math.max(1, meta.size)) * 100)}%`,
              ownerId,
            );
          }
          setUrls((prev) => {
            const next = [...prev];
            while (next.length < meta.count) next.push(null);
            return next;
          });
          setResumeBytes(partials.get(meta.index)?.received ?? 0);
          setErrorMessage(null);
          setStatus("receiving");
          const held = partials.get(meta.index)!;
          setProgress(Math.min(1, held.received / Math.max(1, meta.size)));
        } else if (isFooter(parsed)) {
          const index = parsed.fileEnd;
          const item = partials.get(index);
          if (!item) return;
          const blob = new Blob(item.chunks, {
            type: item.mime || "application/octet-stream",
          });
          const url = URL.createObjectURL(blob);
          item.complete = true;
          urlsRef.current[index] = url;
          setUrls((prev) => {
            const next = [...prev];
            while (next.length <= index) next.push(null);
            next[index] = url;
            return next;
          });
          diag.log("info", `File ${index + 1} received in full`, ownerId);
          current = null;
          autoResumeRef.current = 0;
          setResumeBytes(0);
          setProgress(1);
          setErrorMessage(null);
          setStatus("ready");
        }
        return;
      }
      const buffer = event.data as ArrayBuffer;
      if (current === null) return;
      const item = partials.get(current);
      if (!item) return;
      item.chunks.push(buffer);
      item.received += buffer.byteLength;
      diag.bumpChunk(ownerId, "sharer", buffer.byteLength);
      setResumeBytes(item.received);
      setProgress(Math.min(1, item.received / Math.max(1, item.size)));
    };
    channel.onerror = () => {
      diag.peer(ownerId, "sharer", { lastReason: "Data channel error" });
      fail("The media stream was interrupted. Resuming from where it stopped…", ownerId);
    };
    channel.onclose = () => {
      diag.peer(ownerId, "sharer", { channelState: "closed" });
      if (disposed || urlsRef.current.some(Boolean)) return;
      diag.peer(ownerId, "sharer", { lastReason: "Channel closed before media arrived" });
      fail("The sharer's connection closed before the media arrived.", ownerId);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void sendRef.current(ownerId, {
        kind: "ice",
        payload: { candidate: event.candidate.toJSON() as unknown as Record<string, unknown> },
      });
    };
    pc.oniceconnectionstatechange = () => {
      diag.peer(ownerId, "sharer", { iceState: pc.iceConnectionState });
    };
    pc.onconnectionstatechange = () => {
      diag.peer(ownerId, "sharer", { connectionState: pc.connectionState });
      diag.log(
        pc.connectionState === "failed" ? "error" : "info",
        `Peer connection: ${pc.connectionState}`,
        ownerId,
      );
      if (pc.connectionState === "failed") {
        diag.peer(ownerId, "sharer", { lastReason: "ICE negotiation failed on this network" });
        fail("Couldn't reach the sharer's device on this network.", ownerId);
      }
    };

    const unsubscribe = onSignal((signal) => {
      if (signal.sender_id !== ownerId) return;
      void (async () => {
        if (signal.kind === "answer") {
          if (remoteSet) return; // ignore duplicate answers from offer retries
          await pc.setRemoteDescription({
            type: "answer",
            sdp: String(signal.payload["sdp"] ?? ""),
          });
          remoteSet = true;
          answered = true;
          lastActivity = Date.now();
          diag.peer(ownerId, "sharer", { answered: true });
          diag.log("info", "Answer received from the sharer", ownerId);
          for (const candidate of pending.splice(0)) {
            await pc.addIceCandidate(candidate).catch(() => null);
          }
        } else if (signal.kind === "ice" && signal.payload["candidate"]) {
          const candidate = signal.payload["candidate"] as RTCIceCandidateInit;
          if (remoteSet) await pc.addIceCandidate(candidate).catch(() => null);
          else pending.push(candidate);
        }
      })().catch(() => fail("Couldn't negotiate the media connection.", ownerId));
    });

    // The sharer may still be joining, and signals are consumed on read, so a
    // single offer can be missed. Re-offer until the sharer answers.
    let offers = 0;
    const sendOffer = async () => {
      if (disposed || answered) return;
      offers += 1;
      const offer = await pc.createOffer();
      if (pc.signalingState === "stable" || pc.signalingState === "have-local-offer") {
        await pc.setLocalDescription(offer);
      }
      if (disposed) return;
      await sendRef.current(ownerId, {
        kind: "offer",
        payload: { sdp: offer.sdp ?? "", type: "offer" },
      });
      diag.peer(ownerId, "sharer", { offersSent: offers });
      diag.log("info", `Offer sent to the sharer (attempt ${offers})`, ownerId);
    };
    void sendOffer().catch(() => fail("Couldn't ask the sharer for the media.", ownerId));
    const offerTimer = setInterval(() => {
      if (answered || offers >= MAX_OFFER_ATTEMPTS) {
        if (!answered && offers >= MAX_OFFER_ATTEMPTS) {
          diag.peer(ownerId, "sharer", { lastReason: "No answer after 6 offers" });
          fail(
            "The sharer's device didn't respond. Ask them to keep the app open, then retry.",
            ownerId,
          );
        }
        clearInterval(offerTimer);
        return;
      }
      diag.log("warn", "No answer yet — re-sending offer", ownerId);
      void sendOffer().catch(() => null);
    }, OFFER_RETRY_MS);

    const stallTimer = setInterval(() => {
      if (disposed) return;
      if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
        diag.peer(ownerId, "sharer", { lastReason: "No data for 45s" });
        fail("The media stream stalled. Reconnect to resume where it stopped.", ownerId);
        clearInterval(stallTimer);
      }
    }, 5000);

    return () => {
      disposed = true;
      clearInterval(offerTimer);
      clearInterval(stallTimer);
      unsubscribe();
      void sendRef.current(ownerId, { kind: "bye", payload: {} }).catch(() => null);
      try {
        channel.close();
        pc.close();
      } catch {
        // Teardown is best-effort.
      }
      diag.log("info", "Transfer connection closed (buffered bytes kept for resume)", ownerId);
      setStatus("idle");
      setProgress(0);
    };
  }, [ready, sessionId, isOwner, ownerId, onSignal, fail, attempt]);

  /** A dropped transfer with buffered bytes resumes itself a few times. */
  useEffect(() => {
    if (isOwner || status !== "failed") return;
    if (autoResumeRef.current >= AUTO_RESUME_LIMIT) return;
    const timer = setTimeout(() => {
      autoResumeRef.current += 1;
      diagRef.current.log(
        "warn",
        `Auto-resume attempt ${autoResumeRef.current}/${AUTO_RESUME_LIMIT}`,
      );
      setErrorMessage(null);
      setAttempt((value) => value + 1);
    }, AUTO_RESUME_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isOwner, status]);

  const canResume = resumeBytes > 0;

  return {
    urls,
    progress,
    status,
    errorMessage,
    retry,
    canResume,
    resumeBytes,
    peers,
    events,
    clearLog,
  };
}
