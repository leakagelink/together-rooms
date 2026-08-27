/**
 * Phase 7 — resumable local media delivery.
 *
 * The data channel is ordered and reliable, so bytes are never silently lost:
 * what actually breaks a transfer is the connection dropping mid-file. Resume
 * therefore works at byte-offset granularity — the viewer keeps the chunks it
 * already has and asks the sharer to continue from the first missing byte
 * instead of re-sending the whole file.
 */

export interface PartialProgress {
  index: number;
  /** Bytes already held by the viewer for this item. */
  received: number;
  complete: boolean;
}

export interface ResumePoint {
  index: number;
  offset: number;
}

/** Where the viewer wants the sharer to (re)start streaming. */
export function planResume(items: PartialProgress[], count = 0): ResumePoint {
  const total = Math.max(count, items.length);
  const byIndex = new Map(items.map((item) => [item.index, item]));
  for (let index = 0; index < Math.max(1, total); index += 1) {
    const item = byIndex.get(index);
    if (!item) return { index, offset: 0 };
    if (!item.complete) return { index, offset: Math.max(0, item.received) };
  }
  return { index: Math.max(0, total), offset: 0 };
}

/** True when every item the sharer announced has fully arrived. */
export function isTransferComplete(items: PartialProgress[], count: number): boolean {
  if (count <= 0) return false;
  for (let index = 0; index < count; index += 1) {
    if (!items.find((item) => item.index === index)?.complete) return false;
  }
  return true;
}

/** Sharer side: never trust a client offset blindly. */
export function clampResumePoint(point: ResumePoint, fileCount: number, fileSize: number): ResumePoint {
  const index = Number.isFinite(point.index) ? Math.min(Math.max(0, Math.trunc(point.index)), Math.max(0, fileCount - 1)) : 0;
  const offset = Number.isFinite(point.offset)
    ? Math.min(Math.max(0, Math.trunc(point.offset)), Math.max(0, fileSize))
    : 0;
  return { index, offset };
}

/** Human summary used in the troubleshooting log and the UI. */
export function describeResume(point: ResumePoint, size: number): string {
  if (point.offset <= 0) return `Starting item ${point.index + 1} from the beginning`;
  const percent = size > 0 ? Math.round((point.offset / size) * 100) : 0;
  return `Resuming item ${point.index + 1} at ${percent}% (${point.offset} bytes already received)`;
}
