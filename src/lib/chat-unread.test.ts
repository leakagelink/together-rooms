import { describe, expect, it } from "vitest";

import { summarizeUnread, unreadBadgeLabel } from "./chat-unread";

const msg = (over: Partial<Parameters<typeof summarizeUnread>[0][number]>) => ({
  id: "m",
  sender_id: "other",
  content_type: "text" as const,
  status: "active" as const,
  created_at: "2026-01-01T10:00:00Z",
  parent_message_id: null,
  ...over,
});

describe("floating chat unread badge", () => {
  it("counts only other people's messages after the last time chat was seen", () => {
    const list = [
      msg({ id: "a", created_at: "2026-01-01T10:05:00Z" }),
      msg({ id: "b", created_at: "2026-01-01T09:00:00Z" }),
      msg({ id: "c", sender_id: "me", created_at: "2026-01-01T10:06:00Z" }),
    ];
    expect(summarizeUnread(list, "me", "2026-01-01T10:00:00Z").count).toBe(1);
  });

  it("ignores system notices and removed messages", () => {
    const list = [
      msg({ id: "s", content_type: "system", sender_id: null, created_at: "2026-01-01T11:00:00Z" }),
      msg({ id: "d", status: "deleted", created_at: "2026-01-01T11:00:00Z" }),
    ];
    expect(summarizeUnread(list, "me", "2026-01-01T10:00:00Z").count).toBe(0);
  });

  it("flags a new reply to one of my messages", () => {
    const list = [
      msg({ id: "r", parent_message_id: "mine", created_at: "2026-01-01T11:00:00Z" }),
      msg({ id: "mine", sender_id: "me", created_at: "2026-01-01T09:00:00Z" }),
    ];
    expect(summarizeUnread(list, "me", "2026-01-01T10:00:00Z")).toEqual({ count: 1, hasReplyToMe: true });
  });

  it("shows 9+ beyond nine unread", () => {
    expect(unreadBadgeLabel(9)).toBe("9");
    expect(unreadBadgeLabel(10)).toBe("9+");
  });
});
