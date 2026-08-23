import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { FocusTimerState } from "@/lib/study-timer";

/**
 * Phase 6 — one realtime subscription per room for the whole study workspace.
 *
 * A single channel carries resources, notes, tasks, timer and settings so the
 * room never opens duplicate sockets. Postgres RLS decides what the socket may
 * deliver, which is what makes membership revocation take effect for study
 * data exactly as it does for chat. Every event only invalidates a query — the
 * database stays the single authority.
 */

export interface RoomResource {
  id: string;
  room_id: string;
  resource_type: "web_link" | "youtube" | "document_reference" | "note";
  url: string | null;
  normalized_url: string | null;
  host: string | null;
  provider_media_id: string | null;
  title: string;
  description: string | null;
  added_by: string | null;
  status: "pending" | "active" | "archived" | "rejected";
  pinned: boolean;
  created_at: string;
}

export interface RoomNote {
  id: string;
  room_id: string;
  title: string;
  content: string;
  revision: number;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface RoomTask {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  status: "todo" | "in_progress" | "completed";
  created_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface StudySettings {
  room_id: string;
  resource_mode: "host_only" | "collaborative" | "host_approval";
  note_mode: "host_only" | "collaborative" | "host_approval";
  timer_mode: "host_only" | "collaborative" | "host_approval";
  focus_mode: "host_sync" | "free_navigation";
  private_research_mode: boolean;
  focused_resource_id: string | null;
  focus_version: number;
}

const DEFAULT_SETTINGS: Omit<StudySettings, "room_id"> = {
  resource_mode: "collaborative",
  note_mode: "collaborative",
  timer_mode: "host_only",
  focus_mode: "free_navigation",
  private_research_mode: true,
  focused_resource_id: null,
  focus_version: 0,
};

const DEFAULT_TIMER: FocusTimerState = {
  phase: "focus",
  status: "idle",
  duration_seconds: 1500,
  remaining_seconds: null,
  started_at: null,
  ends_at: null,
  sessions_completed: 0,
  version: 0,
};

export function useRoomStudy(roomId: string, enabled = true) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const resourcesQuery = useQuery({
    queryKey: queryKeys.study.resources(roomId),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_resources")
        .select(
          "id, room_id, resource_type, url, normalized_url, host, provider_media_id, title, description, added_by, status, pinned, created_at",
        )
        .eq("room_id", roomId)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as RoomResource[];
    },
  });

  const notesQuery = useQuery({
    queryKey: queryKeys.study.notes(roomId),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_notes")
        .select("id, room_id, title, content, revision, created_by, updated_by, updated_at")
        .eq("room_id", roomId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as RoomNote[];
    },
  });

  const tasksQuery = useQuery({
    queryKey: queryKeys.study.tasks(roomId),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_tasks")
        .select(
          "id, room_id, title, description, assigned_to, status, created_by, completed_by, completed_at, created_at",
        )
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as RoomTask[];
    },
  });

  const settingsQuery = useQuery({
    queryKey: queryKeys.study.settings(roomId),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_study_settings")
        .select(
          "room_id, resource_mode, note_mode, timer_mode, focus_mode, private_research_mode, focused_resource_id, focus_version",
        )
        .eq("room_id", roomId)
        .maybeSingle();
      if (error) throw error;
      return (data as StudySettings | null) ?? { room_id: roomId, ...DEFAULT_SETTINGS };
    },
  });

  const timerQuery = useQuery({
    queryKey: queryKeys.study.timer(roomId),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_focus_timer")
        .select(
          "phase, status, duration_seconds, remaining_seconds, started_at, ends_at, sessions_completed, version",
        )
        .eq("room_id", roomId)
        .maybeSingle();
      if (error) throw error;
      return (data as FocusTimerState | null) ?? DEFAULT_TIMER;
    },
  });

  useEffect(() => {
    if (!enabled || !roomId) return;
    // One channel per room; the ref guard keeps re-renders from stacking
    // duplicate subscriptions on the same socket.
    if (channelRef.current) return;

    const invalidate = (key: readonly unknown[]) => {
      void queryClient.invalidateQueries({ queryKey: key });
    };

    const channel = supabase
      .channel(`study:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_resources", filter: `room_id=eq.${roomId}` },
        () => invalidate(queryKeys.study.resources(roomId)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_notes", filter: `room_id=eq.${roomId}` },
        () => invalidate(queryKeys.study.notes(roomId)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_tasks", filter: `room_id=eq.${roomId}` },
        () => invalidate(queryKeys.study.tasks(roomId)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_focus_timer", filter: `room_id=eq.${roomId}` },
        () => invalidate(queryKeys.study.timer(roomId)),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_study_settings",
          filter: `room_id=eq.${roomId}`,
        },
        () => invalidate(queryKeys.study.settings(roomId)),
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          // Reconnect catch-up: re-read authoritative state, never replay.
          invalidate(queryKeys.study.resources(roomId));
          invalidate(queryKeys.study.notes(roomId));
          invalidate(queryKeys.study.tasks(roomId));
          invalidate(queryKeys.study.timer(roomId));
          invalidate(queryKeys.study.settings(roomId));
        }
      });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [enabled, roomId, queryClient]);

  const settings = settingsQuery.data ?? { room_id: roomId, ...DEFAULT_SETTINGS };
  const timer = timerQuery.data ?? DEFAULT_TIMER;

  const resources = useMemo(() => resourcesQuery.data ?? [], [resourcesQuery.data]);

  return {
    connected,
    settings,
    timer,
    resources,
    notes: notesQuery.data ?? [],
    tasks: tasksQuery.data ?? [],
    loading:
      resourcesQuery.isPending ||
      notesQuery.isPending ||
      tasksQuery.isPending ||
      settingsQuery.isPending ||
      timerQuery.isPending,
    error: resourcesQuery.error ?? notesQuery.error ?? tasksQuery.error ?? null,
  };
}
