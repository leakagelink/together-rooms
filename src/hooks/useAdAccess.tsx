import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAds } from "@/hooks/useAds";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/analytics";
import {
  claimRewardedView,
  getAdAccessState,
  FALLBACK_AD_ACCESS,
  type AdAccessState,
} from "@/lib/ads-access.functions";
import { queryKeys } from "@/lib/query-keys";

export type RewardPurpose = "unlock" | "extra_room";

/** The rewarded placement each reward is allowed to use. */
const PLACEMENT: Record<RewardPurpose, string> = {
  unlock: "full_access_unlock",
  extra_room: "extra_room_unlock",
};

export type RewardOutcome =
  | { ok: true; state: AdAccessState }
  | { ok: false; reason: "ad_unavailable" | "not_earned" | "daily_ad_limit_reached" | "failed" };

/**
 * The user-facing rewarded-ad flow.
 *
 * Order matters and is deliberate:
 *   1. ask the ad runtime for a rewarded ad (policy + consent + SDK),
 *   2. only if the SDK reports the reward as EARNED, ask the server to record
 *      it. The server owns the daily cap and the reward itself.
 */
export function useAdAccess() {
  const { user } = useAuth();
  const { requestRewarded, adsPossible } = useAds();
  const queryClient = useQueryClient();
  const fetchState = useServerFn(getAdAccessState);
  const claim = useServerFn(claimRewardedView);
  const [watching, setWatching] = useState(false);

  const query = useQuery({
    enabled: Boolean(user),
    queryKey: queryKeys.account.adAccess(user?.id),
    staleTime: 15_000,
    queryFn: () => fetchState(),
  });

  const state = query.data ?? FALLBACK_AD_ACCESS;

  const mutation = useMutation({
    mutationFn: (purpose: RewardPurpose) => claim({ data: { purpose } }),
  });

  const watchRewarded = useCallback(
    async (purpose: RewardPurpose): Promise<RewardOutcome> => {
      if (state.ads_remaining_today <= 0) {
        return { ok: false, reason: "daily_ad_limit_reached" };
      }
      setWatching(true);
      try {
        const earned = await requestRewarded(PLACEMENT[purpose]);
        if (!earned) {
          return { ok: false, reason: adsPossible ? "not_earned" : "ad_unavailable" };
        }
        const next = await mutation.mutateAsync(purpose);
        queryClient.setQueryData(queryKeys.account.adAccess(user?.id), next);
        void track("rewarded_ad_completed", { purpose });
        if (!next.ok) {
          return {
            ok: false,
            reason: next.reason === "daily_ad_limit_reached" ? "daily_ad_limit_reached" : "failed",
          };
        }
        return { ok: true, state: next };
      } catch {
        return { ok: false, reason: "failed" };
      } finally {
        setWatching(false);
      }
    },
    [adsPossible, mutation, queryClient, requestRewarded, state.ads_remaining_today, user?.id],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.account.adAccess(user?.id) });
  }, [queryClient, user?.id]);

  return { state, loading: query.isLoading, watching, watchRewarded, refresh, adsPossible };
}
