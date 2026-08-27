import { AlertTriangle, Check, CircleSlash, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  blockingReason,
  canStartSharing,
  type PreflightCheck,
  type CheckState,
} from "@/lib/local-media/permissions";

interface LocalMediaPreflightProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checks: PreflightCheck[];
  consented: boolean;
  onConsentChange: (value: boolean) => void;
  fileNames: string[];
  onConfirm: () => void;
  starting: boolean;
}

const STATE_ICON: Record<CheckState, typeof Check> = {
  granted: Check,
  blocked: CircleSlash,
  pending: AlertTriangle,
  "not-required": CircleSlash,
};

const STATE_CLASS: Record<CheckState, string> = {
  granted: "text-emerald-600 dark:text-emerald-400",
  blocked: "text-destructive",
  pending: "text-amber-600 dark:text-amber-400",
  "not-required": "text-muted-foreground",
};

/**
 * Pre-flight confirmation shown before any bytes leave the device: the user
 * sees exactly what will be shared, which device permissions were granted, and
 * must tick the sharing confirmation before the session can start.
 */
export function LocalMediaPreflight({
  open,
  onOpenChange,
  checks,
  consented,
  onConsentChange,
  fileNames,
  onConfirm,
  starting,
}: LocalMediaPreflightProps) {
  const ready = canStartSharing(checks);
  const reason = blockingReason(checks);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ready to share from this device?</DialogTitle>
          <DialogDescription>
            Nothing is uploaded or stored. Media streams directly to people in this room and stops
            the moment you end sharing.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm">
          {fileNames.slice(0, 4).map((name) => (
            <li key={name} className="truncate rounded-md bg-muted/50 px-3 py-2">
              {name}
            </li>
          ))}
          {fileNames.length > 4 ? (
            <li className="px-3 text-xs text-muted-foreground">
              +{fileNames.length - 4} more item{fileNames.length - 4 === 1 ? "" : "s"}
            </li>
          ) : null}
        </ul>

        <ul className="space-y-3">
          {checks
            .filter((check) => check.id !== "consent")
            .map((check) => {
              const Icon = STATE_ICON[check.state];
              return (
                <li key={check.id} className="flex items-start gap-3 text-sm">
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${STATE_CLASS[check.state]}`}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium">{check.label}</span>
                    <span className="block text-xs text-muted-foreground">{check.detail}</span>
                  </span>
                </li>
              );
            })}
        </ul>

        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Checkbox
            checked={consented}
            onCheckedChange={(value) => onConsentChange(value === true)}
            aria-label="Confirm you have the right to share this media"
          />
          <span>
            I have the right to share this media, and I understand everyone in the room will be able
            to see or hear it.
          </span>
        </label>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!ready || starting}>
            {starting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Start sharing
          </Button>
        </DialogFooter>
        {!ready && reason ? (
          <p role="status" className="text-xs text-muted-foreground">
            {reason}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
