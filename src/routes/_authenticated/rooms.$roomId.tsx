import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  LogIn,
  LogOut,
  MessageSquare,
  MonitorPlay,
  PowerOff,
  Radio,
  Share2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ReportDialog } from "@/components/report-dialog";
import { RoomInvitePanel } from "@/components/room/room-invite-panel";
import { RoomMembersPanel } from "@/components/room/room-members-panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/state-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppLifecycle } from "@/hooks/useAppLifecycle";
import { useAuth } from "@/hooks/useAuth";
import { useAds } from "@/hooks/useAds";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { roomJoinability } from "@/lib/room-rules";
import {
  endRoom,
  joinRoomByCode,
  leaveRoom,
  listRoomMembers,
  transferRoomHost,
} from "@/lib/rooms.functions";
import { rpcMessage } from "@/lib/rpc-types";
import { RoomChat } from "@/components/room/room-chat";
import { RoomPresenceRail } from "@/components/room/room-presence-rail";
import { WatchTogether } from "@/components/room/watch-together";
import { MusicRoom } from "@/components/room/music-room";
import { StudyRoom } from "@/components/room/study-room";
import { LocalMediaRoom } from "@/components/room/local-media-room";

import { setMemberMute } from "@/lib/chat.functions";

const ROOM_TABS = ["stage", "chat", "people", "share"] as const;

export const Route = createFileRoute("/_authenticated/rooms/$roomId")({
  validateSearch: (search: Record<string, unknown>): { tab?: RoomTab } => {
    const raw = search["tab"];
    return typeof raw === "string" && (ROOM_TABS as readonly string[]).includes(raw)
      ? { tab: raw as RoomTab }
      : {};
  },
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

type RoomTab = "stage" | "chat" | "people" | "share";

function RoomPage() {
  const { roomId } = Route.useParams();
  const { tab: initialTab } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The stage (watch/listen/study) is always the landing surface of a room.
  const [tab, setTab] = useState<RoomTab>(initialTab ?? "stage");

  // Android/browser lifecycle: on foreground or reconnect every authoritative
  // query is refetched instead of trusting the suspended snapshot.
  useAppLifecycle({ inRoom: true, inCall: false });

  // Deep links (notification taps) can change the requested tab while mounted.
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const fetchMembers = useServerFn(listRoomMembers);
  const leave = useServerFn(leaveRoom);
  const rejoin = useServerFn(joinRoomByCode);
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

  const { requestFullscreen } = useAds();
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
      // PHASE 13.1 — the ONLY approved full-screen transition: the session has
      // fully ended and the user is back on the rooms list. The centralized
      // policy still decides (premium, consent, frequency, warm-up); this is
      // merely the transition point where asking is allowed at all.
      void requestFullscreen("room_session_ended");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Accidentally disconnected, backgrounded or explicitly left: as long as the
  // room is still visible to this user (owner/host or an existing membership
  // row), they can reconnect without hunting for the invite again.
  const rejoinMutation = useMutation({
    mutationFn: async (code: string) => {
      const result = await rejoin({ data: { join_code: code } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detail(roomId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.members(roomId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.mine() });
      toast.success("You're back in the room.");
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
  const isJoined = myMembership?.status === "joined";
  const canChat = lifecycle === "ok" && !isMuted && isJoined;
  const chatDisabledReason = isMuted
    ? "You're muted in this room. A host or moderator can unmute you."
    : lifecycle !== "ok"
      ? "This room is closed, so chat is read-only."
      : isJoined
        ? null
        : "You're not connected to this room right now. Use Rejoin to reconnect.";

  const stageLabel =
    room.type === "study" || room.type === "research"
      ? "Study"
      : room.type === "music"
        ? "Listen"
        : "Watch";

  const tabs: { id: RoomTab; label: string; icon: typeof Radio }[] = [
    { id: "stage", label: stageLabel, icon: MonitorPlay },
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "people", label: "People", icon: Users },
    { id: "share", label: "Share", icon: Share2 },
  ];

  return (
    <AppShell>
      {/* Compact room header: identity + live state + session actions only. */}
      <header className="surface-panel overflow-hidden p-3 sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
              <Users className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black tracking-tight sm:text-2xl">
                {room.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <Badge variant="secondary" className="h-5 px-2 capitalize">
                  {room.type}
                </Badge>
                <span className="capitalize">{room.privacy.replace("_", " ")}</span>
                {room.is_ephemeral ? <span>· ephemeral</span> : null}
                <span>· {membersQuery.data?.length ?? 0} members</span>
                <span
                  className={
                    connected && authorized
                      ? "inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 font-semibold text-primary"
                      : "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-semibold"
                  }
                >
                  <Radio className="size-3" aria-hidden="true" />
                  {!authorized ? "Live off" : connected ? "Live" : "Reconnecting"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <ReportDialog targetType="room" targetRoomId={room.id} />
            {isHost && lifecycle === "ok" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => endMutation.mutate()}
                disabled={endMutation.isPending}
              >
                <PowerOff className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">End room</span>
              </Button>
            ) : null}
            {isJoined ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => leaveMutation.mutate()}
                disabled={leaveMutation.isPending}
              >
                <LogOut className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Leave</span>
              </Button>
            ) : lifecycle === "ok" && room.join_code ? (
              <Button
                size="sm"
                onClick={() => rejoinMutation.mutate(room.join_code as string)}
                disabled={rejoinMutation.isPending}
              >
                <LogIn className="size-4" aria-hidden="true" /> Rejoin
              </Button>
            ) : null}
          </div>
        </div>

        {lifecycle !== "ok" ? (
          <p role="status" className="mt-3 rounded-lg bg-muted/60 p-3 text-sm">
            {lifecycle === "room_ended"
              ? "This room has ended. Nobody new can join it."
              : lifecycle === "room_expired"
                ? "This room has expired. Nobody new can join it."
                : "This room isn't open yet."}
          </p>
        ) : null}

        <RoomPresenceRail
          members={membersQuery.data ?? []}
          presence={presence}
          onOpenPeople={() => setTab("people")}
        />
      </header>

      {/* Sticky section switcher — one focused surface at a time instead of a
          single endless scroll. */}
      <nav
        aria-label="Room sections"
        className="sticky top-14 z-20 -mx-3 mt-4 overflow-x-auto border-b border-border/60 bg-background/85 px-3 backdrop-blur-xl sm:mx-0"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-opacity ${
                    active ? "bg-primary opacity-100" : "opacity-0"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </nav>


      {/* Every panel stays mounted so realtime subscriptions, playback and call
          state survive tab switches; only visibility changes. */}
      <div className={tab === "stage" ? "pb-8" : "hidden"}>
        {room.type === "study" || room.type === "research" ? (
          <StudyRoom
            roomId={room.id}
            userId={user?.id}
            canControl={isHost || myMembership?.can_control_playback === true}
            roomActive={lifecycle === "ok"}
            onDiscussInRoom={() => setTab("chat")}
          />
        ) : room.type === "music" ? (
          <MusicRoom
            roomId={room.id}
            roomCode={room.join_code}
            userId={user?.id}
            canManage={isHost || myMembership?.can_control_playback === true}
            roomActive={lifecycle === "ok"}
          />
        ) : (
          <WatchTogether
            roomId={room.id}
            roomCode={room.join_code}
            userId={user?.id}
            canControl={isHost || myMembership?.can_control_playback === true}
            roomActive={lifecycle === "ok"}
          />
        )}

        {room.privacy === "private" || room.privacy === "invite_only" ? (
          <LocalMediaRoom
            roomId={room.id}
            userId={user?.id}
            canShare={isHost || myMembership?.can_control_playback === true}
            roomActive={lifecycle === "ok"}
          />
        ) : null}
      </div>

      <div className={tab === "chat" ? "pb-8" : "hidden"}>
        <RoomChat
          roomId={room.id}
          userId={user?.id}
          members={membersQuery.data ?? []}
          canModerate={canModerate}
          canInteract={canChat}
          disabledReason={chatDisabledReason}
        />
      </div>

      <div className={tab === "people" ? "pb-8" : "hidden"}>
        <section className="mt-6" aria-labelledby="members-heading">
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
      </div>

      <div className={tab === "share" ? "pb-8" : "hidden"}>
        {room.description ? (
          <p className="mt-6 max-w-2xl text-sm text-muted-foreground">{room.description}</p>
        ) : null}

        {isHost && room.join_code ? (
          <section className="surface-panel mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 sm:p-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Join code</h2>
              <p className="mt-1 font-mono text-lg tracking-widest">{room.join_code}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Share it only with people you want in this room.
              </p>
            </div>
            <Button
              variant="outline"
              className="shrink-0"
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

        {!isHost && !room.description ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Only the host can invite people to this room.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
