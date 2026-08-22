/**
 * Phase 5 — pure, testable queue presentation rules.
 *
 * Nothing here is a security control: every rule below is re-enforced inside
 * the queue RPCs. These helpers only decide what the UI offers.
 */

export type QueueMode = "host_only" | "collaborative" | "host_approval";
export type RepeatMode = "off" | "repeat_one" | "repeat_queue";
export type QueueItemStatus = "suggested" | "queued" | "playing" | "played" | "rejected";

export interface QueueItem {
  id: string;
  provider: string;
  provider_media_id: string;
  title: string | null;
  thumbnail_url: string | null;
  status: QueueItemStatus;
  position: number;
  added_by: string | null;
  created_at: string;
}

export interface QueueSnapshot {
  room_id: string;
  queue_version: number;
  items: QueueItem[];
}

export interface QueueSettings {
  queue_mode: QueueMode;
  repeat_mode: RepeatMode;
  shuffle_enabled: boolean;
  queue_version: number;
}

/** What the "add a track" affordance should do for this viewer. */
export function addIntent(mode: QueueMode, canManage: boolean): "add" | "suggest" | "denied" {
  if (canManage) return "add";
  if (mode === "collaborative") return "add";
  if (mode === "host_approval") return "suggest";
  return "denied";
}

/** Splits a snapshot into the three lists the music UI renders. */
export function queueSections(items: QueueItem[]): {
  nowPlaying: QueueItem | null;
  upNext: QueueItem[];
  suggestions: QueueItem[];
} {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return {
    nowPlaying: sorted.find((item) => item.status === "playing") ?? null,
    upNext: sorted.filter((item) => item.status === "queued"),
    suggestions: sorted.filter((item) => item.status === "suggested"),
  };
}

/** Target index for a one-step reorder, clamped to the list. */
export function moveTargetIndex(currentIndex: number, direction: -1 | 1, length: number): number {
  return Math.min(Math.max(currentIndex + direction, 0), Math.max(length - 1, 0));
}

/** Whether this viewer may remove a specific item. Hosts may remove anything. */
export function canRemoveItem(
  item: QueueItem,
  viewerId: string | undefined,
  canManage: boolean,
): boolean {
  if (canManage) return true;
  return Boolean(viewerId) && item.added_by === viewerId && item.status !== "playing";
}

export function repeatLabel(mode: RepeatMode): string {
  return mode === "repeat_one"
    ? "Repeat track"
    : mode === "repeat_queue"
      ? "Repeat queue"
      : "Repeat off";
}

export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "repeat_queue" : mode === "repeat_queue" ? "repeat_one" : "off";
}

export function modeLabel(mode: QueueMode): string {
  return mode === "host_only"
    ? "Host only"
    : mode === "collaborative"
      ? "Everyone can add"
      : "Suggestions need approval";
}
