import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, LogOut } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { BlockUserButton } from "@/components/block-user-button";
import { ReportDialog } from "@/components/report-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/state-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/rooms/$roomId")({
  head: () => ({
    meta: [
      { title: "Room — SyncTogether" },
      { name: "description", content: "A private SyncTogether room." },
      { property: "og:title", content: "Room — SyncTogether" },
      { property: "og:description", content: "A private SyncTogether room." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
  errorComponent: () => (
    <AppShell>
      <ErrorState message="This room couldn't be opened." />
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <EmptyState title="Room not found" description="It may have ended or you no longer have access." />
    </AppShell>
  ),
});

function RoomPage() {
  const { roomId } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState(false);

  const roomQuery = useQuery({
    queryKey: ["room", roomId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, name, description, type, status, privacy, is_ephemeral, join_code, owner_id, expires_at")
        .eq("id", roomId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const membersQuery = useQuery({
    queryKey: ["room", roomId, "members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_members")
        .select("id, user_id, role, status")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function leaveRoom() {
    if (!user) return;
    setLeaving(true);
    try {
      const { error } = await supabase
        .from("room_members")
        .update({ status: "left", left_at: new Date().toISOString() })
        .eq("room_id", roomId)
        .eq("user_id", user.id);
      if (error) throw error;
      await supabase.from("room_events").insert({
        room_id: roomId,
        actor_id: user.id,
        type: "USER_LEFT",
        payload: {},
      });
      void track("room_left");
      toast.success("You left the room.");
      await queryClient.invalidateQueries({ queryKey: ["rooms", "mine"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLeaving(false);
    }
  }

  if (roomQuery.isPending) {
    return (
      <AppShell>
        <LoadingState label="Loading room" />
      </AppShell>
    );
  }

  if (roomQuery.isError) {
    return (
      <AppShell>
        <ErrorState message={errorMessage(roomQuery.error)} onRetry={() => void roomQuery.refetch()} />
      </AppShell>
    );
  }

  const room = roomQuery.data;
  if (!room) {
    return (
      <AppShell>
        <EmptyState
          title="Room not available"
          description="It may have ended, expired, or you no longer have access."
          action={
            <Button asChild variant="outline">
              <Link to="/rooms">Back to rooms</Link>
            </Button>
          }
        />
      </AppShell>
    );
  }

  const isOwner = room.owner_id === user?.id;

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{room.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{room.type}</Badge>
            <span>{room.privacy}</span>
            {room.is_ephemeral ? <span>· ephemeral</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportDialog targetType="room" targetRoomId={room.id} />
          <Button variant="outline" onClick={leaveRoom} disabled={leaving}>
            <LogOut className="size-4" aria-hidden="true" /> Leave
          </Button>
        </div>
      </div>

      {room.description ? (
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">{room.description}</p>
      ) : null}

      {isOwner && room.join_code ? (
        <section className="surface-panel mt-6 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-sm font-semibold">Join code</h2>
            <p className="mt-1 font-mono text-lg tracking-widest">{room.join_code}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Share it only with people you want in this room.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(room.join_code ?? "");
              void track("invite_created", { room_type: room.type });
              toast.success("Join code copied.");
            }}
          >
            <Copy className="size-4" aria-hidden="true" /> Copy
          </Button>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members
        </h2>
        <div className="mt-3">
          {membersQuery.isPending ? (
            <LoadingState label="Loading members" rows={2} />
          ) : membersQuery.isError ? (
            <ErrorState
              message={errorMessage(membersQuery.error)}
              onRetry={() => void membersQuery.refetch()}
            />
          ) : membersQuery.data.length === 0 ? (
            <EmptyState title="No members yet" description="Share the join code to bring people in." />
          ) : (
            <ul className="space-y-2">
              {membersQuery.data.map((member) => (
                <li
                  key={member.id}
                  className="surface-panel flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {member.user_id === user?.id ? "You" : `Member ${member.user_id.slice(0, 8)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {member.role} · {member.status}
                    </p>
                  </div>
                  {member.user_id !== user?.id ? (
                    <div className="flex gap-2">
                      <ReportDialog
                        targetType="user"
                        targetUserId={member.user_id}
                        targetRoomId={room.id}
                      />
                      <BlockUserButton userId={member.user_id} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="surface-panel mt-8 p-5">
        <h2 className="text-sm font-semibold">Coming in a later phase</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Synchronized playback, shared listening, voice and video, chat and the AI room assistant are
          not implemented yet. The room engine, roles, permissions and event log that these features
          need are in place.
        </p>
      </section>
    </AppShell>
  );
}