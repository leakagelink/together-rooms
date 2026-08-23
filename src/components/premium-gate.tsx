import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useEntitlement } from "@/hooks/useEntitlement";

/**
 * PHASE 9 — upgrade messaging.
 *
 * Free is a complete product, so a gate never blocks a core action and never
 * uses pressure, countdowns or dark patterns. It explains what Premium adds
 * and links to the subscription screen; dismissal is always possible because
 * the surrounding feature keeps working.
 */
export function PremiumBadge() {
  const { premium } = useEntitlement();
  if (!premium) return null;
  return (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      Premium
    </span>
  );
}

export function PremiumNotice({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  const { premium } = useEntitlement();
  if (premium) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4">
      <p className="text-sm font-medium">{title}</p>
      {children ? <p className="mt-1 text-xs text-muted-foreground">{children}</p> : null}
      <Button asChild variant="outline" size="sm" className="mt-3">
        <Link to="/settings/subscription">See what Premium adds</Link>
      </Button>
    </div>
  );
}
