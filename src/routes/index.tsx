import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Headphones, Lock, MonitorPlay, ShieldCheck, Users } from "lucide-react";

import { BrandLogo } from "@/components/brand";
import { SiteFooter } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

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

const PILLARS = [
  {
    icon: MonitorPlay,
    title: "Watch together",
    body: "Shared rooms designed for authorized, officially embedded video players — never pirated streams.",
  },
  {
    icon: Headphones,
    title: "Listen together",
    body: "A room engine ready for licensed music providers, with lightweight synchronized state.",
  },
  {
    icon: BookOpen,
    title: "Study & research together",
    body: "Focus rooms for study sessions, revision and shared research with the people you trust.",
  },
  {
    icon: Users,
    title: "Couple, family & friends rooms",
    body: "Room types tuned to who you're with, with per-room roles and permissions.",
  },
  {
    icon: Lock,
    title: "Private by default",
    body: "Rooms are invite-only and undiscoverable. Public discovery is switched off.",
  },
  {
    icon: ShieldCheck,
    title: "Safety built in",
    body: "Reporting, blocking, host moderation and audit logging are part of the foundation.",
  },
];

function Index() {
  const { user, loading } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
          <BrandLogo />
          <div className="flex items-center gap-2">
            {loading ? null : user ? (
              <Button asChild size="sm">
                <Link to="/rooms">Open app</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/auth/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/auth/signup">Create account</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-4 pt-16 pb-12 sm:pt-24">
          <p className="text-sm font-medium tracking-wide text-primary uppercase">
            Watch. Listen. Study. Connect. Together.
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold text-balance sm:text-6xl">
            Private rooms for doing things together, in real time.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            SyncTogether gives couples, friends, families and students their own invite-only rooms —
            built privacy-first, moderated by design, and free of anything that requires bypassing a
            content provider.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to={user ? "/rooms/new" : "/auth/signup"}>
                {user ? "Create a room" : "Get started free"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/privacy">How we handle your data</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Early foundation release: room creation, invites and privacy controls are live.
            Synchronized playback, voice/video and AI features are not available yet.
          </p>
        </section>

        <section aria-labelledby="pillars" className="mx-auto w-full max-w-5xl px-4 pb-20">
          <h2 id="pillars" className="sr-only">
            What SyncTogether is building
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="surface-panel p-6">
                <span className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
