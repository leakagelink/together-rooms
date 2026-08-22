import { Link, useNavigate } from "@tanstack/react-router";
import { Gavel, LogOut, Settings, ShieldCheck, User as UserIcon } from "lucide-react";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand";
import { OfflineBanner } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useStaffContext } from "@/hooks/useStaffContext";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  // Affordance only — the moderation RPCs re-check staff role in the database.
  const { isStaff } = useStaffContext();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {online ? null : <OfflineBanner />}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
          <BrandLogo />
          <nav aria-label="Main" className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link to="/rooms">Rooms</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/playlists">Playlists</Link>
            </Button>
            {isStaff ? (
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin">
                  <Gavel className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Moderation</span>
                </Link>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Account menu">
                  <UserIcon className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{user?.email ?? "Account"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <Link to="/profile">
                    <UserIcon className="size-4" aria-hidden="true" /> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings className="size-4" aria-hidden="true" /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings/privacy">
                    <ShieldCheck className="size-4" aria-hidden="true" /> Privacy
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    await signOut();
                    navigate({ to: "/auth/login" });
                  }}
                >
                  <LogOut className="size-4" aria-hidden="true" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} SyncTogether</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          <Link to="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link to="/guidelines" className="hover:text-foreground">
            Community Guidelines
          </Link>
        </nav>
      </div>
    </footer>
  );
}
