import { describe, expect, it } from "vitest";

import {
  EDIT_WINDOW_MS,
  canEditMessage,
  summarizeReactions,
  systemMessageLabel,
  validateMessageContent,
  type ChatMessage,
  type ChatReaction,
} from "./chat-constants";

const base: Pick<ChatMessage, "sender_id" | "status" | "content_type" | "created_at"> = {
  sender_id: "u1",
  status: "active",
  content_type: "text",
  created_at: new Date(1_000_000).toISOString(),
};

describe("validateMessageContent", () => {
  it("rejects blank and whitespace-only content", () => {
    expect(validateMessageContent("   ").ok).toBe(false);
  });

  it("rejects content over the limit", () => {
    expect(validateMessageContent("a".repeat(2001)).ok).toBe(false);
  });

  it("trims accepted content", () => {
    expect(validateMessageContent("  hi  ")).toEqual({ ok: true, text: "hi" });
  });
});

describe("canEditMessage", () => {
  const now = 1_000_000;

  it("allows the sender inside the edit window", () => {
    expect(canEditMessage(base, "u1", now + EDIT_WINDOW_MS - 1)).toBe(true);
  });

  it("blocks the sender after the edit window", () => {
    expect(canEditMessage(base, "u1", now + EDIT_WINDOW_MS + 1)).toBe(false);
  });

  it("blocks other users, deleted messages and system messages", () => {
    expect(canEditMessage(base, "u2", now)).toBe(false);
    expect(canEditMessage({ ...base, status: "deleted" }, "u1", now)).toBe(false);
    expect(canEditMessage({ ...base, content_type: "system" }, "u1", now)).toBe(false);
  });
});

describe("summarizeReactions", () => {
  const reactions: ChatReaction[] = [
    { id: "1", message_id: "m", user_id: "u1", reaction: "heart" },
    { id: "2", message_id: "m", user_id: "u2", reaction: "heart" },
    { id: "3", message_id: "m", user_id: "u2", reaction: "fire" },
  ];

  it("counts per reaction and flags the viewer's own", () => {
    expect(summarizeReactions(reactions, "u1")).toEqual([
      { reaction: "heart", count: 2, mine: true },
      { reaction: "fire", count: 1, mine: false },
    ]);
  });

  it("returns nothing for an empty list", () => {
    expect(summarizeReactions([], "u1")).toEqual([]);
  });
});

describe("systemMessageLabel", () => {
  it("maps known codes and falls back safely", () => {
    expect(systemMessageLabel("USER_JOINED")).toBe("Someone joined the room");
    expect(systemMessageLabel("SOMETHING_ELSE")).toBe("Room updated");
    expect(systemMessageLabel(null)).toBe("Room updated");
  });
});
