import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  DoorOpen,
  Gavel,
  ListMusic,
  PlusCircle,
  LogOut,
  Settings,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";

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
  const router = useRouter();
  const online = useOnlineStatus();
  // Affordance only — the moderation RPCs re-check staff role in the database.
  const { isStaff } = useStaffContext();

  useEffect(() => {
    if (!online) return;
    const warmScreens = () => {
      void Promise.allSettled([
        router.preloadRoute({ to: "/rooms" }),
        router.preloadRoute({ to: "/rooms/new" }),
        router.preloadRoute({ to: "/playlists" }),
        router.preloadRoute({ to: "/profile" }),
        router.preloadRoute({ to: "/settings" }),
      ]);
    };
    const idle = window.requestIdleCallback?.(warmScreens, { timeout: 1200 });
    const timer = idle === undefined ? window.setTimeout(warmScreens, 250) : undefined;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [online, router]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {online ? null : <OfflineBanner />}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto grid h-14 w-full max-w-5xl grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-4">
          <div className="min-w-0">
            <BrandLogo />
          </div>
          <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
            {/* Primary destinations move to the bottom tab bar on phones. */}
            <Button asChild variant="ghost" size="sm" className="hidden rounded-xl sm:inline-flex">
              <Link to="/rooms">Rooms</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden rounded-xl sm:inline-flex">
              <Link to="/playlists">Playlists</Link>
            </Button>
            {isStaff ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="hidden rounded-xl sm:inline-flex"
              >
                <Link to="/admin">
                  <Gavel className="size-4" aria-hidden="true" />
                  <span>Moderation</span>
                </Link>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Account menu"
                  className="max-w-[10rem] rounded-xl sm:max-w-none"
                >
                  <UserIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="hidden truncate sm:inline">{user?.email ?? "Account"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
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
                {isStaff ? (
                  <DropdownMenuItem asChild className="sm:hidden">
                    <Link to="/admin">
                      <Gavel className="size-4" aria-hidden="true" /> Moderation
                    </Link>
                  </DropdownMenuItem>
                ) : null}
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 pt-5 pb-28 sm:px-4 sm:py-8 sm:pb-8">
        {children}
      </main>
      <MobileTabBar />
      <SiteFooter />
    </div>
  );
}

const TABS = [
  { to: "/rooms", label: "Rooms", icon: DoorOpen },
  { to: "/rooms/new", label: "Create", icon: PlusCircle },
  { to: "/playlists", label: "Playlists", icon: ListMusic },
  { to: "/profile", label: "Profile", icon: UserIcon },
] as const;

function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
    >
      <ul className="mx-auto grid max-w-5xl grid-cols-4">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              activeOptions={{ exact: to === "/rooms" }}
              className="flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold text-muted-foreground transition-colors [&.active]:text-primary"
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pt-6 pb-24 sm:pb-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} SyncTogether</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link to="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link to="/guidelines" className="hover:text-foreground">
            Community Guidelines
          </Link>
          <Link to="/delete-account" className="hover:text-foreground">
            Delete Account
          </Link>
        </nav>
      </div>
    </footer>
  );
}
