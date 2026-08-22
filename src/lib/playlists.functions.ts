import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { resolveMediaPolicy } from "@/lib/media-metadata.functions";
import { normalizeRpc } from "@/lib/server/rpc.server";

/**
 * Phase 5 — SyncTogether playlists.
 *
 * Playlists are ordinary owned rows, but every mutation still goes through a
 * SECURITY DEFINER RPC so ownership, item caps, ordering and server-side media
 * policy verification stay authoritative.
 */

const uuid = z.string().uuid();
const mediaId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

export type PlaylistResult = {
  playlist_id?: string;
  item_id?: string;
  version?: number;
};

export const createPlaylist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("create_playlist", {
      _name: data.name,
      _description: data.description ?? null,
    });
    return normalizeRpc<PlaylistResult>("create_playlist", result, error);
  });

export const updatePlaylist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        playlist_id: uuid,
        name: z.string().trim().min(1).max(80).nullable().optional(),
        description: z.string().trim().max(500).nullable().optional(),
        visibility: z.enum(["private", "room", "public"]).nullable().optional(),
        room_id: uuid.nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("update_playlist", {
      _playlist_id: data.playlist_id,
      _name: data.name ?? null,
      _description: data.description ?? null,
      _visibility: data.visibility ?? null,
      _room_id: data.room_id ?? null,
    });
    return normalizeRpc<PlaylistResult>("update_playlist", result, error);
  });

export const deletePlaylist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ playlist_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("delete_playlist", {
      _playlist_id: data.playlist_id,
    });
    return normalizeRpc("delete_playlist", result, error);
  });

export const addPlaylistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ playlist_id: uuid, media_id: mediaId }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { ok, policy } = await resolveMediaPolicy(context.supabase, data.media_id);
    if (!ok) return { ok: false as const, reason: policy.status };

    const { data: result, error } = await context.supabase.rpc("add_playlist_item", {
      _playlist_id: data.playlist_id,
      _provider: "youtube",
      _media_id: data.media_id,
    });
    return normalizeRpc<PlaylistResult>("add_playlist_item", result, error);
  });

export const removePlaylistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ item_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("remove_playlist_item", {
      _item_id: data.item_id,
    });
    return normalizeRpc<PlaylistResult>("remove_playlist_item", result, error);
  });

export const movePlaylistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        item_id: uuid,
        target_index: z.number().int().min(0).max(500),
        expected_version: z.number().int().min(0).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("move_playlist_item", {
      _item_id: data.item_id,
      _target_index: data.target_index,
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
    });
    return normalizeRpc<PlaylistResult>("move_playlist_item", result, error);
  });
