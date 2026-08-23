import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";
import { Copy, LogOut, PowerOff, Radio } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ReportDialog } from "@/components/report-dialog";
import { RoomInvitePanel } from "@/components/room/room-invite-panel";
import { RoomMembersPanel } from "@/components/room/room-members-panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/state-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { roomJoinability } from "@/lib/room-rules";
import { endRoom, leaveRoom, listRoomMembers, transferRoomHost } from "@/lib/rooms.functions";
import { rpcMessage } from "@/lib/rpc-types";
import { RoomChat } from "@/components/room/room-chat";
import { WatchTogether } from "@/components/room/watch-together";
import { MusicRoom } from "@/components/room/music-room";
import { StudyRoom } from "@/components/room/study-room";

import { setMemberMute } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/rooms/$roomId")({
  head: () => ({
    meta: [
      { title: "Room — SyncTogether" },
      { name: "description", content: "A private SyncTogether room." },
      { property: "og:title", content: "Room — SyncTogether" },
      { property: "og:description", content: "A private SyncTogether room." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
      <EmptyState
        title="Room not found"
        description="It may have ended or you no longer have access."
      />
    </AppShell>
  ),
});

function RoomPage() {
  const { roomId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const fetchMembers = useServerFn(listRoomMembers);
  const leave = useServerFn(leaveRoom);
  const end = useServerFn(endRoom);
  const transfer = useServerFn(transferRoomHost);
  const mute = useServerFn(setMemberMute);

  const roomQuery = useQuery({
    queryKey: queryKeys.rooms.detail(roomId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select(
          "id, name, description, type, status, privacy, is_ephemeral, join_code, owner_id, host_id, max_members, expires_at",
        )
        .eq("id", roomId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const membersQuery = useQuery({
    queryKey: queryKeys.rooms.members(roomId),
    queryFn: async () => {
      const result = await fetchMembers({ data: { room_id: roomId } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      return result.members;
    },
  });

  // Mute state lives on room_members; members can read their room's rows via RLS.
  const muteQuery = useQuery({
    queryKey: [...queryKeys.rooms.members(roomId), "mutes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_members")
        .select("user_id, role, is_muted, status, can_control_playback")
        .eq("room_id", roomId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const onRoomChanged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detail(roomId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.members(roomId) });
  }, [queryClient, roomId]);

  const { connected, presence, authorized } = useRoomRealtime(roomId, user?.id, onRoomChanged);

  const mutedIds = new Set((muteQuery.data ?? []).filter((m) => m.is_muted).map((m) => m.user_id));
  const myMembership = (muteQuery.data ?? []).find((m) => m.user_id === user?.id);

  const muteMutation = useMutation({
    mutationFn: async ({ userId, muted }: { userId: string; muted: boolean }) => {
      const result = await mute({ data: { room_id: roomId, user_id: userId, muted } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.members(roomId) });
      toast.success("Mute updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      const result = await leave({ data: { room_id: roomId } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      return result;
    },
    onSuccess: async (result) => {
      void track("room_left");
      queryClient.removeQueries({ queryKey: queryKeys.rooms.detail(roomId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.mine() });
      toast.success(
        result.outcome === "host_transferred"
          ? "You left. Hosting was handed to another member."
          : result.outcome === "room_ended"
            ? "You left. The room ended because nobody else was in it."
            : "You left the room.",
      );
      navigate({ to: "/rooms" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const endMutation = useMutation({
    mutationFn: async () => {
      const result = await end({ data: { room_id: roomId } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detail(roomId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.mine() });
      toast.success("Room ended.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const transferMutation = useMutation({
    mutationFn: async (toUserId: string) => {
      const result = await transfer({ data: { room_id: roomId, to_user_id: toUserId } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detail(roomId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.members(roomId) });
      toast.success("Host transferred.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

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
        <ErrorState
          message={errorMessage(roomQuery.error)}
          onRetry={() => void roomQuery.refetch()}
        />
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

  const isHost = room.owner_id === user?.id || room.host_id === user?.id;
  const lifecycle = roomJoinability(room);

  // Client-side gating is UX only; every rule below is re-enforced in SQL.
  const canModerate =
    isHost || myMembership?.role === "co_host" || myMembership?.role === "moderator";
  const isMuted = myMembership?.is_muted === true;
  const canChat = lifecycle === "ok" && !isMuted && myMembership?.status === "joined";
  const chatDisabledReason = isMuted
    ? "You're muted in this room. A host or moderator can unmute you."
    : lifecycle !== "ok"
      ? "This room is closed, so chat is read-only."
      : myMembership
        ? null
        : "Join this room to post messages.";

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{room.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{room.type}</Badge>
            <span>{room.privacy}</span>
            {room.is_ephemeral ? <span>· ephemeral</span> : null}
            <span className="inline-flex items-center gap-1">
              <Radio
                className={connected ? "size-3 text-primary" : "size-3 text-muted-foreground"}
                aria-hidden="true"
              />
              {!authorized ? "Live updates unavailable" : connected ? "Live" : "Reconnecting"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportDialog targetType="room" targetRoomId={room.id} />
          {isHost && lifecycle === "ok" ? (
            <Button
              variant="outline"
              onClick={() => endMutation.mutate()}
              disabled={endMutation.isPending}
            >
              <PowerOff className="size-4" aria-hidden="true" /> End room
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => leaveMutation.mutate()}
            disabled={leaveMutation.isPending}
          >
            <LogOut className="size-4" aria-hidden="true" /> Leave
          </Button>
        </div>
      </div>

      {lifecycle !== "ok" ? (
        <p role="status" className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
          {lifecycle === "room_ended"
            ? "This room has ended. Nobody new can join it."
            : lifecycle === "room_expired"
              ? "This room has expired. Nobody new can join it."
              : "This room isn't open yet."}
        </p>
      ) : null}

      {room.description ? (
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">{room.description}</p>
      ) : null}

      {isHost && room.join_code ? (
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
              toast.success("Join code copied.");
            }}
          >
            <Copy className="size-4" aria-hidden="true" /> Copy
          </Button>
        </section>
      ) : null}

      {isHost ? <RoomInvitePanel roomId={room.id} /> : null}

      <section className="mt-8" aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Presence is advisory. Membership in the database is authoritative.
        </p>
        <div className="mt-3">
          {membersQuery.isPending ? (
            <LoadingState label="Loading members" rows={2} />
          ) : membersQuery.isError ? (
            <ErrorState
              message={errorMessage(membersQuery.error)}
              onRetry={() => void membersQuery.refetch()}
            />
          ) : (
            <RoomMembersPanel
              members={membersQuery.data}
              presence={presence}
              currentUserId={user?.id}
              roomId={room.id}
              canTransferHost={isHost}
              onTransferHost={(userId) => transferMutation.mutate(userId)}
              transferPending={transferMutation.isPending}
              mutedIds={mutedIds}
              canModerate={canModerate}
              onToggleMute={(userId, muted) => muteMutation.mutate({ userId, muted })}
              mutePending={muteMutation.isPending}
            />
          )}
        </div>
      </section>

      {room.type === "study" || room.type === "research" ? (
        <StudyRoom
          roomId={room.id}
          userId={user?.id}
          canControl={isHost || myMembership?.can_control_playback === true}
          roomActive={lifecycle === "ok"}
        />
      ) : room.type === "music" ? (
        <MusicRoom
          roomId={room.id}
          userId={user?.id}
          canManage={isHost || myMembership?.can_control_playback === true}
          roomActive={lifecycle === "ok"}
        />
      ) : (
        <WatchTogether
          roomId={room.id}
          userId={user?.id}
          canControl={isHost || myMembership?.can_control_playback === true}
          roomActive={lifecycle === "ok"}
        />
      )}

      <RoomChat
        roomId={room.id}
        userId={user?.id}
        members={membersQuery.data ?? []}
        canModerate={canModerate}
        canInteract={canChat}
        disabledReason={chatDisabledReason}
      />

      <section className="surface-panel mt-8 p-5">
        <h2 className="text-sm font-semibold">Coming in a later phase</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Shared listening, voice and video and the AI room assistant are not implemented yet.
          YouTube watch-together, the room engine, roles, permissions, realtime event log and chat
          foundation are in place.
        </p>
      </section>
    </AppShell>
  );
}
