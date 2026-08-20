import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateInviteToken, hashInviteToken } from "@/lib/room-codes";
import { normalizeRpc } from "@/lib/server/rpc.server";
import type { RpcResult } from "@/lib/rpc-types";

/**
 * Create an invite. The plaintext token is generated server-side and returned
 * exactly once; only its SHA-256 hash is persisted, so a database reader cannot
 * mint working invite links.
 */
export const createRoomInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: z.string().uuid(),
        max_uses: z.number().int().min(1).max(100).default(1),
        expires_in_hours: z.number().int().min(1).max(720).default(24),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<RpcResult<{ token: string; invite_id: string; expires_at: string }>> => {
      const token = generateInviteToken();
      const tokenHash = await hashInviteToken(token);

      const { data: result, error } = await context.supabase.rpc("create_room_invite", {
        _room_id: data.room_id,
        _token_hash: tokenHash,
        _max_uses: data.max_uses,
        _expires_in_hours: data.expires_in_hours,
      });

      const normalized = normalizeRpc<{ invite_id: string; expires_at: string }>(
        "create_room_invite",
        result,
        error,
      );
      if (!normalized.ok) return normalized;
      return { ...normalized, token };
    },
  );

/** Revoke an invite. Host-only, enforced inside the RPC. */
export const revokeRoomInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invite_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("revoke_room_invite", {
      _invite_id: data.invite_id,
    });
    return normalizeRpc("revoke_room_invite", result, error);
  });

export interface InviteSummary {
  id: string;
  max_uses: number;
  use_count: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

/** List a room's invites (metadata only — never the token or its hash). */
export const listRoomInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ room_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<RpcResult<{ invites: InviteSummary[] }>> => {
    const { data: rows, error } = await context.supabase
      .from("room_invites")
      .select("id, max_uses, use_count, expires_at, revoked_at, created_at")
      .eq("room_id", data.room_id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("[list_room_invites]", error.message);
      return { ok: false, reason: "server_error" };
    }
    return { ok: true, invites: rows ?? [] };
  });

/**
 * Redeem an invite token. The browser only ever holds the plaintext token; the
 * server hashes it and the RPC does the lookup, so invites cannot be enumerated.
 */
export const redeemRoomInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().trim().regex(/^[a-f0-9]{48}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const tokenHash = await hashInviteToken(data.token);
    const { data: result, error } = await context.supabase.rpc("redeem_room_invite", {
      _token_hash: tokenHash,
    });
    return normalizeRpc<{ room_id: string; room_name: string; already_member: boolean }>(
      "redeem_room_invite",
      result,
      error,
    );
  });