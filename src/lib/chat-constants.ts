/**
 * Client-safe chat constants. These mirror the limits enforced in Postgres —
 * the database is authoritative, the UI copies exist only for affordances.
 */

export const MAX_MESSAGE_LENGTH = 2000;

/** Matches the 15-minute window enforced by public.edit_room_message. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Page size for cursor pagination over room history. */
export const CHAT_PAGE_SIZE = 30;

export const REACTION_KEYS = ["thumbs_up", "heart", "joy", "wow", "sad", "fire"] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];

export const REACTION_EMOJI: Record<ReactionKey, string> = {
  thumbs_up: "👍",
  heart: "❤️",
  joy: "😂",
  wow: "😮",
  sad: "😢",
  fire: "🔥",
};

export const REACTION_LABEL: Record<ReactionKey, string> = {
  thumbs_up: "Thumbs up",
  heart: "Heart",
  joy: "Laugh",
  wow: "Surprised",
  sad: "Sad",
  fire: "Fire",
};

export type MessageStatus = "active" | "deleted" | "moderated";
export type MessageContentType = "text" | "system" | "voice";

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string | null;
  parent_message_id: string | null;
  content: string;
  content_type: MessageContentType;
  status: MessageStatus;
  system_code: string | null;
  /** Storage object path for voice notes; null otherwise or once deleted. */
  voice_path?: string | null;
  voice_duration_ms?: number | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ChatReaction {
  id: string;
  message_id: string;
  user_id: string;
  reaction: ReactionKey;
}

const SYSTEM_LABELS: Record<string, string> = {
  USER_JOINED: "Someone joined the room",
  USER_LEFT: "Someone left the room",
  HOST_CHANGED: "The room host changed",
  ROOM_ENDED: "The room ended",
};

/** System messages carry a code, never free text, so wording stays trusted. */
export function systemMessageLabel(code: string | null): string {
  return (code && SYSTEM_LABELS[code]) || "Room updated";
}

/** True when the signed-in sender may still edit this message. */
export function canEditMessage(
  message: Pick<ChatMessage, "sender_id" | "status" | "content_type" | "created_at">,
  userId: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!userId || message.sender_id !== userId) return false;
  if (message.status !== "active" || message.content_type !== "text") return false;
  return now - new Date(message.created_at).getTime() <= EDIT_WINDOW_MS;
}

/** Mirrors the database validation for outgoing message content. */
export function validateMessageContent(raw: string): { ok: true; text: string } | { ok: false } {
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) return { ok: false };
  return { ok: true, text };
}

/** Aggregate reaction counts without an extra database round trip. */
export function summarizeReactions(
  reactions: ChatReaction[],
  userId: string | undefined,
): { reaction: ReactionKey; count: number; mine: boolean }[] {
  const counts = new Map<ReactionKey, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const entry = counts.get(r.reaction) ?? { count: 0, mine: false };
    entry.count += 1;
    if (userId && r.user_id === userId) entry.mine = true;
    counts.set(r.reaction, entry);
  }
  return REACTION_KEYS.filter((k) => counts.has(k)).map((k) => ({
    reaction: k,
    count: counts.get(k)!.count,
    mine: counts.get(k)!.mine,
  }));
}
