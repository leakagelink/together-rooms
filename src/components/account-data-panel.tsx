import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { deleteAccount, exportUserData } from "@/lib/account.functions";
import { rpcMessage } from "@/lib/rpc-types";

/**
 * Self-service data export and account deletion (store-policy requirement).
 * Deletion asks for an explicit typed confirmation and states plainly what
 * happens to hosted rooms before anything is destroyed.
 */
export function AccountDataPanel() {
  const { signOut } = useAuth();
  const runExport = useServerFn(exportUserData);
  const runDelete = useServerFn(deleteAccount);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const exportMutation = useMutation({
    mutationFn: async () => {
      const result = await runExport();
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      return result.export;
    },
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `synctogether-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Your data export has downloaded.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const result = await runDelete({ data: { confirmation } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      return result.status;
    },
    onSuccess: async (status) => {
      if (status === "completed") {
        toast.success("Your account and data have been deleted.");
      } else {
        toast.warning(
          "Your deletion request was recorded but could not be completed automatically. Support will finish it.",
        );
      }
      await signOut();
      window.location.assign("/");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="surface-panel space-y-4 p-6" aria-labelledby="your-data-heading">
      <h2 id="your-data-heading" className="text-sm font-semibold">
        Your data
      </h2>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Download a machine-readable copy of your profile, settings, rooms, memberships and
          reports.
        </p>
        <Button
          variant="outline"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
        >
          <Download className="size-4" aria-hidden="true" />
          {exportMutation.isPending ? "Preparing…" : "Export my data"}
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border border-destructive/40 p-4">
        <div>
          <h3 className="text-sm font-semibold text-destructive">Delete my account</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            This permanently removes your profile, settings, memberships, reports you filed and
            rooms you own. Rooms you host are handed to another member where possible, and ended
            otherwise. This cannot be undone.
          </p>
        </div>

        {confirmOpen ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
              <Input
                id="delete-confirm"
                value={confirmation}
                autoComplete="off"
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={confirmation !== "DELETE" || deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {deleteMutation.isPending ? "Deleting…" : "Permanently delete"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmation("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="size-4" aria-hidden="true" /> Delete my account
          </Button>
        )}
      </div>
    </section>
  );
}
