import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeRpc } from "@/lib/server/rpc.server";
import { checkResourceUrl } from "@/lib/url-safety";
import { parseYouTubeVideoId } from "@/lib/providers/youtube";
import type { Json } from "@/lib/rpc-types";

/**
 * Phase 6 — Study & Research workspace mutations.
 *
 * The study tables carry no client DML grants and a guard trigger rejects any
 * direct write, so these SECURITY DEFINER RPCs are the only write path. Each
 * RPC re-checks membership, room lifecycle, permission mode, rate limit and
 * version/revision inside one transaction; these server functions add input
 * validation, URL safety, normalization and safe error shaping.
 *
 * NO ARBITRARY URL IS EVER FETCHED. YouTube links are recognised locally by
 * id, everything else is stored as a plain reference with a user-supplied
 * title, which is why this layer has no SSRF surface at all.
 */

const uuid = z.string().uuid();
const title = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000).optional();

export type StudyResult = {
  resource_id?: string;
  note_id?: string;
  task_id?: string;
  status?: string;
  revision?: number;
  version?: number;
  focus_version?: number;
  state?: Json;
};

/* ------------------------------------------------------------- resources */

export const addRoomResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        resource_type: z.enum(["web_link", "youtube", "document_reference", "note"]),
        title,
        url: z.string().trim().max(2048).optional(),
        description,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let url: string | null = null;
    let normalized: string | null = null;
    let host: string | null = null;
    let providerMediaId: string | null = null;
    let resourceType = data.resource_type;

    if (resourceType !== "note") {
      const check = checkResourceUrl(data.url ?? "");
      if (!check.ok) return { ok: false as const, reason: "invalid_request" as const };
      url = check.url;
      normalized = check.normalized;
      host = check.host;
      const videoId = parseYouTubeVideoId(check.url);
      if (videoId) {
        resourceType = "youtube";
        providerMediaId = videoId;
      } else if (resourceType === "youtube") {
        // A "youtube" claim that isn't a YouTube URL degrades to a plain link
        // rather than being trusted.
        resourceType = "web_link";
      }
    }

    const { data: result, error } = await context.supabase.rpc("add_room_resource", {
      _room_id: data.room_id,
      _resource_type: resourceType,
      _title: data.title,
      _url: url,
      _normalized_url: normalized,
      _host: host,
      _description: data.description ?? undefined,
      _provider_media_id: providerMediaId,
    });
    return normalizeRpc<StudyResult>("add_room_resource", result, error);
  });

export const updateRoomResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ resource_id: uuid, title: title.optional(), description: description.nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("update_room_resource", {
      _resource_id: data.resource_id,
      _title: data.title ?? undefined,
      _description: data.description ?? undefined,
    });
    return normalizeRpc<StudyResult>("update_room_resource", result, error);
  });

export const setResourceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ resource_id: uuid, status: z.enum(["active", "archived", "rejected"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_resource_status", {
      _resource_id: data.resource_id,
      _status: data.status,
    });
    return normalizeRpc<StudyResult>("set_resource_status", result, error);
  });

export const setResourcePinned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ resource_id: uuid, pinned: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_resource_pinned", {
      _resource_id: data.resource_id,
      _pinned: data.pinned,
    });
    return normalizeRpc<StudyResult>("set_resource_pinned", result, error);
  });

export const removeRoomResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ resource_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("remove_room_resource", {
      _resource_id: data.resource_id,
    });
    return normalizeRpc<StudyResult>("remove_room_resource", result, error);
  });

export const setFocusedResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        resource_id: uuid.nullable(),
        expected_version: z.number().int().min(0).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_focused_resource", {
      _room_id: data.room_id,
      _resource_id: data.resource_id,
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
    });
    return normalizeRpc<StudyResult>("set_focused_resource", result, error);
  });

/* -------------------------------------------------------------- settings */

export const setStudySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        resource_mode: z.enum(["host_only", "collaborative", "host_approval"]).optional(),
        note_mode: z.enum(["host_only", "collaborative"]).optional(),
        timer_mode: z.enum(["host_only", "collaborative"]).optional(),
        focus_mode: z.enum(["host_sync", "free_navigation"]).optional(),
        private_research: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_study_settings", {
      _room_id: data.room_id,
      _resource_mode: data.resource_mode ?? undefined,
      _note_mode: data.note_mode ?? undefined,
      _timer_mode: data.timer_mode ?? undefined,
      _focus_mode: data.focus_mode ?? undefined,
      _private_research: data.private_research ?? undefined,
    });
    return normalizeRpc<StudyResult>("set_study_settings", result, error);
  });

/* ----------------------------------------------------------------- notes */

export const createRoomNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ room_id: uuid, title, content: z.string().max(20000).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("create_room_note", {
      _room_id: data.room_id,
      _title: data.title,
      _content: data.content ?? "",
    });
    return normalizeRpc<StudyResult>("create_room_note", result, error);
  });

export const updateRoomNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        note_id: uuid,
        expected_revision: z.number().int().min(1),
        title: title.optional(),
        content: z.string().max(20000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("update_room_note", {
      _note_id: data.note_id,
      _expected_revision: data.expected_revision,
      _title: data.title ?? undefined,
      _content: data.content ?? undefined,
    });
    return normalizeRpc<StudyResult>("update_room_note", result, error);
  });

export const deleteRoomNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ note_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("delete_room_note", {
      _note_id: data.note_id,
    });
    return normalizeRpc<StudyResult>("delete_room_note", result, error);
  });

/* ----------------------------------------------------------------- tasks */

export const createRoomTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ room_id: uuid, title, description, assigned_to: uuid.nullable().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("create_room_task", {
      _room_id: data.room_id,
      _title: data.title,
      _description: data.description ?? undefined,
      _assigned_to: data.assigned_to ?? undefined,
    });
    return normalizeRpc<StudyResult>("create_room_task", result, error);
  });

export const updateRoomTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        task_id: uuid,
        status: z.enum(["todo", "in_progress", "completed"]).optional(),
        assigned_to: uuid.nullable().optional(),
        clear_assignee: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("update_room_task", {
      _task_id: data.task_id,
      _status: data.status ?? undefined,
      _assigned_to: data.assigned_to ?? undefined,
      _clear_assignee: data.clear_assignee ?? false,
    });
    return normalizeRpc<StudyResult>("update_room_task", result, error);
  });

export const deleteRoomTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ task_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("delete_room_task", {
      _task_id: data.task_id,
    });
    return normalizeRpc<StudyResult>("delete_room_task", result, error);
  });

/* ----------------------------------------------------------------- timer */

export const controlFocusTimer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        room_id: uuid,
        action: z.enum(["start", "pause", "resume", "reset", "complete"]),
        phase: z.enum(["focus", "short_break", "long_break", "custom"]).optional(),
        duration_seconds: z.number().int().min(60).max(14400).optional(),
        expected_version: z.number().int().min(0).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("control_focus_timer", {
      _room_id: data.room_id,
      _action: data.action,
      _phase: data.phase ?? undefined,
      _duration_seconds: data.duration_seconds ?? undefined,
      ...(data.expected_version == null ? {} : { _expected_version: data.expected_version }),
    });
    return normalizeRpc<StudyResult>("control_focus_timer", result, error);
  });

/* --------------------------------------------------------------- summary */

export const getStudySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ room_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("study_session_summary", {
      _room_id: data.room_id,
    });
    return normalizeRpc<{
      resources_active?: number;
      resources_pending?: number;
      resources_archived?: number;
      notes_total?: number;
      note_revisions?: number;
      tasks_total?: number;
      tasks_completed?: number;
      focus_sessions_completed?: number;
    }>("study_session_summary", result, error);
  });
