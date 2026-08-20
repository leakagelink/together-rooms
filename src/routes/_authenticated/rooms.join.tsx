import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
import { joinRoomSchema } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/rooms/join")({
  head: () => ({
    meta: [
      { title: "Join a room — SyncTogether" },
      { name: "description", content: "Enter a join code to enter a private SyncTogether room." },
      { property: "og:title", content: "Join a room — SyncTogether" },
      { property: "og:description", content: "Enter a join code to enter a private room." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: JoinRoomPage,
});

function JoinRoomPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = joinRoomSchema.safeParse({ join_code: code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the code.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("forbidden");

      // Phase 1 limitation: RLS only exposes rooms you already belong to, so a
      // code alone cannot add you to someone else's room from the client. A
      // server-side redeem path lands in Phase 2.
      const { data: room, error: lookupError } = await supabase
        .from("rooms")
        .select("id, status")
        .eq("join_code", parsed.data.join_code)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!room) {
        setError(
          "That code isn't available to you yet. Ask the host to add you — code redemption for new members ships in the next release.",
        );
        return;
      }
      if (room.status === "ended" || room.status === "archived") {
        setError("That room has ended.");
        return;
      }
      void track("room_joined");
      toast.success("Opening room.");
      navigate({ to: "/rooms/$roomId", params: { roomId: room.id } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Join a room</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter the code the host shared with you.
      </p>
      <form onSubmit={onSubmit} className="surface-panel mt-8 max-w-md space-y-5 p-6" noValidate>
        <div className="space-y-2">
          <Label htmlFor="code">Join code</Label>
          <Input
            id="code"
            required
            autoCapitalize="characters"
            className="font-mono tracking-widest uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Checking…" : "Join room"}
        </Button>
      </form>
    </AppShell>
  );
}