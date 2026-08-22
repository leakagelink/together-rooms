import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { policyToJsonb, resolveMediaPolicy } from "@/lib/media-metadata.functions";
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
        expected_version: version,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Enforce the YouTube content policy before changing the room's media.
    // The policy is resolved server-side and cached; this also blocks videos
    // marked Made for Kids, non-embeddable, or private.
    const { ok, policy } = await resolveMediaPolicy(context.supabase, data.media_id);
    if (!ok) {
      return { ok: false as const, reason: policy.status };
    }

    const { data: result, error } = await context.supabase.rpc("set_room_media", {
      _room_id: data.room_id,
      _provider: data.provider,
      _media_id: data.media_id,
      ...(policy.title ? { _title: policy.title } : {}),
      ...(policy.thumbnail_url ? { _thumbnail_url: policy.thumbnail_url } : {}),
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
      _policy_check_result: policyToJsonb(policy) as never,
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
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
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
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
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
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
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
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
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
