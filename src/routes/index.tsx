import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  Bell,
  DoorOpen,
  ListMusic,
  LogIn,
  Plus,
  PlusCircle,
  User as UserIcon,
} from "lucide-react";

import { BrandLogo } from "@/components/brand";
import { SiteFooter } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { readLastRoute } from "@/lib/android/last-route";
import { rememberPendingDestination } from "@/lib/android/deep-link";

const TITLE = "SyncTogether — Watch. Listen. Study. Connect. Together.";
const DESCRIPTION =
  "Private, invite-only rooms where couples, friends, families and students watch, listen, study and connect together in real time.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Index,
});

const GUEST_TABS = [
  { to: "/rooms", label: "Rooms", icon: DoorOpen },
  { to: "/rooms/new", label: "Create", icon: PlusCircle },
  { to: "/playlists", label: "Playlists", icon: ListMusic },
  { to: "/profile", label: "Profile", icon: UserIcon },
] as const;

/**
 * Signed-out home: the same screen layout as "Your rooms", shown before
 * sign-in. Every app action opens the sign-in screen and, once signed in,
 * continues to the screen the visitor tapped. Legal pages stay public.
 */
function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // A signed-in user reopening the app resumes their last in-app screen.
  useEffect(() => {
    if (loading || !user) return;
    const target = readLastRoute() ?? "/rooms";
    void navigate({ to: target, replace: true });
  }, [loading, user, navigate]);

  function requireSignIn(destination: string) {
    // Only allow-listed in-app paths are stored (see deep-link.ts).
    rememberPendingDestination(destination);
    void navigate({ to: "/auth/login" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 px-3 sm:px-4">
          <BrandLogo />
          <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="hidden rounded-xl sm:inline-flex"
              onClick={() => requireSignIn("/rooms")}
            >
              Rooms
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hidden rounded-xl sm:inline-flex"
              onClick={() => requireSignIn("/playlists")}
            >
              Playlists
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Notifications"
              className="rounded-xl"
              onClick={() => requireSignIn("/rooms")}
            >
              <Bell className="size-5" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Sign in"
              className="rounded-xl"
              onClick={() => requireSignIn("/profile")}
            >
              <UserIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Sign in</span>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-3 pt-5 pb-10 sm:px-4 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Your rooms</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Private and invite-only. Public discovery is off in this release.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => requireSignIn("/rooms/join")}>
              <DoorOpen className="size-4" aria-hidden="true" /> Join
            </Button>
            <Button onClick={() => requireSignIn("/rooms/new")}>
              <Plus className="size-4" aria-hidden="true" /> New room
            </Button>
          </div>
        </div>

        <div className="mt-8">
          <div className="surface-panel flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <LogIn className="size-5" aria-hidden="true" />
            </span>
            <h2 className="text-base font-semibold">Sign in to see your rooms</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Watch, listen, study and chat together in private rooms with the people you know.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button onClick={() => requireSignIn("/rooms")}>Sign in</Button>
              <Button
                variant="outline"
                onClick={() => {
                  rememberPendingDestination("/rooms");
                  void navigate({ to: "/auth/signup" });
                }}
              >
                Create account
              </Button>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
      >
        <ul className="mx-auto grid max-w-5xl grid-cols-4">
          {GUEST_TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <button
                type="button"
                onClick={() => requireSignIn(to)}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors ${
                  to === "/rooms" ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
