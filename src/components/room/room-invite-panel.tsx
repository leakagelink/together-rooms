import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Copy, Link2, Ban } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { track } from "@/lib/analytics";
import { createRoomInvite, listRoomInvites, revokeRoomInvite } from "@/lib/invites.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";

export function RoomInvitePanel({ roomId }: { roomId: string }) {
  const queryClient = useQueryClient();
  const create = useServerFn(createRoomInvite);
  const revoke = useServerFn(revokeRoomInvite);
  const list = useServerFn(listRoomInvites);
  const [maxUses, setMaxUses] = useState(1);
  const [hours, setHours] = useState(24);
  const [freshLink, setFreshLink] = useState<string | null>(null);

  const invitesQuery = useQuery({
    queryKey: queryKeys.rooms.invites(roomId),
    queryFn: async () => {
      const result = await list({ data: { room_id: roomId } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      return result.invites;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await create({
        data: { room_id: roomId, max_uses: maxUses, expires_in_hours: hours },
      });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      return result;
    },
    onSuccess: async (result) => {
      // The plaintext token is shown exactly once; only its hash is stored.
      setFreshLink(`${window.location.origin}/invite/${result.token}`);
      void track("invite_created");
      toast.success("Invite link created. Copy it now — it won't be shown again.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.invites(roomId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const result = await revoke({ data: { invite_id: inviteId } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
    },
    onSuccess: async () => {
      toast.success("Invite revoked.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.invites(roomId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="surface-panel mt-6 p-5" aria-labelledby="invites-heading">
      <h2 id="invites-heading" className="text-sm font-semibold">
        Invite links
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Links are single-shown, expiring and revocable. Only a hash is stored.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="invite-uses">Max uses</Label>
          <Input
            id="invite-uses"
            type="number"
            min={1}
            max={100}
            className="w-24"
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invite-hours">Expires in (hours)</Label>
          <Input
            id="invite-hours"
            type="number"
            min={1}
            max={720}
            className="w-28"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          <Link2 className="size-4" aria-hidden="true" />
          {createMutation.isPending ? "Creating…" : "Create invite"}
        </Button>
      </div>

      {freshLink ? (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium">Copy this link now — it is shown only once.</p>
          <p className="mt-1 font-mono text-xs break-all">{freshLink}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={async () => {
              await navigator.clipboard.writeText(freshLink);
              toast.success("Invite link copied.");
            }}
          >
            <Copy className="size-4" aria-hidden="true" /> Copy link
          </Button>
        </div>
      ) : null}

      <ul className="mt-4 space-y-2">
        {(invitesQuery.data ?? []).map((invite) => {
          const expired = new Date(invite.expires_at) <= new Date();
          const state = invite.revoked_at
            ? "revoked"
            : expired
              ? "expired"
              : invite.use_count >= invite.max_uses
                ? "used up"
                : "active";
          return (
            <li
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-xs"
            >
              <span className="text-muted-foreground">
                {state} · {invite.use_count}/{invite.max_uses} uses · expires{" "}
                {new Date(invite.expires_at).toLocaleString()}
              </span>
              {state === "active" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(invite.id)}
                >
                  <Ban className="size-4" aria-hidden="true" /> Revoke
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
