/**
 * Single source of truth for "where does this notification open?".
 *
 * Used by both the in-app bell and the Android push-tap handler so a
 * notification always lands on the same screen regardless of entry point.
 */

export type NotificationTarget =
  | { to: "/rooms/$roomId"; params: { roomId: string }; search: { tab: RoomDeepTab } }
  | { to: "/settings" }
  | { to: "/rooms" };

export type RoomDeepTab = "stage" | "chat" | "people" | "share";

const TAB_BY_TYPE: Record<string, RoomDeepTab> = {
  chat_message: "chat",
  room_invite: "stage",
  member_joined: "people",
  member_left: "people",
  playback: "stage",
  queue: "stage",
  study: "stage",
  moderation: "chat",
};

/** Safely read `room_id` out of an arbitrary notification payload. */
export function roomIdFromData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)["room_id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function resolveNotificationTarget(type: string, data: unknown): NotificationTarget {
  if (type === "subscription" || type === "account") return { to: "/settings" };

  const roomId = roomIdFromData(data);
  if (roomId) {
    return {
      to: "/rooms/$roomId",
      params: { roomId },
      search: { tab: TAB_BY_TYPE[type] ?? "stage" },
    };
  }

  // No room context: fall back to the rooms list rather than dead-ending.
  return { to: "/rooms" };
}

/** Push payloads carry `payload` as a JSON string; parse defensively. */
export function parsePushPayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Resolve straight from an FCM data message (`{ type, payload }`). */
export function resolvePushTarget(data: Record<string, unknown>): NotificationTarget {
  const type = typeof data["type"] === "string" ? (data["type"] as string) : "";
  return resolveNotificationTarget(type, parsePushPayload(data["payload"]));
}
