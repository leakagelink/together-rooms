import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/query-keys";

export type Plan = "free" | "pro" | "pro_plus";

/**
 * Reads the caller's own entitlement. The table is SELECT-only for
 * `authenticated` and has no client INSERT/UPDATE/DELETE grant at all, so a
 * user cannot grant themselves a plan. profiles.subscription_tier is
 * deprecated and must never be used for gating.
 */
export function useEntitlement() {
  const { user } = useAuth();
  const query = useQuery({
    enabled: Boolean(user),
    queryKey: queryKeys.account.entitlement(user?.id),
    staleTime: 60_000,
    queryFn: async (): Promise<Plan> => {
      const { data, error } = await supabase
        .from("entitlements")
        .select("plan, status, starts_at, expires_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.status !== "active") return "free";
      if (data.expires_at && new Date(data.expires_at) <= new Date()) return "free";
      return data.plan as Plan;
    },
  });

  return { plan: query.data ?? "free", isLoading: query.isPending };
}