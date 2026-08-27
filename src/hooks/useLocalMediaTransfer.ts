import { useCallback, useEffect, useRef, useState } from "react";

import { BUFFERED_HIGH_WATER, BUFFERED_LOW_WATER, CHUNK_BYTES } from "@/lib/local-media/limits";
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

type Header = { file: { index: number; size: number; mime: string; count: number } };
type Footer = { fileEnd: number };
type Unavailable = { unavailable: true };

function isHeader(value: unknown): value is Header {
  return Boolean(value && typeof value === "object" && "file" in (value as object));
}
function isFooter(value: unknown): value is Footer {
  return Boolean(value && typeof value === "object" && "fileEnd" in (value as object));
}
function isUnavailable(value: unknown): value is Unavailable {
  return Boolean(value && typeof value === "object" && "unavailable" in (value as object));
}

export function useLocalMediaTransfer(args: TransferArgs): TransferResult {
  const { sessionId, ownerId, isOwner, userId, files, sendSignal, onSignal, ready } = args;

  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<TransferResult["status"]>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const filesRef = useRef(files);
  filesRef.current = files;
  const sendRef = useRef(sendSignal);
  sendRef.current = sendSignal;
  const urlsRef = useRef<(string | null)[]>([]);

  const releaseUrls = useCallback(() => {
    urlsRef.current.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    urlsRef.current = [];
    setUrls([]);
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  /** Owner: answer incoming offers and stream every file over the channel. */
  useEffect(() => {
    if (!ready || !sessionId || !isOwner) return;
    const peers = new Map<string, RTCPeerConnection>();
    let disposed = false;

    const streamFiles = async (channel: RTCDataChannel) => {
      const list = filesRef.current;
      setStatus("sending");
      for (let index = 0; index < list.length; index += 1) {
        const file = list[index]!;
        if (disposed || channel.readyState !== "open") return;
        channel.send(
          JSON.stringify({
            file: { index, size: file.size, mime: file.type, count: list.length },
          } satisfies Header),
        );
        let offset = 0;
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
          offset = end;
          setProgress(offset / Math.max(1, file.size));
        }
        channel.send(JSON.stringify({ fileEnd: index } satisfies Footer));
      }
      if (!disposed) setStatus("ready");
    };

    const unsubscribe = onSignal((signal) => {
      const peerId = signal.sender_id;
      if (!peerId || peerId === userId) return;
      void (async () => {
        if (signal.kind === "offer") {
          peers.get(peerId)?.close();
          const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
          peers.set(peerId, pc);
          pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            void sendRef.current(peerId, {
              kind: "ice",
              payload: { candidate: event.candidate.toJSON() as unknown as Record<string, unknown> },
            });
          };
          pc.ondatachannel = (event) => {
            const channel = event.channel;
            channel.binaryType = "arraybuffer";
            channel.bufferedAmountLowThreshold = BUFFERED_LOW_WATER;
            if (channel.readyState === "open") void streamFiles(channel);
            channel.onopen = () => void streamFiles(channel);
          };
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
          return;
        }
        const pc = peers.get(peerId);
        if (!pc) return;
        if (signal.kind === "ice" && signal.payload["candidate"]) {
          await pc
            .addIceCandidate(signal.payload["candidate"] as RTCIceCandidateInit)
            .catch(() => null);
        } else if (signal.kind === "bye") {
          pc.close();
          peers.delete(peerId);
        }
      })().catch(() => null);
    });

    return () => {
      disposed = true;
      unsubscribe();
      peers.forEach((pc) => pc.close());
      peers.clear();
      setStatus("idle");
      setProgress(0);
    };
  }, [ready, sessionId, isOwner, userId, onSignal]);

  /** Viewer: offer to the owner and rebuild each file as it streams in. */
  useEffect(() => {
    if (!ready || !sessionId || isOwner || !ownerId) return;
    let disposed = false;
    setStatus("connecting");

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const pending: RTCIceCandidateInit[] = [];
    let remoteSet = false;

    let chunks: ArrayBuffer[] = [];
    let header: Header["file"] | null = null;
    let received = 0;

    const channel = pc.createDataChannel("local-media", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.onopen = () => setStatus("receiving");
    channel.onmessage = (event) => {
      if (typeof event.data === "string") {
        const parsed: unknown = JSON.parse(event.data);
        if (isHeader(parsed)) {
          header = parsed.file;
          chunks = [];
          received = 0;
          setUrls((prev) => {
            const next = [...prev];
            while (next.length < parsed.file.count) next.push(null);
            return next;
          });
          setStatus("receiving");
        } else if (isFooter(parsed) && header) {
          const blob = new Blob(chunks, { type: header.mime || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const index = parsed.fileEnd;
          urlsRef.current[index] = url;
          setUrls((prev) => {
            const next = [...prev];
            while (next.length <= index) next.push(null);
            next[index] = url;
            return next;
          });
          chunks = [];
          header = null;
          received = 0;
          setProgress(1);
          setStatus("ready");
        }
        return;
      }
      const buffer = event.data as ArrayBuffer;
      chunks.push(buffer);
      received += buffer.byteLength;
      if (header) setProgress(Math.min(1, received / Math.max(1, header.size)));
    };
    channel.onerror = () => setStatus("failed");

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void sendRef.current(ownerId, {
        kind: "ice",
        payload: { candidate: event.candidate.toJSON() as unknown as Record<string, unknown> },
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") setStatus("failed");
    };

    const unsubscribe = onSignal((signal) => {
      if (signal.sender_id !== ownerId) return;
      void (async () => {
        if (signal.kind === "answer") {
          await pc.setRemoteDescription({
            type: "answer",
            sdp: String(signal.payload["sdp"] ?? ""),
          });
          remoteSet = true;
          for (const candidate of pending.splice(0)) {
            await pc.addIceCandidate(candidate).catch(() => null);
          }
        } else if (signal.kind === "ice" && signal.payload["candidate"]) {
          const candidate = signal.payload["candidate"] as RTCIceCandidateInit;
          if (remoteSet) await pc.addIceCandidate(candidate).catch(() => null);
          else pending.push(candidate);
        }
      })().catch(() => null);
    });

    void (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (disposed) return;
      await sendRef.current(ownerId, {
        kind: "offer",
        payload: { sdp: offer.sdp ?? "", type: "offer" },
      });
    })().catch(() => setStatus("failed"));

    return () => {
      disposed = true;
      unsubscribe();
      try {
        channel.close();
        pc.close();
      } catch {
        // Teardown is best-effort.
      }
      releaseUrls();
      setStatus("idle");
      setProgress(0);
    };
  }, [ready, sessionId, isOwner, ownerId, onSignal, releaseUrls, attempt]);

  return { urls, progress, status, retry };
}
