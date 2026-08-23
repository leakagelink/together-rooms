import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc, rpcArgs } from "@/lib/server/rpc.server";
import type { Json } from "@/lib/rpc-types";

/**
 * Phase 7 — private local media rooms.
 *
 * Every authoritative write is a SECURITY DEFINER RPC that re-checks
 * authentication, joined membership, room lifecycle, sharing permission mode,
 * blocks, session state, credential validity and rate limits inside one
 * transaction. The tables carry no client DML grants and a guard trigger
 * rejects direct writes, so these are the only write paths.
 *
 * No media bytes, filename, device path or public URL ever passes through
 * this layer: only a media kind, a MIME type, a coarse duration and session
 * control actions.
 */

const uuid = z.string().uuid();
const version = z.number().int().min(0).nullable().optional();
const token = z.string().min(32).max(200);

export const getLocalMediaSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ room_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("local_media_snapshot", {
      _room_id: data.room_id,
    });
    return normalizeRpc<{ session: Json; share_mode: string; allow_relay: boolean }>(
      "local_media_snapshot",
      result,
      error,
    );
  });

export const setLocalMediaSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        share_mode: z.enum(["host_only", "collaborative"]).optional(),
        allow_relay: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "set_local_media_settings",
      rpcArgs(
        { _room_id: data.room_id },
        { _share_mode: data.share_mode, _allow_relay: data.allow_relay },
      ),
    );
    return normalizeRpc<{ share_mode: string; allow_relay: boolean }>(
      "set_local_media_settings",
      result,
      error,
    );
  });

export const startLocalMediaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        media_kind: z.enum(["image", "video", "audio"]),
        // Sanitized on the client and re-validated in SQL against a strict
        // pattern; anything else is rejected rather than stored.
        mime_type: z
          .string()
          .regex(/^(image|video|audio)\/[A-Za-z0-9.+_-]+$/)
          .max(100)
          .optional(),
        duration_seconds: z.number().min(0).max(86400).optional(),
        item_count: z.number().int().min(1).max(50).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "start_local_media_session",
      rpcArgs(
        { _room_id: data.room_id, _media_kind: data.media_kind },
        {
          _mime_type: data.mime_type,
          _duration_seconds: data.duration_seconds,
          _item_count: data.item_count,
        },
      ),
    );
    return normalizeRpc<{ session_id: string; version: number; expires_at: string }>(
      "start_local_media_session",
      result,
      error,
    );
  });

export const endLocalMediaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("end_local_media_session", {
      _session_id: data.session_id,
    });
    return normalizeRpc("end_local_media_session", result, error);
  });

export const heartbeatLocalMediaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("local_media_owner_heartbeat", {
      _session_id: data.session_id,
    });
    return normalizeRpc("local_media_owner_heartbeat", result, error);
  });

/** Viewers call this when the owner has been silent; the server decides. */
export const reapLocalMediaOwnerAbsence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "reap_local_media_owner_absence",
      { _session_id: data.session_id },
    );
    return normalizeRpc<{ ended: boolean }>("reap_local_media_owner_absence", result, error);
  });

export const controlLocalMediaPlayback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        session_id: uuid,
        action: z.enum(["play", "pause", "seek", "set_index", "transport"]),
        position_seconds: z.number().min(0).max(86400).nullable().optional(),
        index: z.number().int().min(0).max(50).nullable().optional(),
        expected_version: version,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "control_local_media_playback",
      rpcArgs(
        { _session_id: data.session_id, _action: data.action },
        {
          _position_seconds: data.position_seconds,
          _index: data.index,
          _expected_version: data.expected_version,
        },
      ),
    );
    return normalizeRpc<{
      version: number;
      playback_status: string;
      position_seconds: number;
      playback_started_at: string | null;
      current_index: number;
      transport_state: string;
    }>("control_local_media_playback", result, error);
  });

/**
 * Issues a short-lived transport credential (5 minutes, capped by the session
 * expiry). The plaintext token exists only in the response; the database keeps
 * a SHA-256 hash. Every use re-verifies membership, so a removed member's
 * credential stops working immediately.
 */
export const issueTransportGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "issue_local_media_transport_grant",
      { _session_id: data.session_id },
    );
    return normalizeRpc<{
      token: string;
      role: "owner" | "viewer";
      relay_allowed: boolean;
      expires_at: string;
      ttl_seconds: number;
    }>("issue_local_media_transport_grant", result, error);
  });

export const redeemTransportGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid, token }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "redeem_local_media_transport_grant",
      { _session_id: data.session_id, _token: data.token },
    );
    return normalizeRpc<{
      role: "owner" | "viewer";
      relay_allowed: boolean;
      expires_at: string;
      ttl_seconds: number;
    }>("redeem_local_media_transport_grant", result, error);
  });

export const postSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        session_id: uuid,
        token,
        recipient_id: uuid,
        kind: z.enum(["offer", "answer", "ice", "bye"]),
        payload: z.record(z.unknown()),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("post_local_media_signal", {
      _session_id: data.session_id,
      _token: data.token,
      _recipient_id: data.recipient_id,
      _kind: data.kind,
      _payload: data.payload as Json,
    });
    return normalizeRpc("post_local_media_signal", result, error);
  });

export const fetchSignals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid, token }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("fetch_local_media_signals", {
      _session_id: data.session_id,
      _token: data.token,
    });
    return normalizeRpc<{ signals: Json }>("fetch_local_media_signals", result, error);
  });
