import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc } from "@/lib/server/rpc.server";
import type { RpcResult } from "@/lib/rpc-types";

const joinCodeInput = z.object({
  join_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/),
});

const roomIdInput = z.object({ room_id: z.string().uuid() });

/**
 * Join a room using a code. All authorization, expiry/status/capacity checks,
 * block enforcement, rate limiting and membership creation happen atomically
 * inside public.join_room_by_code under a row lock on the room.
 */
export const joinRoomByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => joinCodeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("join_room_by_code", {
      _code: data.join_code,
    });
    return normalizeRpc<{ room_id: string; room_name: string; already_member: boolean }>(
      "join_room_by_code",
      result,
      error,
    );
  });

/** Leave a room. Handles host transfer / room end so no room is orphaned. */
export const leaveRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => roomIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("leave_room", {
      _room_id: data.room_id,
    });
    return normalizeRpc<{ outcome: "left" | "host_transferred" | "room_ended" | "not_a_member" }>(
      "leave_room",
      result,
      error,
    );
  });

/** End a room. Host-only, enforced inside the RPC. */
export const endRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => roomIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("end_room", {
      _room_id: data.room_id,
    });
    return normalizeRpc("end_room", result, error);
  });

/** Explicit host transfer. Host-only, target must be a joined member. */
export const transferRoomHost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: z.string().uuid(), to_user_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("transfer_room_host", {
      _room_id: data.room_id,
      _to_user: data.to_user_id,
    });
    return normalizeRpc("transfer_room_host", result, error);
  });

export interface RoomMemberEntry {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  joined_at: string;
}

/**
 * Member identities for a room. The RPC verifies membership internally and
 * returns nothing to non-members, so private profiles are never exposed.
 */
export const listRoomMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => roomIdInput.parse(input))
  .handler(async ({ data, context }): Promise<RpcResult<{ members: RoomMemberEntry[] }>> => {
    const { data: rows, error } = await context.supabase.rpc("room_member_directory", {
      _room_id: data.room_id,
    });
    if (error) {
      console.error("[room_member_directory]", error.message);
      return { ok: false, reason: "server_error" };
    }
    return { ok: true, members: (rows ?? []) as unknown as RoomMemberEntry[] };
  });