import { describe, expect, it } from "vitest";

import {
  hasCapacity,
  hostLeaveOutcome,
  isInviteUsable,
  isValidInviteToken,
  isValidJoinCode,
  normalizeJoinCode,
  pickSuccessor,
  roomJoinability,
} from "./room-rules";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const past = "2025-12-31T12:00:00.000Z";
const future = "2026-01-02T12:00:00.000Z";

describe("join codes and invite tokens", () => {
  it("normalizes and validates join codes", () => {
    expect(normalizeJoinCode("  ab12cd34 ")).toBe("AB12CD34");
    expect(isValidJoinCode("ab12cd34")).toBe(true);
    expect(isValidJoinCode("short")).toBe(false);
    expect(isValidJoinCode("way-too-long-code")).toBe(false);
  });

  it("rejects malformed invite tokens before they reach the server", () => {
    expect(isValidInviteToken("a".repeat(48))).toBe(true);
    expect(isValidInviteToken("a".repeat(47))).toBe(false);
    expect(isValidInviteToken("Z".repeat(48))).toBe(false);
  });
});

describe("roomJoinability", () => {
  it("blocks ended, archived, draft and expired rooms", () => {
    expect(roomJoinability({ status: "ended", expires_at: null }, NOW)).toBe("room_ended");
    expect(roomJoinability({ status: "archived", expires_at: null }, NOW)).toBe("room_ended");
    expect(roomJoinability({ status: "draft", expires_at: null }, NOW)).toBe("room_not_open");
    expect(roomJoinability({ status: "active", expires_at: past }, NOW)).toBe("room_expired");
  });

  it("allows active rooms with no or future expiry", () => {
    expect(roomJoinability({ status: "active", expires_at: null }, NOW)).toBe("ok");
    expect(roomJoinability({ status: "active", expires_at: future }, NOW)).toBe("ok");
  });
});

describe("capacity", () => {
  it("is exclusive at the limit", () => {
    expect(hasCapacity(1, 2)).toBe(true);
    expect(hasCapacity(2, 2)).toBe(false);
  });
});

describe("isInviteUsable", () => {
  const base = { revoked_at: null, expires_at: future, use_count: 0, max_uses: 1 };

  it("accepts a fresh invite", () => {
    expect(isInviteUsable(base, NOW)).toBe(true);
  });

  it("rejects revoked, expired and exhausted invites", () => {
    expect(isInviteUsable({ ...base, revoked_at: past }, NOW)).toBe(false);
    expect(isInviteUsable({ ...base, expires_at: past }, NOW)).toBe(false);
    expect(isInviteUsable({ ...base, use_count: 1 }, NOW)).toBe(false);
  });
});

describe("host succession", () => {
  const members = [
    { user_id: "host", role: "host", status: "joined", joined_at: "2026-01-01T00:00:00Z" },
    { user_id: "guest", role: "guest", status: "joined", joined_at: "2026-01-01T01:00:00Z" },
    { user_id: "member-old", role: "member", status: "joined", joined_at: "2026-01-01T02:00:00Z" },
    { user_id: "member-new", role: "member", status: "joined", joined_at: "2026-01-01T03:00:00Z" },
    { user_id: "mod", role: "moderator", status: "joined", joined_at: "2026-01-01T04:00:00Z" },
    { user_id: "cohost", role: "co_host", status: "joined", joined_at: "2026-01-01T05:00:00Z" },
  ];

  it("prefers co-host, then moderator, then earliest member", () => {
    expect(pickSuccessor(members, "host")).toBe("cohost");
    expect(pickSuccessor(members.filter((m) => m.user_id !== "cohost"), "host")).toBe("mod");
    expect(
      pickSuccessor(
        members.filter((m) => !["cohost", "mod"].includes(m.user_id)),
        "host",
      ),
    ).toBe("member-old");
  });

  it("ignores members who already left and the leaver themselves", () => {
    const left = members.map((m) =>
      m.user_id === "cohost" ? { ...m, status: "left" } : m,
    );
    expect(pickSuccessor(left, "host")).toBe("mod");
    expect(pickSuccessor([members[0]!], "host")).toBeNull();
  });

  it("ends the room when the host is the last member", () => {
    expect(hostLeaveOutcome([members[0]!], "host")).toEqual({ outcome: "room_ended" });
    expect(hostLeaveOutcome(members, "host")).toEqual({
      outcome: "host_transferred",
      successor: "cohost",
    });
  });
});