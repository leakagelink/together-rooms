/**
 * Phase 7 — bounded chunk planning for local media transport.
 *
 * The whole point of this module is that a shared file is *never* read into
 * memory as a whole. A plan is a sequence of byte ranges; the transport reads
 * one range at a time (via `Blob.slice`, which is lazy) and stops reading
 * whenever the channel is congested.
 *
 * Pure functions only, so the memory guarantees are unit-testable.
 */
import { BUFFERED_HIGH_WATER, BUFFERED_LOW_WATER, CHUNK_BYTES, MAX_SESSION_BYTES } from "./limits";

export interface ChunkRange {
  index: number;
  start: number;
  end: number;
}

export interface ChunkPlan {
  totalBytes: number;
  chunkBytes: number;
  chunkCount: number;
}

export function planChunks(totalBytes: number, chunkBytes: number = CHUNK_BYTES): ChunkPlan {
  if (!Number.isFinite(totalBytes) || totalBytes < 0) throw new Error("invalid size");
  if (chunkBytes <= 0 || chunkBytes > CHUNK_BYTES) throw new Error("invalid chunk size");
  return {
    totalBytes,
    chunkBytes,
    chunkCount: totalBytes === 0 ? 0 : Math.ceil(totalBytes / chunkBytes),
  };
}

export function chunkRange(plan: ChunkPlan, index: number): ChunkRange | null {
  if (index < 0 || index >= plan.chunkCount) return null;
  const start = index * plan.chunkBytes;
  return { index, start, end: Math.min(start + plan.chunkBytes, plan.totalBytes) };
}

/** Peak bytes the sender may hold: one chunk plus the queued high-water mark. */
export function peakMemoryBytes(plan: ChunkPlan): number {
  return plan.chunkBytes + BUFFERED_HIGH_WATER;
}

export function withinSessionLimit(totalBytes: number): boolean {
  return totalBytes >= 0 && totalBytes <= MAX_SESSION_BYTES;
}

export type FlowDecision = "send" | "wait";

/**
 * Backpressure: stop feeding the channel above the high-water mark and only
 * resume once the queue has drained below the low-water mark (hysteresis, so
 * we do not oscillate around a single threshold).
 */
export function flowDecision(bufferedAmount: number, waiting: boolean): FlowDecision {
  if (waiting) return bufferedAmount <= BUFFERED_LOW_WATER ? "send" : "wait";
  return bufferedAmount >= BUFFERED_HIGH_WATER ? "wait" : "send";
}
