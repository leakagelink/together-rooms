/**
 * In-app activity notifications.
 *
 * The database is authoritative: triggers write rows into `notifications`, and
 * this hook only reads them (RLS scopes every read to the signed-in user) and
 * flips read state through the `mark_notifications_read` RPC. New rows arrive
 * over a single postgres_changes subscription, so the badge updates live
 * without polling.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

const NOTIFICATIONS_KEY = ["notifications", "mine"] as const;
const PAGE_SIZE = 50;

export function useNotifications() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, body, data, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as AppNotification[];
    },
  });

  // Live delivery. One channel per signed-in user; torn down on sign-out.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

  const items = useMemo(() => query.data ?? [], [query.data]);
  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  const markAllRead = useCallback(async () => {
    const { error } = await supabase.rpc("mark_notifications_read", {});
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  }, [queryClient]);

  const markRead = useCallback(
    async (id: string) => {
      const { error } = await supabase.rpc("mark_notifications_read", { _ids: [id] });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
    [queryClient],
  );

  const clearAll = useCallback(async () => {
    const { error } = await supabase.rpc("clear_notifications");
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  }, [queryClient]);

  return {
    items,
    unreadCount,
    isPending: query.isPending,
    isError: query.isError,
    markRead,
    markAllRead,
    clearAll,
  };
}
