import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc } from "@/lib/server/rpc.server";
import type { Json } from "@/lib/rpc-types";

/**
 * Phase 4 playback mutations.
 *
 * Every authoritative write is a SECURITY DEFINER RPC that owns membership,
 * control permission, room lifecycle, media validation, optimistic-concurrency
 * and rate-limit checks in one transaction. Direct PostgREST writes to
 * `room_playback_state` have no grants and are additionally rejected by a
 * guard trigger, so these are the only write paths.
 */

const uuid = z.string().uuid();
const version = z.number().int().min(0).nullable().optional();

type StateResult = { state: Json };

export const setRoomMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        provider: z.literal("youtube"),
        media_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
        title: z.string().trim().max(200).optional(),
        thumbnail_url: z.string().url().max(500).optional(),
        expected_version: version,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_room_media", {
      _room_id: data.room_id,
      _provider: data.provider,
      _media_id: data.media_id,
      _title: data.title ?? null,
      _thumbnail_url: data.thumbnail_url ?? null,
      _expected_version: data.expected_version ?? null,
    });
    return normalizeRpc<StateResult>("set_room_media", result, error);
  });

export const playRoomMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, expected_version: version }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("play_room_media", {
      _room_id: data.room_id,
      _expected_version: data.expected_version ?? null,
    });
    return normalizeRpc<StateResult>("play_room_media", result, error);
  });

export const pauseRoomMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, expected_version: version }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("pause_room_media", {
      _room_id: data.room_id,
      _expected_version: data.expected_version ?? null,
    });
    return normalizeRpc<StateResult>("pause_room_media", result, error);
  });

export const seekRoomMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        position_seconds: z.number().min(0).max(86400),
        expected_version: version,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("seek_room_media", {
      _room_id: data.room_id,
      _position_seconds: data.position_seconds,
      _expected_version: data.expected_version ?? null,
    });
    return normalizeRpc<StateResult>("seek_room_media", result, error);
  });

export const clearRoomMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, expected_version: version }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("clear_room_media", {
      _room_id: data.room_id,
      _expected_version: data.expected_version ?? null,
    });
    return normalizeRpc<StateResult>("clear_room_media", result, error);
  });

/**
 * Server clock sample. Clients measure the offset between their own clock and
 * this value so `playback_started_at` arithmetic does not depend on a possibly
 * skewed device clock. Read-only, no database access.
 */
export const getServerTime = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ ok: true as const, now: new Date().toISOString() }));
