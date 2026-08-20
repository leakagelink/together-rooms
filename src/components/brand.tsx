import { Link } from "@tanstack/react-router";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground ${className}`}
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
    <Link to="/" className="inline-flex items-center gap-2.5" aria-label="SyncTogether home">
      <BrandMark />
      <span className="flex flex-col leading-none">
        <span className="font-display text-lg font-semibold tracking-tight">SyncTogether</span>
        {withTagline ? (
          <span className="mt-1 text-[11px] text-muted-foreground">
            Watch. Listen. Study. Connect. Together.
          </span>
        ) : null}
      </span>
    </Link>
  );
}