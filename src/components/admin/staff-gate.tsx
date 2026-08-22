import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { useStaffContext } from "@/hooks/useStaffContext";

/**
 * UI-side staff gate.
 *
 * This is NOT the security boundary. Unauthenticated users are already
 * redirected by the `_authenticated` layout, and every staff data endpoint
 * re-checks `is_staff()` / `has_role('admin')` inside Postgres. This component
 * only avoids rendering a dashboard that would return `forbidden` for
 * everything.
 */
export function StaffGate({
  children,
  requireAdmin = false,
}: {
  children: ReactNode;
  requireAdmin?: boolean;
}) {
  const { isStaff, isAdmin, loading } = useStaffContext();

  if (loading) {
    return (
      <AppShell>
        <LoadingState label="Checking moderation access…" />
      </AppShell>
    );
  }

  if (!isStaff || (requireAdmin && !isAdmin)) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <ShieldAlert className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">Access denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {requireAdmin
              ? "Role management is restricted to administrators."
              : "This area is restricted to the SyncTogether moderation team."}
          </p>
          <Button asChild className="mt-6" variant="outline">
            <Link to="/rooms">Back to rooms</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return <>{children}</>;
}
