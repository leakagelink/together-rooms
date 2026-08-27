import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  BookOpen,
  Headphones,
  Heart,
  Lock,
  MonitorPlay,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { BrandLogo } from "@/components/brand";
import { SiteFooter } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { readLastRoute } from "@/lib/android/last-route";

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

const SMALL_TILES = [
  {
    icon: Headphones,
    emoji: "🎧",
    title: "Listen together",
    body: "A shared queue built on licensed music providers, with lightweight synchronized state.",
    tone: "pink",
  },
  {
    icon: BookOpen,
    emoji: "📚",
    title: "Study & research",
    body: "Focus rooms with a shared timer, resource board and notes for revision nights.",
    tone: "violet",
  },
  {
    icon: MessageSquare,
    emoji: "💬",
    title: "Chat in the room",
    body: "Private room chat with reactions and moderation — no public feeds, no discovery.",
    tone: "plain",
  },
  {
    icon: Users,
    emoji: "💞",
    title: "Couple, family & friends",
    body: "Room types tuned to who you're with, with per-room roles and permissions.",
    tone: "amber",
  },
  {
    icon: Lock,
    emoji: "🔒",
    title: "Private by default",
    body: "Rooms are invite-only and undiscoverable. Public discovery stays switched off.",
    tone: "violet",
  },
  {
    icon: ShieldCheck,
    emoji: "🛡️",
    title: "Safety built in",
    body: "Reporting, blocking, host moderation and audit logging are part of the foundation.",
    tone: "pink",
  },
] as const;

const TONES: Record<string, string> = {
  pink: "bg-accent-pink/5 border border-accent-pink/15",
  violet: "bg-accent-violet/8 border border-accent-violet/15",
  amber: "bg-sunset-to/8 border border-sunset-to/20",
  plain: "bg-card border border-border shadow-soft",
};

const ICON_TONES: Record<string, string> = {
  pink: "bg-accent-pink text-primary-foreground",
  violet: "bg-accent-violet text-primary-foreground",
  amber: "bg-sunset-to text-primary-foreground",
  plain: "bg-foreground text-background",
};

function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // A signed-in user reopening the app (or the Android shell after a cold
  // start) resumes their last in-app screen instead of the public landing
  // page. Signed-out visitors always see the landing page.
  useEffect(() => {
    if (loading || !user) return;
    const target = readLastRoute() ?? "/rooms";
    void navigate({ to: target, replace: true });
  }, [loading, user, navigate]);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="animate-drift absolute -top-40 -left-32 size-[34rem] rounded-full bg-primary/15 blur-3xl" />
        <div className="animate-drift absolute -top-20 right-[-10rem] size-[30rem] rounded-full bg-accent-pink/12 blur-3xl [animation-delay:-6s]" />
        <div className="animate-drift absolute top-[45rem] left-1/3 size-[28rem] rounded-full bg-accent-violet/12 blur-3xl [animation-delay:-12s]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-3 sm:px-4">
          <BrandLogo />
          <div className="flex items-center gap-2">
            {loading ? null : user ? (
              <Button asChild size="sm" className="bg-sunset rounded-xl font-semibold">
                <Link to="/rooms">Open app</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="rounded-xl">
                  <Link to="/auth/login">Sign in</Link>
                </Button>
                <Button asChild size="sm" className="bg-sunset rounded-xl font-semibold">
                  <Link to="/auth/signup">Create account</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-4 pt-12 pb-8 text-center sm:pt-24">
          <span className="animate-rise inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold tracking-widest text-primary uppercase">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Invite-only private rooms
          </span>
          <h1 className="animate-rise mx-auto mt-7 max-w-4xl text-[2rem] leading-[1.05] font-extrabold text-balance sm:text-6xl lg:text-7xl [animation-delay:80ms]">
            Sync life with <span className="text-sunset">SyncTogether</span>
          </h1>
          <p className="animate-rise mx-auto mt-6 max-w-2xl text-base sm:text-lg text-muted-foreground sm:text-xl [animation-delay:160ms]">
            The private space for couples, friends, families and students to watch, listen, study
            and talk together in real time. Secure, simple and shared. 💛
          </p>
          <div className="animate-rise mt-9 flex flex-col items-center justify-center gap-4 [animation-delay:240ms] sm:flex-row">
            <Button
              asChild
              size="lg"
              className="bg-sunset h-14 w-full rounded-2xl px-10 text-base font-bold shadow-elevated transition-transform hover:-translate-y-0.5 sm:w-auto"
            >
              <Link to={user ? "/rooms/new" : "/auth/signup"}>
                {user ? "Start a room" : "Get started free"}
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-14 w-full rounded-2xl border-2 px-10 text-base font-bold hover:border-accent-violet/40 sm:w-auto"
            >
              <Link to="/privacy">How we handle your data</Link>
            </Button>
          </div>
          <p className="animate-rise mt-6 text-xs text-muted-foreground [animation-delay:320ms]">
            Rooms, invites, synchronized watching, shared music, study rooms and private chat are
            live. No public feeds, no discovery, no recordings.
          </p>
        </section>

        <section aria-labelledby="pillars" className="mx-auto w-full max-w-6xl px-4 pt-8 pb-20">
          <h2 id="pillars" className="sr-only">
            What you can do together
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:auto-rows-[13rem] md:grid-cols-3">
            <article className="tile tile-lift bg-sunset animate-rise relative col-span-1 flex flex-col justify-end overflow-hidden p-6 text-primary-foreground sm:p-8 shadow-elevated md:col-span-2 md:row-span-2 md:p-10">
              <span
                aria-hidden="true"
                className="animate-float absolute -top-10 -right-10 size-52 rounded-full bg-background/25 blur-2xl"
              />
              <span
                aria-hidden="true"
                className="animate-float absolute top-8 right-8 hidden size-32 items-center justify-center rounded-3xl border border-background/30 bg-background/20 backdrop-blur-md sm:flex [animation-delay:-3s]"
              >
                <MonitorPlay className="size-12" aria-hidden="true" />
              </span>
              <p className="relative text-3xl">🍿</p>
              <h3 className="relative mt-3 text-2xl font-extrabold sm:text-4xl">Watch together</h3>
              <p className="relative mt-3 max-w-md text-base text-primary-foreground/90 sm:text-lg">
                Synchronized playback in officially embedded players, so movie nights land frame for
                frame — never pirated streams.
              </p>
            </article>

            {SMALL_TILES.map(({ icon: Icon, emoji, title, body, tone }, index) => (
              <article
                key={title}
                className={`tile tile-lift animate-rise flex flex-col justify-between ${TONES[tone]} ${
                  index === SMALL_TILES.length - 1
                    ? "md:col-span-3 md:flex-row md:items-center md:justify-start md:gap-6"
                    : ""
                }`}
                style={{ animationDelay: `${120 + index * 70}ms` }}
              >
                <span
                  className={`flex size-12 items-center justify-center rounded-xl ${ICON_TONES[tone]}`}
                >
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-lg font-bold">
                    <span aria-hidden="true" className="mr-1.5">
                      {emoji}
                    </span>
                    {title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                </div>
              </article>
            ))}
          </div>

          <p className="mx-auto mt-14 flex max-w-2xl items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Heart className="size-4 shrink-0 text-accent-pink" aria-hidden="true" />
            SyncTogether is a private platform for people you already know. We host no content, we
            never sell your data, and moderation and reporting are always one tap away.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
