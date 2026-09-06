import { useEffect, useState } from "react";

import { useAds } from "@/hooks/useAds";
import { sanitizeAdEvent } from "@/lib/ads/analytics-safety";
import { adDebug } from "@/lib/ads/debug";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * PHASE 9 / 14.2 — the only way a screen can show an ad.
 *
 * Design rules enforced here rather than left to each caller:
 *  - the slot renders NOTHING until the native SDK has actually loaded a
 *    banner, so there is never a placeholder box pretending to be an ad and
 *    never reserved empty space;
 *  - once a real banner is anchored by the native layer (at the bottom of the
 *    activity) the slot renders an inert spacer of the same height so the
 *    banner cannot cover app content or controls;
 *  - the banner is requested exactly once per eligible mount, and again only
 *    if the ad SDK finishes initializing after this screen was opened
 *    (consent + SDK init are asynchronous, so the first attempt can legitimately
 *    happen before any SDK exists);
 *  - the banner is torn down when the screen unmounts.
 */
export function AdSlot({ placement, className }: { placement: string; className?: string }) {
  const { evaluate, requestBanner, hideBanner, adsReady } = useAds();
  const outcome = evaluate("banner", placement);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!outcome.eligible || !adsReady) return;
    let cancelled = false;
    adDebug("banner_request", { placement });
    void requestBanner(placement).then((ok) => {
      if (cancelled) return;
      adDebug(ok ? "banner_requested" : "banner_not_requested", { placement });
      setShown(ok);
      if (ok) void track("ad_shown", sanitizeAdEvent({ format: "banner", placement, eligible: true }));
    });
    return () => {
      cancelled = true;
      setShown(false);
      hideBanner();
    };
  }, [outcome.eligible, adsReady, placement, requestBanner, hideBanner]);

  if (!shown) return null;

  // Inert spacer only: the ad itself is a native view anchored by the SDK.
  return (
    <div
      aria-hidden="true"
      data-ad-placement={placement}
      className={cn("h-[60px] w-full", className)}
    />
  );
}
