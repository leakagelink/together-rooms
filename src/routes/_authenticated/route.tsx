import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession() reads (and silently refreshes) the locally stored session,
    // so navigating between screens no longer waits on a network round trip.
    // Every data read still goes through RLS with that same token, so this is
    // a latency change only, not a weaker gate.
    const { data, error } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (error || !user) throw redirect({ to: "/auth/login" });
    return { user };
  },
  component: () => <Outlet />,
});
