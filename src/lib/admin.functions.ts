import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc } from "@/lib/server/rpc.server";
import type { Json } from "@/lib/rpc-types";

/**
 * Phase 3.2 staff moderation operations.
 *
 * Every function here is a thin, authenticated wrapper over a SECURITY DEFINER
 * RPC that re-checks `is_staff(auth.uid())` or `has_role(auth.uid(),'admin')`
 * inside Postgres. Route gating and UI hiding are convenience only — the
 * database is the authorization boundary, so calling these endpoints directly
 * as a normal user returns `forbidden`.
 *
 * Removed-message plaintext is never returned by the queue or detail
 * endpoints. It is only reachable through `getRemovedMessage`, which calls the
 * audited `staff_get_removed_message` RPC.
 */

const uuid = z.string().uuid();

const reportStatus = z.enum(["open", "reviewing", "actioned", "dismissed"]);
const reportTarget = z.enum(["user", "room", "message", "other"]);
const appRole = z.enum(["moderator", "admin"]);
const actionType = z.enum([
  "warn",
  "mute",
  "kick",
  "ban",
  "suspend",
  "content_removed",
  "dismissed",
]);

export type ReportStatus = z.infer<typeof reportStatus>;
export type ReportTarget = z.infer<typeof reportTarget>;
export type AppStaffRole = z.infer<typeof appRole>;
export type ModerationActionType = z.infer<typeof actionType>;

export interface StaffContext {
  is_staff: boolean;
  is_admin: boolean;
}

export interface ReportRow {
  id: string;
  status: ReportStatus;
  category: string;
  target_type: ReportTarget;
  created_at: string;
  updated_at: string;
  target_user_id: string | null;
  target_name: string | null;
  room_id: string | null;
  room_name: string | null;
  has_message: boolean;
  action_count: number;
}

export interface RoleRow {
  user_id: string;
  role: AppStaffRole;
  created_at: string;
  display_name: string | null;
  username: string | null;
  email: string | null;
}

export interface UserSearchRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  roles: string[];
}

/** Whether the caller is staff. Cheap, and safe for every signed-in user. */
export const getStaffContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("my_staff_context");
    return normalizeRpc<StaffContext>("my_staff_context", data, error);
  });

export const getModerationOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("staff_moderation_overview");
    return normalizeRpc<{
      counts: { open: number; reviewing: number; actioned: number; dismissed: number; total: number };
      recent_actions: Json[];
      is_admin: boolean;
    }>("staff_moderation_overview", data, error);
  });

export const getReportQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        status: reportStatus.nullish(),
        target_type: reportTarget.nullish(),
        category: z.string().trim().max(60).nullish(),
        from: z.string().datetime().nullish(),
        to: z.string().datetime().nullish(),
        // Bounded server-side too; the RPC clamps to 50.
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(100_000).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("staff_report_queue", {
      ...(data.status ? { _status: data.status } : {}),
      ...(data.target_type ? { _target_type: data.target_type } : {}),
      ...(data.category ? { _category: data.category } : {}),
      ...(data.from ? { _from: data.from } : {}),
      ...(data.to ? { _to: data.to } : {}),
      _limit: data.limit,
      _offset: data.offset,
    });
    return normalizeRpc<{ total: number; limit: number; offset: number; rows: ReportRow[] }>(
      "staff_report_queue",
      result,
      error,
    );
  });

export const getReportDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ report_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("staff_report_detail", {
      _report_id: data.report_id,
    });
    return normalizeRpc<{
      report: Record<string, Json>;
      message: Record<string, Json> | null;
      actions: Record<string, Json>[];
      audit: Record<string, Json>[];
      is_admin: boolean;
    }>("staff_report_detail", result, error);
  });

export const setReportStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        report_id: uuid,
        status: reportStatus,
        note: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_report_status", {
      _report_id: data.report_id,
      _status: data.status,
      ...(data.note ? { _note: data.note } : {}),
    });
    return normalizeRpc<{ status: ReportStatus }>("set_report_status", result, error);
  });

export const createModerationAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        action: actionType,
        report_id: uuid.nullish(),
        room_id: uuid.nullish(),
        target_user_id: uuid.nullish(),
        reason: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("create_moderation_action", {
      // The SQL signature defaults these to NULL; the generated types mark
      // them required, so nulls are passed explicitly.
      _action: data.action,
      _report_id: data.report_id ?? null,
      _room_id: data.room_id ?? null,
      _target_user_id: data.target_user_id ?? null,
      _reason: data.reason ?? null,
    } as unknown as {
      _action: ModerationActionType;
      _report_id: string;
      _room_id: string;
      _target_user_id: string;
      _reason: string;
    });
    return normalizeRpc<{ id: string }>("create_moderation_action", result, error);
  });

/**
 * Restricted moderation evidence. Every successful call writes a
 * `moderation.removed_content_viewed` audit row inside the RPC. The result is
 * deliberately never cached by the caller.
 */
export const getRemovedMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ message_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("staff_get_removed_message", {
      _message_id: data.message_id,
    });
    return normalizeRpc<{
      content: string;
      room_id: string;
      sender_id: string | null;
      removal_kind: string;
      removed_at: string;
    }>("staff_get_removed_message", result, error);
  });

export const listAppRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_roles");
    return normalizeRpc<{ rows: RoleRow[]; self_id: string }>("admin_list_roles", data, error);
  });

export const searchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ q: z.string().trim().max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("admin_search_users", {
      _q: data.q,
    });
    return normalizeRpc<{ rows: UserSearchRow[] }>("admin_search_users", result, error);
  });

export const assignAppRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: uuid, role: appRole }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("assign_app_role", {
      _user_id: data.user_id,
      _role: data.role,
    });
    return normalizeRpc("assign_app_role", result, error);
  });

export const revokeAppRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: uuid, role: appRole }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("revoke_app_role", {
      _user_id: data.user_id,
      _role: data.role,
    });
    return normalizeRpc("revoke_app_role", result, error);
  });
