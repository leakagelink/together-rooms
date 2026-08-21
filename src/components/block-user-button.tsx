import { useState } from "react";
import { Ban } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";

export function BlockUserButton({ userId, label }: { userId: string; label?: string }) {
  const [busy, setBusy] = useState(false);

  async function block() {
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("forbidden");
      const { error } = await supabase
        .from("user_blocks")
        .insert({ blocker_id: auth.user.id, blocked_id: userId });
      if (error && error.code !== "23505") throw error;
      void track("user_blocked");
      toast.success("Blocked. They can't reach you outside rooms you already share.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          <Ban className="size-4" aria-hidden="true" /> Block{label ? ` ${label}` : ""}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Block this person?</AlertDialogTitle>
          <AlertDialogDescription>
            They won't be able to invite you, join a room with you, or reach you privately, and you
            won't be matched into new rooms together. Blocking does not remove either of you from a
            room you are already both in — leave that room if you want the conversation to stop. You
            can undo this in privacy settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={block}>Block</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
