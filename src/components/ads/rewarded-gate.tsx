import { Clock, Gift, PlayCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAdAccess, type RewardPurpose } from "@/hooks/useAdAccess";

function formatRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const FAILURE_MESSAGE: Record<string, string> = {
  ad_unavailable: "Ads are not available on this device right now. Try again from the app.",
  not_earned: "No reward — the ad was closed early or none was available. Try again.",
  daily_ad_limit_reached: "You have reached today's limit of 10 ads. It resets tomorrow.",
  failed: "Could not record that reward. Please try again.",
};

/**
 * The single opt-in surface for rewarded ads.
 *
 * The reward is always described BEFORE the ad starts, watching is always the
 * user's choice, and nothing here grants anything: the server records the
 * reward and enforces the 10-ads-per-day cap.
 */
export function RewardedGate({
  purpose,
  onRewarded,
  className,
}: {
  purpose: RewardPurpose;
  onRewarded?: () => void;
  className?: string;
}) {
  const { state, watching, watchRewarded } = useAdAccess();

  const remaining = formatRemaining(state.unlock_expires_at);
  const adsLeft = state.ads_remaining_today;

  async function watch() {
    const result = await watchRewarded(purpose);
    if (result.ok) {
      toast.success(
        purpose === "unlock"
          ? result.state.unlocked
            ? "All features unlocked for 24 hours."
            : `${result.state.unlock_progress} of ${result.state.unlock_required} ads watched.`
          : "You can create one more room now.",
      );
      onRewarded?.();
      return;
    }
    toast.error(FAILURE_MESSAGE[result.reason] ?? FAILURE_MESSAGE["failed"]);
  }

  if (purpose === "unlock" && state.unlocked) {
    return (
      <div className={`surface-panel flex items-center gap-3 p-4 text-sm ${className ?? ""}`}>
        <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
        <div>
          <p className="font-medium">All features unlocked</p>
          <p className="text-muted-foreground text-xs">
            {remaining ? `${remaining} left in this 24-hour window.` : "Active for 24 hours."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`surface-panel space-y-3 p-4 ${className ?? ""}`}>
      <div className="flex items-start gap-3">
        <Gift className="mt-0.5 size-5 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {purpose === "unlock"
              ? "Unlock every feature for 24 hours"
              : "Create one more room today"}
          </p>
          <p className="text-muted-foreground text-xs">
            {purpose === "unlock"
              ? `Watch ${state.unlock_required} short ads (${state.unlock_progress}/${state.unlock_required} done) and everything stays open for 24 hours — unlimited rooms included.`
              : "Watch one short ad to create an extra room. Without it you get 1 room every 24 hours."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={watch} disabled={watching || adsLeft <= 0}>
          <PlayCircle className="size-4" aria-hidden="true" />
          {watching ? "Loading ad…" : "Watch ad"}
        </Button>
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <Clock className="size-3.5" aria-hidden="true" />
          {adsLeft > 0 ? `${adsLeft} of ${state.daily_ad_limit} ads left today` : "Daily ad limit reached"}
        </span>
      </div>
      <p className="text-muted-foreground text-[11px]">
        Ads are optional and never interrupt playback, chat, calls, safety or account flows. Every
        feature stays free.
      </p>
    </div>
  );
}
