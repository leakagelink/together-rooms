import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, Bell, DoorOpen, ListMusic, LogIn, PlusCircle, User as UserIcon } from "lucide-react";

import { BrandLogo } from "@/components/brand";
import { SiteFooter } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { DashboardActions, DashboardGreeting } from "@/components/rooms/dashboard-actions";
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
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-glass-border bg-background/55 pt-[env(safe-area-inset-top)] backdrop-blur-2xl">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-2 px-3 sm:px-4">
          <BrandLogo />
          <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => requireSignIn("/rooms")}
            >
              Rooms
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => requireSignIn("/playlists")}
            >
              Playlists
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Notifications"
              className="glass rounded-full"
              onClick={() => requireSignIn("/rooms")}
            >
              <Bell className="size-5" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Sign in"
              onClick={() => requireSignIn("/profile")}
            >
              <UserIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Sign in</span>
            </Button>
          </nav>
        </div>
      </header>

      <main className="animate-rise mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-10 sm:px-6 sm:py-8">
        <DashboardGreeting name={null} />
        <div className="mt-5">
          <DashboardActions
            onGuest={(target) =>
              requireSignIn(target.kind === "join" ? "/rooms/join" : "/rooms/new")
            }
          />
        </div>

        <section aria-labelledby="guest-rooms" className="mt-8">
          <h2 id="guest-rooms" className="text-lg">
            Your rooms
          </h2>
          <div className="glass mt-3 flex flex-col items-center gap-3 rounded-3xl p-8 text-center">
            <span className="bg-liquid flex size-14 items-center justify-center rounded-2xl text-primary-foreground">
              <LogIn className="size-6" aria-hidden="true" />
            </span>
            <h3 className="text-base">Sign in to see your rooms</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Real-time rooms for videos, music and more with your friends. Private and invite-only.
            </p>
            <div className="mt-1 flex w-full max-w-xs flex-col gap-2">
              <Button size="lg" onClick={() => requireSignIn("/rooms")}>
                Get Started <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <p className="text-sm text-muted-foreground">
                New here?{" "}
                <button
                  type="button"
                  className="font-semibold text-lavender underline-offset-4 hover:underline"
                  onClick={() => {
                    rememberPendingDestination("/rooms");
                    void navigate({ to: "/auth/signup" });
                  }}
                >
                  Create account
                </button>
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />

      <nav
        aria-label="Primary"
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 sm:hidden"
      >
        <ul className="glass-strong mx-auto grid max-w-md grid-cols-4 gap-1 rounded-[1.75rem] p-1.5">
          {GUEST_TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <button
                type="button"
                onClick={() => requireSignIn(to)}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-[1.35rem] px-1 py-1.5 text-[11px] font-semibold transition-colors active:scale-95 ${
                  to === "/rooms"
                    ? "bg-primary/25 text-foreground ring-1 ring-primary/45"
                    : "text-muted-foreground"
                }`}
              >
                <Icon className={`size-5 shrink-0 ${to === "/rooms" ? "text-lavender" : ""}`} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
