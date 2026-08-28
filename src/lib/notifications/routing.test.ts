import { describe, expect, it } from "vitest";

import { parsePushPayload, resolveNotificationTarget, resolvePushTarget } from "./routing";

const ROOM = "11111111-1111-4111-8111-111111111111";

describe("notification routing", () => {
  it.each([
    ["chat_message", "chat"],
    ["room_invite", "stage"],
    ["member_joined", "people"],
    ["member_left", "people"],
    ["playback", "stage"],
    ["queue", "stage"],
    ["study", "stage"],
    ["moderation", "chat"],
  ])("%s opens the room on the %s tab", (type, tab) => {
    expect(resolveNotificationTarget(type, { room_id: ROOM })).toEqual({
      to: "/rooms/$roomId",
      params: { roomId: ROOM },
      search: { tab },
    });
  });

  it("subscription opens billing settings", () => {
    expect(resolveNotificationTarget("subscription", { plan: "premium" })).toEqual({
      to: "/settings",
    });
  });

  it("falls back to the rooms list without a room id", () => {
    expect(resolveNotificationTarget("chat_message", {})).toEqual({ to: "/rooms" });
    expect(resolveNotificationTarget("unknown", null)).toEqual({ to: "/rooms" });
  });

  it("defaults unknown room types to the stage tab", () => {
    expect(resolveNotificationTarget("something_new", { room_id: ROOM })).toEqual({
      to: "/rooms/$roomId",
      params: { roomId: ROOM },
      search: { tab: "stage" },
    });
  });

  it("parses stringified push payloads and ignores malformed ones", () => {
    expect(parsePushPayload(JSON.stringify({ room_id: ROOM }))).toEqual({ room_id: ROOM });
    expect(parsePushPayload("not json")).toEqual({});
    expect(parsePushPayload(undefined)).toEqual({});
  });

  it("resolves an FCM data message end to end", () => {
    expect(
      resolvePushTarget({
        type: "chat_message",
        payload: JSON.stringify({ room_id: ROOM, message_id: "m1" }),
      }),
    ).toEqual({ to: "/rooms/$roomId", params: { roomId: ROOM }, search: { tab: "chat" } });

    expect(resolvePushTarget({ type: "subscription", payload: "{}" })).toEqual({
      to: "/settings",
    });
  });
});
