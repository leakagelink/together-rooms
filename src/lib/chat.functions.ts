import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc } from "@/lib/server/rpc.server";

/**
 * Chat mutations. Every write goes through a SECURITY DEFINER RPC that owns
 * membership, mute, lifecycle, rate-limit and duplicate checks atomically.
 * Direct PostgREST writes to room_messages / message_reactions are revoked and
 * additionally rejected by guard triggers, so these are the only write paths.
 */

const uuid = z.string().uuid();

export const sendRoomMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        content: z.string().trim().min(1).max(2000),
        parent_message_id: uuid.nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("send_room_message", {
      _room_id: data.room_id,
      _content: data.content,
      ...(data.parent_message_id ? { _parent_message_id: data.parent_message_id } : {}),
    });
    return normalizeRpc<{ message_id: string }>("send_room_message", result, error);
  });

export const editRoomMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ message_id: uuid, content: z.string().trim().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("edit_room_message", {
      _message_id: data.message_id,
      _content: data.content,
    });
    return normalizeRpc("edit_room_message", result, error);
  });

export const deleteRoomMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ message_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("delete_room_message", {
      _message_id: data.message_id,
    });
    return normalizeRpc<{ outcome: "removed" | "already_removed" }>(
      "delete_room_message",
      result,
      error,
    );
  });

export const toggleMessageReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        message_id: uuid,
        reaction: z.enum(["thumbs_up", "heart", "joy", "wow", "sad", "fire"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("toggle_message_reaction", {
      _message_id: data.message_id,
      _reaction: data.reaction,
    });
    return normalizeRpc<{ outcome: "set" | "replaced" | "removed" }>("toggle_message_reaction", result, error);
  });

export const reportRoomMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        message_id: uuid,
        category: z.string().trim().min(2).max(60),
        details: z.string().trim().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("report_message", {
      _message_id: data.message_id,
      _category: data.category,
      ...(data.details ? { _details: data.details } : {}),
    });
    return normalizeRpc<{ outcome: "reported" | "already_reported" }>(
      "report_message",
      result,
      error,
    );
  });

export const setMemberMute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, user_id: uuid, muted: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_member_mute", {
      _room_id: data.room_id,
      _user_id: data.user_id,
      _muted: data.muted,
    });
    return normalizeRpc<{ muted: boolean }>("set_member_mute", result, error);
  });
