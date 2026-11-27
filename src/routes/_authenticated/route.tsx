import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getPersistentSession } from "@/lib/android/auth-session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Normal WebView/localStorage sessions are read first. Android cold starts
    // can additionally restore the app-private native copy before redirecting.
    // Every data read still goes through RLS with that same validated token.
    const { session, error } = await getPersistentSession();
    const user = session?.user;
    if (error || !user) throw redirect({ to: "/auth/login" });
    return { user };
  },
  component: () => <Outlet />,
});
