/**
 * Phase 7 — local media capability detection and privacy-safe descriptors.
 *
 * The app never transcodes. If the receiving device cannot play a format we
 * say so explicitly instead of showing a silent black frame.
 *
 * Everything here is pure apart from `detectCapability`, which takes the
 * probing element as an argument so it is testable without a browser.
 */
import { MAX_IMAGE_ITEMS, MAX_QUEUE_ITEMS, MAX_SESSION_BYTES } from "./limits";

export type LocalMediaKind = "image" | "video" | "audio";

/** Provider-neutral transport states, mirrored by the database enum. */
export type LocalMediaTransportState = "direct" | "relay" | "unavailable";

export type CapabilityVerdict = "supported" | "maybe" | "unsupported";

export interface MediaProbe {
  canPlayType(type: string): string;
}

/** Image formats every supported browser decodes. */
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

export function kindForMimeType(mime: string): LocalMediaKind | null {
  const type = mime.trim().toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return null;
}

/**
 * Verdict for a MIME type. Images are decided from a known list (HTMLMedia
 * elements cannot probe them); video and audio are probed with the platform's
 * own `canPlayType`, whose "" / "maybe" / "probably" answers map directly.
 */
export function detectCapability(mime: string, probe: MediaProbe | null): CapabilityVerdict {
  const kind = kindForMimeType(mime);
  if (!kind) return "unsupported";
  if (kind === "image") {
    const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
    // HEIC/HEIF is Apple-only in practice: report it as uncertain, not supported.
    if (base === "image/heic" || base === "image/heif") return "maybe";
    return IMAGE_TYPES.has(base) ? "supported" : "unsupported";
  }
  if (!probe) return "maybe";
  const answer = probe.canPlayType(mime);
  if (answer === "probably") return "supported";
  if (answer === "maybe") return "maybe";
  return "unsupported";
}

export function capabilityMessage(verdict: CapabilityVerdict, mime: string): string | null {
  if (verdict === "supported") return null;
  if (verdict === "maybe") {
    return `This device may not play ${mime}. If playback fails, share a more common format — nothing is converted for you.`;
  }
  return `This device can't play ${mime}. Pick a different file: SyncTogether never converts your media.`;
}

export interface SelectedMediaLike {
  type: string;
  size: number;
}

export type SelectionRejection =
  "unsupported_kind" | "too_large" | "too_many_items" | "mixed_kinds" | "empty";

export interface SelectionCheck {
  ok: boolean;
  kind?: LocalMediaKind;
  reason?: SelectionRejection;
}

/**
 * Validates an explicit user selection before any session is created. Only the
 * MIME type and byte size are inspected — never the filename, never the bytes.
 */
export function checkSelection(files: readonly SelectedMediaLike[]): SelectionCheck {
  if (files.length === 0) return { ok: false, reason: "empty" };
  const kinds = new Set<LocalMediaKind>();
  for (const file of files) {
    const kind = kindForMimeType(file.type);
    if (!kind) return { ok: false, reason: "unsupported_kind" };
    kinds.add(kind);
    if (file.size > MAX_SESSION_BYTES) return { ok: false, reason: "too_large" };
  }
  if (kinds.size > 1) return { ok: false, reason: "mixed_kinds" };
  const kind = [...kinds][0]!;
  // Photos, videos and audio can all be shared as a queue the room browses
  // through over the same connection; only mixing kinds is rejected.
  if (files.length > maxItemsForKind(kind)) return { ok: false, reason: "too_many_items" };
  return { ok: true, kind };
}

/** Queue size ceiling for a given media kind. */
export function maxItemsForKind(kind: LocalMediaKind): number {
  return kind === "image" ? MAX_IMAGE_ITEMS : MAX_QUEUE_ITEMS;
}

export function selectionMessage(reason: SelectionRejection): string {
  switch (reason) {
    case "unsupported_kind":
      return "Only photos, videos and audio files can be shared.";
    case "too_large":
      return "That file is too large to share in one session.";
    case "too_many_items":
      return `You can share up to ${MAX_IMAGE_ITEMS} photos, or ${MAX_QUEUE_ITEMS} videos or tracks, at once.`;
    case "mixed_kinds":
      return "Share photos, videos, or audio — not a mix of kinds.";
    case "empty":
      return "Select something to share first.";
  }
}

/**
 * The only media metadata that ever leaves the device. Filenames, device
 * paths, EXIF and GPS data are deliberately absent — they are never read.
 */
export interface SafeMediaDescriptor {
  media_kind: LocalMediaKind;
  mime_type: string;
  item_count: number;
  duration_seconds?: number;
}

export function describeSelection(
  files: readonly SelectedMediaLike[],
  durationSeconds?: number,
): SafeMediaDescriptor | null {
  const check = checkSelection(files);
  if (!check.ok || !check.kind) return null;
  // Strip any codec/parameter suffix so no unexpected string is persisted.
  const mime = (files[0]!.type.split(";")[0] ?? "").trim().toLowerCase();
  return {
    media_kind: check.kind,
    mime_type: mime,
    item_count: files.length,
    ...(durationSeconds != null && Number.isFinite(durationSeconds)
      ? { duration_seconds: Math.max(0, Math.round(durationSeconds)) }
      : {}),
  };
}
