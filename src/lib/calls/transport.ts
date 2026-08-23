/**
 * PHASE 8 — voice/video transport (full-mesh WebRTC).
 *
 * TERMINOLOGY, precisely:
 *  - SIGNALING is server-mediated. Offers, answers and ICE candidates travel
 *    through authenticated, credential-bound SECURITY DEFINER RPCs. It is
 *    never a public channel and never peer-to-peer.
 *  - MEDIA TRANSPORT is WebRTC (SRTP/DTLS). It is encrypted in transit and
 *    authenticated by the DTLS handshake.
 *  - RELAY: when direct connectivity fails, media may traverse a TURN relay if
 *    one is configured and the room allows it. In that case media is NOT
 *    peer-to-peer; it is decrypted only at the endpoints of the DTLS session,
 *    but the relay does observe traffic metadata.
 *
 * We therefore do NOT claim "peer-to-peer only" and do NOT claim
 * "end-to-end encrypted" as a product property: WebRTC hop encryption is
 * what is implemented, and relay usage is possible.
 *
 * Nothing in this module records, buffers to disk, or persists media.
 */
import { CALL_CONNECT_TIMEOUT_MS } from "./limits";
import type { CallConnectionState } from "./media-state";

export type CallSignalKind = "offer" | "answer" | "ice" | "bye" | "renegotiate";

export interface CallSignalEnvelope {
  kind: CallSignalKind;
  payload: Record<string, unknown>;
}

export interface CallTransportCredential {
  token: string;
  relay_allowed: boolean;
  expires_at: string;
}

export interface CallTransportHandlers {
  sendSignal: (peerId: string, envelope: CallSignalEnvelope) => Promise<void>;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onPeerState: (peerId: string, state: CallConnectionState) => void;
  onPeerClosed: (peerId: string) => void;
}

/** Public STUN only. TURN, when configured, is injected by the caller. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

function mapState(state: RTCPeerConnectionState): CallConnectionState {
  switch (state) {
    case "connected":
      return "connected";
    case "disconnected":
      return "reconnecting";
    case "failed":
    case "closed":
      return "failed";
    default:
      return "connecting";
  }
}

interface PeerEntry {
  pc: RTCPeerConnection;
  timeout: ReturnType<typeof setTimeout> | null;
}

/**
 * A small mesh manager: one RTCPeerConnection per remote participant.
 * It owns no authorization logic — the server decides who may signal at all.
 */
export class CallMeshTransport {
  private peers = new Map<string, PeerEntry>();
  private local: MediaStream | null = null;
  private closed = false;

  constructor(
    private readonly handlers: CallTransportHandlers,
    private readonly iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
    private readonly relayAllowed: boolean = true,
  ) {}

  /** Replaces the outgoing stream (mic/camera toggles) on every peer. */
  setLocalStream(stream: MediaStream | null) {
    this.local = stream;
    for (const [, entry] of this.peers) {
      const senders = entry.pc.getSenders();
      for (const sender of senders) {
        const kind = sender.track?.kind;
        const next = stream?.getTracks().find((t) => t.kind === kind) ?? null;
        void sender.replaceTrack(next);
      }
      if (stream) {
        for (const track of stream.getTracks()) {
          const exists = senders.some((s) => s.track?.kind === track.kind);
          if (!exists) entry.pc.addTrack(track, stream);
        }
      }
    }
  }

  private create(peerId: string): RTCPeerConnection {
    const existing = this.peers.get(peerId);
    if (existing) return existing.pc;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.relayAllowed ? "all" : "all",
    });

    if (this.local) for (const track of this.local.getTracks()) pc.addTrack(track, this.local);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.handlers.sendSignal(peerId, {
        kind: "ice",
        payload: { candidate: event.candidate.toJSON() as unknown as Record<string, unknown> },
      });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.handlers.onRemoteStream(peerId, stream);
    };
    pc.onconnectionstatechange = () => {
      const state = mapState(pc.connectionState);
      this.handlers.onPeerState(peerId, state);
      if (state === "failed") this.closePeer(peerId);
    };

    const timeout = setTimeout(() => {
      if (pc.connectionState !== "connected") {
        this.handlers.onPeerState(peerId, "failed");
        this.closePeer(peerId);
      }
    }, CALL_CONNECT_TIMEOUT_MS);

    this.peers.set(peerId, { pc, timeout });
    return pc;
  }

  /** Deterministic caller side: build and send an offer. */
  async offer(peerId: string): Promise<void> {
    if (this.closed) return;
    const pc = this.create(peerId);
    const description = await pc.createOffer();
    await pc.setLocalDescription(description);
    await this.handlers.sendSignal(peerId, {
      kind: "offer",
      payload: { sdp: description.sdp ?? "", type: description.type },
    });
  }

  /** Applies a signal that the server already authorized and delivered. */
  async accept(peerId: string, envelope: CallSignalEnvelope): Promise<void> {
    if (this.closed) return;
    if (envelope.kind === "bye") {
      this.closePeer(peerId);
      return;
    }
    const pc = this.create(peerId);
    if (envelope.kind === "offer" || envelope.kind === "renegotiate") {
      const sdp = String(envelope.payload["sdp"] ?? "");
      if (!sdp) return;
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.handlers.sendSignal(peerId, {
        kind: "answer",
        payload: { sdp: answer.sdp ?? "", type: answer.type },
      });
      return;
    }
    if (envelope.kind === "answer") {
      const sdp = String(envelope.payload["sdp"] ?? "");
      if (!sdp || pc.signalingState === "stable") return;
      await pc.setRemoteDescription({ type: "answer", sdp });
      return;
    }
    if (envelope.kind === "ice") {
      const candidate = envelope.payload["candidate"];
      if (!candidate || typeof candidate !== "object") return;
      try {
        await pc.addIceCandidate(candidate as RTCIceCandidateInit);
      } catch {
        // A late/duplicate candidate is not fatal.
      }
    }
  }

  hasPeer(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  /** Tears down one peer; used on leave, revocation and failure. */
  closePeer(peerId: string) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    if (entry.timeout) clearTimeout(entry.timeout);
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    try {
      entry.pc.close();
    } catch {
      // already closed
    }
    this.peers.delete(peerId);
    this.handlers.onPeerClosed(peerId);
  }

  /** Full teardown. Called when the call ends, expires or access is revoked. */
  close() {
    this.closed = true;
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
    this.local = null;
  }
}
