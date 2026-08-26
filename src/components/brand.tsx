import { Link } from "@tanstack/react-router";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`bg-sunset inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-brand-foreground shadow-soft ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="9" cy="12" r="5" />
        <circle cx="15" cy="12" r="5" />
      </svg>
    </span>
  );
}

export function BrandLogo({ withTagline = false }: { withTagline?: boolean }) {
  return (
    <Link
      to="/"
      className="group inline-flex items-center gap-2.5"
      aria-label="SyncTogether home"
    >
      <BrandMark className="transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-lg font-extrabold tracking-tight">SyncTogether</span>
        {withTagline ? (
          <span className="mt-1 text-[11px] text-muted-foreground">
            Watch. Listen. Study. Connect. Together.
          </span>
        ) : null}
      </span>
    </Link>
  );
}
