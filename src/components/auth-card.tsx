import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { BackButton } from "@/components/back-button";
import brandMark from "@/assets/brand-mark.png";

/** Liquid Sync welcome/auth layout: large brand, tagline, glass form card. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div aria-hidden="true" className="bg-liquid-hero pointer-events-none absolute inset-0 -z-10" />
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center gap-2 px-4 pt-[env(safe-area-inset-top)]">
        <BackButton homePaths={["/"]} />
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pt-2 pb-16">
        <Link to="/" aria-label="SyncTogether home" className="animate-rise flex flex-col items-center text-center">
          <span className="bg-liquid flex size-20 items-center justify-center rounded-full ring-1 ring-glass-border">
            <img src={brandMark} alt="" width={80} height={80} className="size-12 object-contain" />
          </span>
          <span className="mt-4 font-display text-[2rem] leading-none font-extrabold tracking-tight">
            SyncTogether
          </span>
          <span className="mt-2 text-sm text-muted-foreground">Watch · Listen · Chat · Together</span>
        </Link>
        <div className="animate-rise glass-strong mt-8 w-full max-w-md rounded-3xl p-6 [animation-delay:120ms] sm:p-7">
          <h1 className="text-2xl">{title}</h1>
          {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-8 text-center text-xs text-muted-foreground">
        By continuing you agree to our{" "}
        <Link to="/terms" className="underline hover:text-foreground">
          Terms
        </Link>{" "}
        and{" "}
        <Link to="/privacy" className="underline hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </footer>
    </div>
  );
}
