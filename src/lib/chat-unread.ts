import type { ChatMessage } from "@/lib/chat-constants";

export interface UnreadSummary {
  count: number;
  /** True when at least one unread message replies to the viewer. */
  hasReplyToMe: boolean;
}

/**
 * Messages from other people that arrived after `seenAt`. System notices,
 * your own messages and removed messages never count as unread.
 */
export function summarizeUnread(
  messages: Pick<ChatMessage, "id" | "sender_id" | "content_type" | "status" | "created_at" | "parent_message_id">[],
  userId: string | undefined,
  seenAt: string | null,
): UnreadSummary {
  if (!userId || !seenAt) return { count: 0, hasReplyToMe: false };
  const mine = new Set(messages.filter((m) => m.sender_id === userId).map((m) => m.id));
  let count = 0;
  let hasReplyToMe = false;
  for (const m of messages) {
    if (m.created_at <= seenAt) continue;
    if (m.content_type === "system" || m.status !== "active") continue;
    if (!m.sender_id || m.sender_id === userId) continue;
    count += 1;
    if (m.parent_message_id && mine.has(m.parent_message_id)) hasReplyToMe = true;
  }
  return { count, hasReplyToMe };
}

/** Badge text: exact up to 9, then "9+". */
export function unreadBadgeLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}
