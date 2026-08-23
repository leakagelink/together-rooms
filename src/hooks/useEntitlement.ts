import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";

import { useAuth } from "@/hooks/useAuth";
import {
  FREE_SNAPSHOT,
  isSnapshotPremium,
  type EntitlementSnapshot,
  type PlanKey,
  type PlanLimits,
} from "@/lib/entitlements";
import { getMyEntitlement } from "@/lib/monetization.functions";
import { queryKeys } from "@/lib/query-keys";

/**
 * PHASE 9 — the single client entry point for entitlement state.
 *
 * The value is produced by the server (`my_entitlement`), which reads the
 * `entitlements` table the client has no write path to. Client-side code can
 * therefore only *display* a plan; every protected action is re-checked in the
 * database when it is performed.
 *
 * Offline behaviour: a failed refresh keeps the last authoritative snapshot
 * (React Query cache) rather than downgrading the user, and premium lapses
 * only when the snapshot's own expiry/grace timestamp has passed.
 */
export function useEntitlement() {
  const { user } = useAuth();
  const fetchEntitlement = useServerFn(getMyEntitlement);
  const queryClient = useQueryClient();

  const query = useQuery({
    enabled: Boolean(user),
    queryKey: queryKeys.account.entitlement(user?.id),
    staleTime: 60_000,
    // Keep the previous authoritative value on transient failures.
    retry: 2,
    queryFn: async (): Promise<EntitlementSnapshot> => {
      const result = await fetchEntitlement();
      if (!result || result.ok !== true) throw new Error("entitlement_unavailable");
      return result as unknown as EntitlementSnapshot;
    },
  });

  const snapshot = query.data ?? null;
  const premium = isSnapshotPremium(snapshot);
  const limits: PlanLimits = snapshot?.limits ?? FREE_SNAPSHOT.limits;

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.account.entitlement(user?.id) }),
    [queryClient, user?.id],
  );

  return {
    snapshot: snapshot ?? FREE_SNAPSHOT,
    plan: (premium ? "premium" : "free") as PlanKey,
    premium,
    limits,
    adsEnabled: !premium && (snapshot?.ads_enabled ?? true),
    isLoading: query.isPending,
    isError: query.isError,
    refresh,
  };
}
