/**
 * Phase 7 — provider-neutral local media transport.
 *
 * Room logic never talks to WebRTC directly: it talks to `LocalMediaTransport`.
 * The WebRTC implementation below is one provider; a different one can be
 * dropped in without touching room, playback or authorization code.
 *
 * Security notes:
 * - Signaling is authenticated and credential-bound (see local-media.functions).
 *   A session id alone authorizes nothing.
 * - Media travels over DTLS/SRTP-secured WebRTC ("encrypted transport").
 *   This is NOT end-to-end encryption in the strong sense: if a TURN relay is
 *   used, the relay forwards encrypted packets but the key exchange is not
 *   independently verified by the users, so we never claim E2EE in the UI.
 * - Files are read lazily with `Blob.slice`; the whole media is never loaded.
 */
import { chunkRange, flowDecision, planChunks, withinSessionLimit } from "./chunking";
import { BUFFERED_LOW_WATER, CHUNK_BYTES, CONNECT_TIMEOUT_MS } from "./limits";
import type { LocalMediaTransportState } from "./capability";

export type TransportRole = "owner" | "viewer";

export interface SignalEnvelope {
  kind: "offer" | "answer" | "ice" | "bye";
  payload: Record<string, unknown>;
  sender_id?: string;
}

export interface TransportCredential {
  token: string;
  role: TransportRole;
  relay_allowed: boolean;
  expires_at: string;
}

export interface TransportCallbacks {
  /** Send a signal through the authenticated server relay. */
  sendSignal: (peerId: string, envelope: SignalEnvelope) => Promise<void>;
  /** Fresh credentials; called again whenever the current one nears expiry. */
  refreshCredential: () => Promise<TransportCredential | null>;
  onStateChange: (state: LocalMediaTransportState) => void;
  /** Incremental bytes for the receiving side. Never buffered as a whole file. */
  onChunk?: (chunk: ArrayBuffer, done: boolean) => void;
  onError?: (reason: string) => void;
}

export interface LocalMediaTransport {
  readonly state: LocalMediaTransportState;
  /** Owner side: begin streaming a user-selected file to one peer. */
  offer(peerId: string, file: Blob): Promise<void>;
  /** Viewer side: answer an incoming offer. */
  accept(peerId: string, envelope: SignalEnvelope): Promise<void>;
  handleSignal(envelope: SignalEnvelope & { sender_id: string }): Promise<void>;
  close(): void;
}

/** ICE servers are supplied per connection and are always time-limited. */
export interface IceConfig {
  iceServers: RTCIceServer[];
  relayAllowed: boolean;
}

/**
 * Public STUN only by default. No TURN credentials are embedded in the client
 * bundle: if a deployment adds relay infrastructure it must mint short-lived
 * credentials server-side and pass them in here. Without relay, unreachable
 * peers report `unavailable` — we never silently fall back to uploading media.
 */
export function defaultIceConfig(relayAllowed: boolean): IceConfig {
  return {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    relayAllowed,
  };
}

interface PeerEntry {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  cancelled: boolean;
}

/**
 * WebRTC implementation. Kept intentionally small: connection setup, bounded
 * chunked sending with backpressure, cancellation and teardown.
 */
export class WebRtcLocalMediaTransport implements LocalMediaTransport {
  state: LocalMediaTransportState = "unavailable";
  private peers = new Map<string, PeerEntry>();
  private closed = false;

  constructor(
    private readonly ice: IceConfig,
    private readonly callbacks: TransportCallbacks,
  ) {}

  private setState(next: LocalMediaTransportState) {
    if (this.state === next) return;
    this.state = next;
    this.callbacks.onStateChange(next);
  }

  private createPeer(peerId: string): PeerEntry {
    const pc = new RTCPeerConnection({
      iceServers: this.ice.iceServers,
      ...(this.ice.relayAllowed ? {} : { iceTransportPolicy: "all" as RTCIceTransportPolicy }),
    });
    const entry: PeerEntry = { pc, channel: null, cancelled: false };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.callbacks.sendSignal(peerId, {
        kind: "ice",
        payload: { candidate: event.candidate.toJSON() as unknown as Record<string, unknown> },
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        // Direct vs relay is derived from the negotiated candidate pair.
        void this.reportPath(pc);
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.setState("unavailable");
      }
    };
    this.peers.set(peerId, entry);
    return entry;
  }

  private async reportPath(pc: RTCPeerConnection) {
    try {
      const stats = await pc.getStats();
      let relayed = false;
      stats.forEach((report) => {
        const r = report as unknown as Record<string, unknown>;
        if (r["type"] === "local-candidate" && r["candidateType"] === "relay") relayed = true;
      });
      this.setState(relayed ? "relay" : "direct");
    } catch {
      this.setState("direct");
    }
  }

  async offer(peerId: string, file: Blob): Promise<void> {
    if (this.closed) return;
    if (!withinSessionLimit(file.size)) {
      this.callbacks.onError?.("too_large");
      this.setState("unavailable");
      return;
    }
    const entry = this.peers.get(peerId) ?? this.createPeer(peerId);
    const channel = entry.pc.createDataChannel("local-media", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFERED_LOW_WATER;
    entry.channel = channel;

    channel.onopen = () => {
      void this.streamFile(entry, file);
    };
    channel.onerror = () => this.callbacks.onError?.("channel_error");

    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    await this.callbacks.sendSignal(peerId, {
      kind: "offer",
      payload: { sdp: offer.sdp ?? "", type: offer.type },
    });

    // A stalled negotiation must not hang the UI forever.
    setTimeout(() => {
      if (entry.pc.connectionState !== "connected") this.setState("unavailable");
    }, CONNECT_TIMEOUT_MS);
  }

  /**
   * Bounded, incremental send. One `CHUNK_BYTES` slice is resident at a time,
   * and reading pauses whenever the channel's queue is above the high-water
   * mark. Cancelling closes the channel and stops reading immediately.
   */
  private async streamFile(entry: PeerEntry, file: Blob): Promise<void> {
    const plan = planChunks(file.size, CHUNK_BYTES);
    const channel = entry.channel;
    if (!channel) return;
    channel.send(JSON.stringify({ meta: { size: file.size, chunks: plan.chunkCount } }));

    for (let index = 0; index < plan.chunkCount; index += 1) {
      if (entry.cancelled || this.closed || channel.readyState !== "open") return;
      let waiting = false;
      while (flowDecision(channel.bufferedAmount, waiting) === "wait") {
        waiting = true;
        await new Promise<void>((resolve) => {
          const onLow = () => {
            channel.removeEventListener("bufferedamountlow", onLow);
            resolve();
          };
          channel.addEventListener("bufferedamountlow", onLow);
          setTimeout(onLow, 500);
        });
        if (entry.cancelled || this.closed || channel.readyState !== "open") return;
      }
      const range = chunkRange(plan, index);
      if (!range) return;
      const buffer = await file.slice(range.start, range.end).arrayBuffer();
      channel.send(buffer);
    }
    if (channel.readyState === "open") channel.send(JSON.stringify({ done: true }));
  }

  async accept(peerId: string, envelope: SignalEnvelope): Promise<void> {
    const entry = this.peers.get(peerId) ?? this.createPeer(peerId);
    entry.pc.ondatachannel = (event) => {
      const channel = event.channel;
      channel.binaryType = "arraybuffer";
      entry.channel = channel;
      channel.onmessage = (message) => {
        if (typeof message.data === "string") {
          const parsed = JSON.parse(message.data) as { done?: boolean };
          if (parsed.done) this.callbacks.onChunk?.(new ArrayBuffer(0), true);
          return;
        }
        this.callbacks.onChunk?.(message.data as ArrayBuffer, false);
      };
    };
    const sdp = String(envelope.payload["sdp"] ?? "");
    await entry.pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    await this.callbacks.sendSignal(peerId, {
      kind: "answer",
      payload: { sdp: answer.sdp ?? "", type: answer.type },
    });
  }

  async handleSignal(envelope: SignalEnvelope & { sender_id: string }): Promise<void> {
    const peerId = envelope.sender_id;
    const entry = this.peers.get(peerId);
    if (envelope.kind === "offer") {
      await this.accept(peerId, envelope);
      return;
    }
    if (!entry) return;
    if (envelope.kind === "answer") {
      await entry.pc.setRemoteDescription({
        type: "answer",
        sdp: String(envelope.payload["sdp"] ?? ""),
      });
    } else if (envelope.kind === "ice") {
      const candidate = envelope.payload["candidate"];
      if (candidate) await entry.pc.addIceCandidate(candidate as RTCIceCandidateInit);
    } else {
      this.closePeer(peerId);
    }
  }

  closePeer(peerId: string) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.cancelled = true;
    try {
      entry.channel?.close();
      entry.pc.close();
    } catch {
      // Teardown is best-effort.
    }
    this.peers.delete(peerId);
    if (this.peers.size === 0) this.setState("unavailable");
  }

  /** Full teardown: every connection closed, nothing reusable left behind. */
  close() {
    this.closed = true;
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
    this.setState("unavailable");
  }
}
