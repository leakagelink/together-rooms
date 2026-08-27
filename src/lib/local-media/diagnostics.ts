/**
 * Phase 7 — local media delivery diagnostics.
 *
 * Peer-to-peer delivery fails for boring, invisible reasons (offer never
 * arrived, ICE never connected, the sharer dropped the file handle). This is a
 * tiny in-memory store that records those events so the room UI can show
 * per-viewer status and a readable troubleshooting log. It holds no media bytes
 * and never leaves the device.
 */

export type DiagLevel = "info" | "warn" | "error";

export interface DiagEvent {
  id: number;
  at: number;
  level: DiagLevel;
  /** Peer this event belongs to, or null for connection-wide events. */
  peerId: string | null;
  message: string;
}

export interface PeerDiag {
  peerId: string;
  role: "viewer" | "sharer";
  connectionState: RTCPeerConnectionState | "new";
  iceState: RTCIceConnectionState | "new";
  channelState: RTCDataChannelState | "closed";
  offersSent: number;
  offersReceived: number;
  answered: boolean;
  chunks: number;
  bytes: number;
  /** Why the last reconnect / failure happened, if any. */
  lastReason: string | null;
  updatedAt: number;
}

export const MAX_DIAG_EVENTS = 120;

export interface DiagnosticsStore {
  log: (level: DiagLevel, message: string, peerId?: string | null) => void;
  peer: (peerId: string, role: PeerDiag["role"], patch: Partial<PeerDiag>) => void;
  bumpChunk: (peerId: string, role: PeerDiag["role"], bytes: number) => void;
  drop: (peerId: string) => void;
  clear: () => void;
  snapshot: () => { events: DiagEvent[]; peers: PeerDiag[] };
  /** Increments on every mutation so callers can cheaply detect changes. */
  version: () => number;
}

export function shortPeer(peerId: string | null): string {
  if (!peerId) return "connection";
  return peerId.length > 8 ? `${peerId.slice(0, 8)}…` : peerId;
}

export function formatDiagEvent(event: DiagEvent): string {
  const time = new Date(event.at).toLocaleTimeString();
  return `${time} · ${shortPeer(event.peerId)} · ${event.message}`;
}

export function createDiagnostics(now: () => number = Date.now): DiagnosticsStore {
  let events: DiagEvent[] = [];
  const peers = new Map<string, PeerDiag>();
  let seq = 0;
  let version = 0;

  const blank = (peerId: string, role: PeerDiag["role"]): PeerDiag => ({
    peerId,
    role,
    connectionState: "new",
    iceState: "new",
    channelState: "closed",
    offersSent: 0,
    offersReceived: 0,
    answered: false,
    chunks: 0,
    bytes: 0,
    lastReason: null,
    updatedAt: now(),
  });

  const ensure = (peerId: string, role: PeerDiag["role"]): PeerDiag => {
    const existing = peers.get(peerId);
    if (existing) return existing;
    const created = blank(peerId, role);
    peers.set(peerId, created);
    return created;
  };

  return {
    log(level, message, peerId = null) {
      seq += 1;
      version += 1;
      events = [...events, { id: seq, at: now(), level, peerId, message }].slice(-MAX_DIAG_EVENTS);
    },
    peer(peerId, role, patch) {
      const current = ensure(peerId, role);
      peers.set(peerId, { ...current, ...patch, peerId, role, updatedAt: now() });
      version += 1;
    },
    bumpChunk(peerId, role, bytes) {
      const current = ensure(peerId, role);
      peers.set(peerId, {
        ...current,
        chunks: current.chunks + 1,
        bytes: current.bytes + bytes,
        updatedAt: now(),
      });
      version += 1;
    },
    drop(peerId) {
      peers.delete(peerId);
      version += 1;
    },
    clear() {
      events = [];
      peers.clear();
      version += 1;
    },
    snapshot() {
      return {
        events: [...events].reverse(),
        peers: [...peers.values()].sort((a, b) => a.peerId.localeCompare(b.peerId)),
      };
    },
    version() {
      return version;
    },
  };
}
