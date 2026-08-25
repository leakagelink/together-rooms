import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/analytics";
import { redeemRoomInvite } from "@/lib/invites.functions";
import { queryKeys } from "@/lib/query-keys";
import { rememberPendingDestination } from "@/lib/android/deep-link";
import { isValidInviteToken } from "@/lib/room-rules";
import { rpcMessage } from "@/lib/rpc-types";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "Room invite — SyncTogether" },
      { name: "description", content: "Accept a private SyncTogether room invite." },
      { property: "og:title", content: "Room invite — SyncTogether" },
      { property: "og:description", content: "Accept a private SyncTogether room invite." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InvitePage,
});

/**
 * Public route: the invite token lives in the URL, but redemption always runs
 * server-side against the token hash, so the page reveals nothing about the
 * room until the caller is signed in and the invite is valid.
 */
function InvitePage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const redeem = useServerFn(redeemRoomInvite);
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user || status !== "idle") return;
    if (!isValidInviteToken(token)) {
      setStatus("failed");
      setMessage("That invite link isn't valid.");
      return;
    }
    setStatus("working");
    void (async () => {
      try {
        const result = await redeem({ data: { token } });
        if (!result.ok) {
          setStatus("failed");
          setMessage(rpcMessage(result.reason));
          return;
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.mine() });
        if (!result.already_member) void track("invite_accepted");
        toast.success("Invite accepted.");
        navigate({ to: "/rooms/$roomId", params: { roomId: result.room_id } });
      } catch {
        setStatus("failed");
        setMessage("That invite link isn't valid.");
      }
    })();
  }, [loading, user, status, token, redeem, navigate, queryClient]);

  if (loading) {
    return (
      <AppShell>
        <LoadingState label="Checking your invite" />
      </AppShell>
    );
  }

  if (!user) {
    // Preserve the (validated, same-origin) invite destination across sign-in.
    // Redemption still happens server-side against the token hash.
    rememberPendingDestination(`/invite/${token}`);
    return (
      <AppShell>
        <EmptyState
          title="Sign in to accept this invite"
          description="Invites can only be accepted by a signed-in account."
          action={<Button onClick={() => navigate({ to: "/auth/login" })}>Sign in</Button>}
        />
      </AppShell>
    );
  }

  if (status === "failed") {
    return (
      <AppShell>
        <EmptyState
          title="Invite unavailable"
          description={message ?? "That invite link isn't valid."}
          action={<Button onClick={() => navigate({ to: "/rooms" })}>Go to your rooms</Button>}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <LoadingState label="Accepting your invite" />
    </AppShell>
  );
}
