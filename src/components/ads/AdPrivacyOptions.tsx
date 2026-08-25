import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAds } from "@/hooks/useAds";

/**
 * PHASE 11 — the always-reachable ad privacy options entry point.
 *
 * Google requires that, where a consent message was shown, the user can reopen
 * it at any time from within the app. It renders only when the platform tells
 * us the entry point is required, so users who were never shown a message do
 * not see a control that does nothing.
 */
export function AdPrivacyOptions() {
  const { privacyOptionsAvailable, showPrivacyOptions, consent } = useAds();
  const [busy, setBusy] = useState(false);

  if (!privacyOptionsAvailable) return null;

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div>
        <p className="text-sm font-medium">Ad privacy choices</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {consent === "granted_personalized"
            ? "You currently allow personalized ads."
            : "You currently see non-personalized ads or none at all."}{" "}
          Change your choices at any time.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void showPrivacyOptions().finally(() => setBusy(false));
        }}
      >
        Manage
      </Button>
    </div>
  );
}
