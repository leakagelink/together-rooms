import { z } from "zod";

/**
 * Typed room event contract.
 *
 * Phase 2 implements only the membership/lifecycle events. Playback, chat,
 * reaction and screen-share types are declared so future phases have a stable
 * shape, but nothing emits or handles them yet.
 */
export const ROOM_EVENT_TYPES = [
  "ROOM_CREATED",
  "ROOM_UPDATED",
  "USER_JOINED",
  "USER_LEFT",
  "HOST_CHANGED",
  "ROOM_ENDED",
  // Reserved for future phases — declared, not implemented.
  "PLAY",
  "PAUSE",
  "SEEK",
  "CONTENT_CHANGED",
  "CHAT_MESSAGE",
  "REACTION",
  "SCREEN_SHARE_STARTED",
  "SCREEN_SHARE_STOPPED",
] as const;

export type RoomEventType = (typeof ROOM_EVENT_TYPES)[number];

/** Event types Phase 2 actually reacts to. */
export const IMPLEMENTED_ROOM_EVENT_TYPES = [
  "ROOM_CREATED",
  "ROOM_UPDATED",
  "USER_JOINED",
  "USER_LEFT",
  "HOST_CHANGED",
  "ROOM_ENDED",
] as const satisfies readonly RoomEventType[];

/**
 * Payloads are deliberately tiny and non-sensitive: no room names, no member
 * identities beyond opaque ids, no content of any kind.
 */
export const roomEventSchema = z.object({
  id: z.string().uuid(),
  room_id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  type: z.enum(ROOM_EVENT_TYPES),
  payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  created_at: z.string(),
});

export type RoomEvent = z.infer<typeof roomEventSchema>;

export function parseRoomEvent(raw: unknown): RoomEvent | null {
  const result = roomEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Presence state broadcast per connected member. Never contains room content. */
export const presenceStateSchema = z.object({
  user_id: z.string().uuid(),
  status: z.enum(["online", "away"]),
  joined_at: z.string(),
});

export type PresenceState = z.infer<typeof presenceStateSchema>;

export type PresenceStatus = "online" | "away" | "offline";
