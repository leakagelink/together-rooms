import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import {
  DoorOpen,
  Gavel,
  ListMusic,
  PlusCircle,
  Scale,
  LogOut,
  Settings,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { BackButton } from "@/components/back-button";
import { BrandLogo } from "@/components/brand";
import { NotificationBell } from "@/components/notification-bell";
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
import { UserAvatar } from "@/components/user-avatar";
import { myProfileQueryOptions } from "@/lib/profile-query";

export function AppShell({
  children,
  tone = "default",
}: {
  children: ReactNode;
  /** "cinema" renders the screen on the dark theme tokens (media rooms). */
  tone?: "default" | "cinema";
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const online = useOnlineStatus();
  // Affordance only — the moderation RPCs re-check staff role in the database.
  const { isStaff } = useStaffContext();
  const profile = useQuery({ ...myProfileQueryOptions(user?.id ?? ""), enabled: Boolean(user?.id) });
  const profileName = profile.data?.display_name || user?.email || "Account";

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
    <div
      className={`flex min-h-screen flex-col ${tone === "cinema" ? "dark text-foreground" : ""}`}
    >
      {online ? null : <OfflineBanner />}
      <header className="sticky top-0 z-30 border-b border-glass-border bg-background/55 pt-[env(safe-area-inset-top)] backdrop-blur-2xl">
        <div className="mx-auto grid h-16 w-full max-w-5xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-4">
          <BackButton homePaths={["/", "/rooms"]} />
          <div className="min-w-0">
            <BrandLogo />
          </div>
          <nav aria-label="Main" className="col-start-3 flex shrink-0 items-center gap-1 justify-self-end">
            {/* Primary destinations move to the bottom tab bar on phones. */}
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/rooms">Rooms</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/playlists">Playlists</Link>
            </Button>
            {isStaff ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex"
              >
                <Link to="/admin">
                  <Gavel className="size-4" aria-hidden="true" />
                  <span>Moderation</span>
                </Link>
              </Button>
            ) : null}
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="press flex items-center gap-2 rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-ring sm:pr-3 sm:glass"
                >
                  <UserAvatar name={profileName} src={profile.data?.avatar_url} size="sm" />
                  <span className="hidden max-w-[10rem] truncate text-sm font-semibold sm:inline">
                    {profile.data?.display_name || user?.email || "Account"}
                  </span>
                </button>
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
                <DropdownMenuItem asChild>
                  <Link to="/settings" hash="legal">
                    <Scale className="size-4" aria-hidden="true" /> Legal &amp; safety
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
      <main className="animate-rise mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-32 sm:px-6 sm:py-8 sm:pb-10">
        {children}
      </main>
      <MobileTabBar />
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
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 sm:hidden"
    >
      <ul className="glass-strong mx-auto grid max-w-md grid-cols-4 gap-1 rounded-[1.75rem] p-1.5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              activeOptions={{ exact: to === "/rooms" }}
              className="group flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[1.35rem] px-1 py-1.5 text-[11px] font-semibold text-muted-foreground transition-[color,background-color,box-shadow] duration-200 active:scale-95 [&.active]:bg-primary/25 [&.active]:text-foreground [&.active]:shadow-[inset_0_1px_0_oklch(1_0_0/0.12),0_6px_20px_oklch(0.606_0.219_293/0.35)] [&.active]:ring-1 [&.active]:ring-primary/45"
            >
              <Icon
                className="size-5 shrink-0 transition-transform duration-200 group-[.active]:scale-110 group-[.active]:text-lavender group-[.active]:drop-shadow-[0_0_8px_oklch(0.606_0.219_293/0.8)]"
                aria-hidden="true"
              />
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
    <footer className="border-t border-glass-border bg-background/40 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pt-6 pb-32 sm:pb-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
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
          <Link to="/child-safety" className="hover:text-foreground">
            Child Safety
          </Link>

          <Link to="/delete-account" className="hover:text-foreground">
            Delete Account
          </Link>
        </nav>
      </div>
    </footer>
  );
}
