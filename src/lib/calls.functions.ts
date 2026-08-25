import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc, rpcArgs } from "@/lib/server/rpc.server";
import type { Json } from "@/lib/rpc-types";

/**
 * Phase 8 — private real-time voice & video.
 *
 * Every authoritative write is a SECURITY DEFINER RPC that re-checks
 * authentication, joined membership, room lifecycle, call permission mode,
 * blocking, participation, credential validity and rate limits inside one
 * transaction. The call tables carry no client DML grants and a guard trigger
 * rejects direct writes, so these are the only write paths.
 *
 * No audio, video, recording, transcript or device identity ever passes
 * through this layer: only call control state and signaling envelopes.
 */

const uuid = z.string().uuid();
const token = z.string().min(32).max(200);

export const getCallSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ room_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("call_snapshot", {
      _room_id: data.room_id,
    });
    return normalizeRpc<{
      session: Json;
      participants: Json;
      control_mode: string;
      admission: string;
      allow_relay: boolean;
      max_voice_participants: number;
      max_video_participants: number;
      server_time: string;
    }>("call_snapshot", result, error);
  });

export const setCallSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        control_mode: z.enum(["host_only", "collaborative"]).optional(),
        allow_relay: z.boolean().optional(),
        max_voice: z.number().int().min(2).max(8).optional(),
        max_video: z.number().int().min(2).max(4).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "set_call_settings",
      rpcArgs(
        { _room_id: data.room_id },
        {
          _control_mode: data.control_mode,
          _allow_relay: data.allow_relay,
          _max_voice: data.max_voice,
          _max_video: data.max_video,
        },
      ),
    );
    return normalizeRpc<{
      control_mode: string;
      allow_relay: boolean;
      max_voice_participants: number;
      max_video_participants: number;
    }>("set_call_settings", result, error);
  });

export const startCallSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ room_id: uuid, call_mode: z.enum(["voice", "video"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("start_call_session", {
      _room_id: data.room_id,
      _call_mode: data.call_mode,
    });
    return normalizeRpc<{
      session_id: string;
      call_mode: string;
      version: number;
      expires_at: string;
      existing: boolean;
    }>("start_call_session", result, error);
  });

export const endCallSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ session_id: uuid, expected_version: z.number().int().min(0).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "end_call_session",
      rpcArgs({ _session_id: data.session_id }, { _expected_version: data.expected_version }),
    );
    return normalizeRpc<{ already_ended?: boolean }>("end_call_session", result, error);
  });

export const joinCallSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ session_id: uuid, mic: z.boolean().optional(), camera: z.boolean().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "join_call_session",
      rpcArgs({ _session_id: data.session_id }, { _mic: data.mic, _camera: data.camera }),
    );
    return normalizeRpc<{
      session_id: string;
      call_mode: string;
      version: number;
      max_participants: number;
      expires_at: string;
    }>("join_call_session", result, error);
  });

export const leaveCallSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("leave_call_session", {
      _session_id: data.session_id,
    });
    return normalizeRpc("leave_call_session", result, error);
  });

export const setCallMediaState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        session_id: uuid,
        mic: z.boolean().optional(),
        camera: z.boolean().optional(),
        connection_state: z.enum(["connecting", "connected", "reconnecting", "failed"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "set_call_media_state",
      rpcArgs(
        { _session_id: data.session_id },
        {
          _mic: data.mic,
          _camera: data.camera,
          _connection_state: data.connection_state,
        },
      ),
    );
    return normalizeRpc("set_call_media_state", result, error);
  });

export const callHeartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("call_heartbeat", {
      _session_id: data.session_id,
    });
    return normalizeRpc("call_heartbeat", result, error);
  });

/**
 * Issues a short-lived transport credential (2 minutes, capped by the session
 * expiry). The plaintext token exists only in this response; the database
 * stores a SHA-256 hash. Every use re-verifies membership and live
 * participation, so a removed member's credential stops working immediately.
 */
export const issueCallGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("issue_call_transport_grant", {
      _session_id: data.session_id,
    });
    return normalizeRpc<{
      token: string;
      relay_allowed: boolean;
      expires_at: string;
      ttl_seconds: number;
    }>("issue_call_transport_grant", result, error);
  });

export const redeemCallGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid, token }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("redeem_call_transport_grant", {
      _session_id: data.session_id,
      _token: data.token,
    });
    return normalizeRpc<{ relay_allowed: boolean; expires_at: string; ttl_seconds: number }>(
      "redeem_call_transport_grant",
      result,
      error,
    );
  });

export const postCallSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        session_id: uuid,
        token,
        recipient_id: uuid,
        kind: z.enum(["offer", "answer", "ice", "bye", "renegotiate"]),
        payload: z.record(z.unknown()),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("post_call_signal", {
      _session_id: data.session_id,
      _token: data.token,
      _recipient_id: data.recipient_id,
      _kind: data.kind,
      _payload: data.payload as Json,
    });
    return normalizeRpc("post_call_signal", result, error);
  });

export const fetchCallSignals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ session_id: uuid, token }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("fetch_call_signals", {
      _session_id: data.session_id,
      _token: data.token,
    });
    return normalizeRpc<{ signals: Json }>("fetch_call_signals", result, error);
  });
