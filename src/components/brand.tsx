import { Link } from "@tanstack/react-router";

import brandMark from "@/assets/brand-mark.png";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-card shadow-soft ring-1 ring-border/60 ${className}`}
    >
      <img
        src={brandMark}
        alt=""
        width={36}
        height={36}
        className="size-7 object-contain"
        decoding="async"
      />
    </span>
  );
}

export function BrandLogo({ withTagline = false }: { withTagline?: boolean }) {
  return (
    <Link to="/" className="group inline-flex items-center gap-2.5" aria-label="SyncTogether home">
      <BrandMark className="transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-xl font-normal tracking-tight">SyncTogether</span>
        {withTagline ? (
          <span className="mt-1 text-[11px] text-muted-foreground">
            Watch. Listen. Study. Connect. Together.
          </span>
        ) : null}
      </span>
    </Link>
  );
}
