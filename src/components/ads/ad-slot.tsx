import { useEffect, useState } from "react";

import { useAds } from "@/hooks/useAds";
import { sanitizeAdEvent } from "@/lib/ads/analytics-safety";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * PHASE 9 — the only way a screen can show an ad.
 *
 * Design rules enforced here rather than left to each caller:
 *  - the slot renders NOTHING (no reserved box, no placeholder) when the
 *    placement is ineligible, so layout never shifts around a missing ad and
 *    no space is stolen from content;
 *  - the container is labelled "Advertisement" so it is never mistakable for
 *    app content or a system dialog;
 *  - it never overlays controls: it is a static block in normal flow.
 */
export function AdSlot({ placement, className }: { placement: string; className?: string }) {
  const { evaluate, requestBanner, hideBanner } = useAds();
  const outcome = evaluate("banner", placement);
  const [rendered, setRendered] = useState(false);

  // The slot is the only place that asks the native SDK for a banner: the
  // request happens when (and only when) the placement is eligible, and the
  // banner is torn down as soon as the screen unmounts.
  useEffect(() => {
    if (!outcome.eligible) return;
    void requestBanner(placement);
    return () => hideBanner();
  }, [outcome.eligible, placement, requestBanner, hideBanner]);

  useEffect(() => {
    if (!outcome.eligible || rendered) return;
    setRendered(true);
    void track("ad_shown", sanitizeAdEvent({ format: "banner", placement, eligible: true }));
  }, [outcome.eligible, placement, rendered]);

  if (!outcome.eligible || !outcome.unitId) return null;

  return (
    <aside
      aria-label="Advertisement"
      data-ad-placement={placement}
      className={cn(
        "surface-panel flex min-h-[64px] items-center justify-center rounded-lg border border-dashed border-border p-3",
        className,
      )}
    >
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Advertisement
      </span>
    </aside>
  );
}
