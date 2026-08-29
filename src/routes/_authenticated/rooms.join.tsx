import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAds } from "@/hooks/useAds";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { joinRoomByCode } from "@/lib/rooms.functions";
import { rpcMessage } from "@/lib/rpc-types";
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
  const queryClient = useQueryClient();
  const join = useServerFn(joinRoomByCode);
  const { requestFullscreen } = useAds();
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
      const result = await join({ data: { join_code: parsed.data.join_code } });
      if (!result.ok) {
        setError(rpcMessage(result.reason));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.mine() });
      if (!result.already_member) void track("room_joined");
      toast.success(result.already_member ? "Opening room." : "You joined the room.");
      navigate({ to: "/rooms/$roomId", params: { roomId: result.room_id } });
      // Transition ad: shown after the room screen is already open.
      if (!result.already_member) void requestFullscreen("room_joined_transition");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Join a room</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter the code the host shared with you.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Repeated failed attempts are rate limited.
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
