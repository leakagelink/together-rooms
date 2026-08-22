import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { resolveMediaPolicy } from "@/lib/media-metadata.functions";
import { normalizeRpc } from "@/lib/server/rpc.server";
import type { Json } from "@/lib/rpc-types";

/**
 * Phase 5 — collaborative music queue mutations.
 *
 * The queue tables carry no client DML grants and a guard trigger rejects
 * direct writes, so these SECURITY DEFINER RPCs are the only write path. Each
 * RPC owns membership, queue-mode permission, media policy verification,
 * rate limiting and optimistic concurrency inside a single transaction.
 */

const uuid = z.string().uuid();
const mediaId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const optionalVersion = z.number().int().min(0).nullable().optional();

export type QueueResult = {
  item_id?: string;
  status?: string;
  queue_version?: number;
  outcome?: string;
  state?: Json;
};

/** Adds a track. Policy is resolved server-side first, then re-verified in SQL. */
export const addToQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, media_id: mediaId }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { ok, policy } = await resolveMediaPolicy(context.supabase, data.media_id);
    if (!ok) return { ok: false as const, reason: policy.status };

    const { data: result, error } = await context.supabase.rpc("add_to_queue", {
      _room_id: data.room_id,
      _provider: "youtube",
      _media_id: data.media_id,
    });
    return normalizeRpc<QueueResult>("add_to_queue", result, error);
  });

export const moveQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        item_id: uuid,
        target_index: z.number().int().min(0).max(500),
        expected_queue_version: z.number().int().min(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("move_queue_item", {
      _item_id: data.item_id,
      _target_index: data.target_index,
      _expected_queue_version: data.expected_queue_version,
    });
    return normalizeRpc<QueueResult>("move_queue_item", result, error);
  });

export const removeFromQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ item_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("remove_from_queue", {
      _item_id: data.item_id,
    });
    return normalizeRpc<QueueResult>("remove_from_queue", result, error);
  });

export const clearQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, expected_queue_version: optionalVersion }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("clear_queue", {
      _room_id: data.room_id,
      ...(data.expected_queue_version == null
        ? {}
        : { _expected_queue_version: data.expected_queue_version }),
    });
    return normalizeRpc<QueueResult>("clear_queue", result, error);
  });

export const approveQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ item_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("approve_queue_item", {
      _item_id: data.item_id,
    });
    return normalizeRpc<QueueResult>("approve_queue_item", result, error);
  });

export const rejectQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ item_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("reject_queue_item", {
      _item_id: data.item_id,
    });
    return normalizeRpc<QueueResult>("reject_queue_item", result, error);
  });

export const startQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, expected_version: optionalVersion }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("start_queue", {
      _room_id: data.room_id,
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
    });
    return normalizeRpc<QueueResult>("start_queue", result, error);
  });

/** Authoritative transition. `cause: "ended"` is the player's end-of-track report. */
export const advanceQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        expected_version: optionalVersion,
        cause: z.enum(["ended", "next"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("advance_queue", {
      _room_id: data.room_id,
      _cause: data.cause,
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
    });
    return normalizeRpc<QueueResult>("advance_queue", result, error);
  });

export const previousQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, expected_version: optionalVersion }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("previous_queue_item", {
      _room_id: data.room_id,
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
    });
    return normalizeRpc<QueueResult>("previous_queue_item", result, error);
  });

export const restartCurrentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, expected_version: optionalVersion }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("restart_current_item", {
      _room_id: data.room_id,
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
    });
    return normalizeRpc<QueueResult>("restart_current_item", result, error);
  });

export const setQueueMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        mode: z.enum(["host_only", "collaborative", "host_approval"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_queue_mode", {
      _room_id: data.room_id,
      _mode: data.mode,
    });
    return normalizeRpc<QueueResult>("set_queue_mode", result, error);
  });

export const setRepeatMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ room_id: uuid, mode: z.enum(["off", "repeat_one", "repeat_queue"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_repeat_mode", {
      _room_id: data.room_id,
      _mode: data.mode,
    });
    return normalizeRpc<QueueResult>("set_repeat_mode", result, error);
  });

export const setShuffleEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_shuffle_enabled", {
      _room_id: data.room_id,
      _enabled: data.enabled,
    });
    return normalizeRpc<QueueResult>("set_shuffle_enabled", result, error);
  });

export const startRoomFromPlaylist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, playlist_id: uuid }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("start_room_from_playlist", {
      _room_id: data.room_id,
      _playlist_id: data.playlist_id,
    });
    return normalizeRpc<QueueResult & { imported?: number; skipped?: number }>(
      "start_room_from_playlist",
      result,
      error,
    );
  });
