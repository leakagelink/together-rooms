import { useEffect, useState } from "react";

import brandMark from "@/assets/brand-mark.png";

/**
 * Animated brand splash shown while the app boots.
 *
 * Purely presentational: it fades itself out shortly after mount so the native
 * Android splash (which is dismissed on first paint) hands over to a branded
 * animation instead of a blank screen.
 */
export function SplashOverlay({ duration = 550 }: { duration?: number }) {
  const [phase, setPhase] = useState<"visible" | "leaving" | "gone">("visible");

  useEffect(() => {
    const leave = window.setTimeout(() => setPhase("leaving"), duration);
    const done = window.setTimeout(() => setPhase("gone"), duration + 300);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(done);
    };
  }, [duration]);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-background transition-all duration-300 ${
        phase === "leaving" ? "pointer-events-none scale-105 opacity-0" : "opacity-100"
      }`}
    >
      <div className="pointer-events-none absolute inset-0">
        <span className="animate-drift absolute -top-32 -left-24 size-[26rem] rounded-full bg-primary/25 blur-3xl" />
        <span className="animate-drift absolute -right-24 bottom-[-8rem] size-[24rem] rounded-full bg-accent-blue/20 blur-3xl [animation-delay:-6s]" />
        <span className="animate-drift absolute top-1/3 left-1/2 size-[20rem] -translate-x-1/2 rounded-full bg-accent-violet/20 blur-3xl [animation-delay:-11s]" />
      </div>

      <div className="relative flex flex-col items-center">
        <span className="relative flex size-28 items-center justify-center">
          <span className="animate-splash-ring absolute inset-0 rounded-[2rem] border border-primary/40" />
          <span className="animate-splash-ring absolute inset-0 rounded-[2rem] border border-accent-violet/30 [animation-delay:.6s]" />
          <span className="animate-splash-pop flex size-24 overflow-hidden rounded-[1.75rem] shadow-elevated">
            <img src={brandMark} alt="" width={96} height={96} className="size-full object-cover" />
          </span>
        </span>

        <h1 className="animate-rise mt-7 font-display text-2xl font-extrabold tracking-tight [animation-delay:180ms]">
          SyncTogether
        </h1>
        <p className="animate-rise mt-2 text-xs tracking-[0.22em] text-muted-foreground uppercase [animation-delay:300ms]">
          Watch · Listen · Chat · Together
        </p>

        <span className="mt-8 block h-1 w-40 overflow-hidden rounded-full bg-border/70">
          <span className="animate-splash-sweep bg-sunset block h-full w-1/2 rounded-full" />
        </span>
      </div>
    </div>
  );
}
