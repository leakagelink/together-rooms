import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { revalidationPlan, type LifecycleContext } from "@/lib/android/lifecycle";

/**
 * PHASE 10 — foreground / network recovery.
 *
 * Returning from the background or from a network interruption only ever
 * triggers *reads*: the session is re-read, then the authoritative room,
 * playback, chat, call and entitlement queries are invalidated so React Query
 * refetches them. Nothing here leaves a room, ends a call or writes anything,
 * so an Android lifecycle event can never mutate another member's state.
 */
export function useAppLifecycle(context: LifecycleContext) {
  const queryClient = useQueryClient();
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (typeof document === "undefined") return;

    let backgroundedAt: number | null = null;

    const recover = async (event: "foreground" | "online") => {
      const plan = revalidationPlan(event, contextRef.current);
      if (!plan.session) return;
      // Re-read the session first; everything downstream depends on it.
      await supabase.auth.getSession();
      // Refetch every active authoritative query rather than trusting the
      // snapshot the app was suspended with.
      await queryClient.invalidateQueries({ type: "active" });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        backgroundedAt = Date.now();
        return;
      }
      if (backgroundedAt === null) return;
      backgroundedAt = null;
      void recover("foreground");
    };

    const onOnline = () => void recover("online");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [queryClient]);
}
