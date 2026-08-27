import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getStaffContext } from "@/lib/admin.functions";
import { queryKeys } from "@/lib/query-keys";
import { useAuth } from "@/hooks/useAuth";

export interface StaffState {
  isStaff: boolean;
  isAdmin: boolean;
  loading: boolean;
}

/**
 * Staff/admin state for UI affordances only. Authorization is enforced in
 * Postgres by every staff RPC; this hook exists so we don't render controls
 * that would always fail.
 */
export function useStaffContext(): StaffState {
  const { user, loading: authLoading } = useAuth();
  const fetchContext = useServerFn(getStaffContext);

  const query = useQuery({
    queryKey: queryKeys.staff.context(user?.id),
    queryFn: () => fetchContext(),
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  });

  const data = query.data;
  return {
    isStaff: Boolean(data?.ok && data.is_staff),
    isAdmin: Boolean(data?.ok && data.is_admin),
    loading: authLoading || (Boolean(user?.id) && query.isPending),
  };
}
