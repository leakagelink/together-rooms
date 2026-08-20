import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc } from "@/lib/server/rpc.server";
import type { Json, RpcResult } from "@/lib/rpc-types";

/** Structured, machine-readable export of the caller's own data. */
export const exportUserData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RpcResult<{ export: Json }>> => {
    // 3 exports per rolling 24h — data export is expensive and enumerable.
    const { data: allowed, error: rlError } = await context.supabase.rpc("consume_rate_limit", {
      _action: "export_user_data",
      _limit: 3,
      _window_seconds: 86_400,
    });
    if (rlError) {
      console.error("[export_user_data:quota]", rlError.message);
      return { ok: false, reason: "server_error" };
    }
    if (allowed === false) return { ok: false, reason: "rate_limited" };

    const { data, error } = await context.supabase.rpc("export_user_data");
    if (error) {
      console.error("[export_user_data]", error.message);
      return { ok: false, reason: "server_error" };
    }
    return { ok: true, export: (data ?? null) as Json };
  });

/**
 * Record a deletion request, then perform the deletion.
 *
 * Deletion is two-stage and honest about it: purge_user_data() hands over or
 * ends every room the user hosts and removes their personal rows, then the Auth
 * admin API deletes the authentication account itself. If the Auth deletion
 * fails the request row is marked `failed` and the user is told the request is
 * still pending — we never claim an instant deletion that did not happen.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        confirmation: z.string(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RpcResult<{ status: "completed" | "pending" }>> => {
    if (data.confirmation !== "DELETE") return { ok: false, reason: "invalid_request" };

    const { data: requested, error: reqError } = await context.supabase.rpc(
      "request_account_deletion",
      { _reason: data.reason ?? "" },
    );
    const normalized = normalizeRpc<{ request_id: string }>(
      "request_account_deletion",
      requested,
      reqError,
    );
    if (!normalized.ok) return normalized;

    const userId = context.userId;
    const requestId = normalized.request_id;

    // Service role is required only here: deleting the Auth account is an
    // Auth Admin API operation with no user-scoped equivalent.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ status: "processing" })
      .eq("id", requestId);

    const { error: purgeError } = await supabaseAdmin.rpc("purge_user_data", {
      _user_id: userId,
    });
    if (purgeError) {
      console.error("[delete_account:purge]", purgeError.message);
      await supabaseAdmin
        .from("account_deletion_requests")
        .update({ status: "failed", error: "purge_failed" })
        .eq("id", requestId);
      return { ok: true, status: "pending" };
    }

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("[delete_account:auth]", authError.message);
      await supabaseAdmin
        .from("account_deletion_requests")
        .update({ status: "failed", error: "auth_delete_failed" })
        .eq("id", requestId);
      return { ok: true, status: "pending" };
    }

    return { ok: true, status: "completed" };
  });
