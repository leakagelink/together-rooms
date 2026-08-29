import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Flag,
  LogIn,
  LogOut,
  MessageSquare,
  MoreVertical,
  PowerOff,
  Share2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ReportDialog } from "@/components/report-dialog";
import { RoomInvitePanel } from "@/components/room/room-invite-panel";
import { RoomMembersPanel } from "@/components/room/room-members-panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    <AppShell tone="cinema">
      <ErrorState message="This room couldn't be opened." />
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell tone="cinema">
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
  // The media stage is now pinned above the tabs, so "stage" resolves to chat.
  const [tab, setTab] = useState<RoomTab>(
    initialTab && initialTab !== "stage" ? initialTab : "chat",
  );

  // Android/browser lifecycle: on foreground or reconnect every authoritative
  // query is refetched instead of trusting the suspended snapshot.
  useAppLifecycle({ inRoom: true, inCall: false });

  // Deep links (notification taps) can change the requested tab while mounted.
  useEffect(() => {
    if (initialTab && initialTab !== "stage") setTab(initialTab);
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
      <AppShell tone="cinema">
        <LoadingState label="Loading room" />
      </AppShell>
    );
  }

  if (roomQuery.isError) {
    return (
      <AppShell tone="cinema">
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
      <AppShell tone="cinema">
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

  // The stage (Watch/Listen/Study) is pinned above, so the switcher only
  // carries the secondary surfaces.
  const tabs: { id: RoomTab; label: string; icon: typeof Users }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "people", label: "People", icon: Users },
    { id: "share", label: "Share", icon: Share2 },
  ];

  // When the watch search/filter panel collapses, the secondary surfaces get
  // pulled up right under the video: spacing tightens and, if the tabs were
  // pushed below the fold by the open panel, they scroll back into view.
  const [stageSearchOpen, setStageSearchOpen] = useState(false);
  const tabsNavRef = useRef<HTMLElement | null>(null);
  const previousSearchOpenRef = useRef(false);

  const onStageSearchVisibilityChange = useCallback((open: boolean) => {
    setStageSearchOpen(open);
  }, []);

  useEffect(() => {
    const wasOpen = previousSearchOpenRef.current;
    previousSearchOpenRef.current = stageSearchOpen;
    if (wasOpen && !stageSearchOpen) {
      const node = tabsNavRef.current;
      if (!node) return;
      const id = window.requestAnimationFrame(() => {
        const top = node.getBoundingClientRect().top;
        // Only correct the scroll position when the switcher drifted off the
        // visible area; otherwise leave the user's scroll untouched.
        if (top < 0 || top > window.innerHeight * 0.8) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [stageSearchOpen]);

  return (
    <AppShell tone="cinema">
      {/* Compact room header. On phones the destructive/session actions live in
          an overflow menu so the title never gets squeezed off-screen. */}
      <header className="surface-panel overflow-hidden bg-card/70 p-3 backdrop-blur-xl sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary sm:size-10">
              <Users className="size-4 sm:size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-black tracking-tight sm:text-2xl">
                {room.name}
              </h1>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={
                    connected && authorized
                      ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary"
                      : "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-semibold"
                  }
                >
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${
                      connected && authorized ? "animate-pulse bg-primary" : "bg-muted-foreground"
                    }`}
                  />
                  {!authorized ? "Live off" : connected ? "Live" : "Reconnecting"}
                </span>
                <span className="truncate capitalize">
                  {room.type} · {room.privacy.replace("_", " ")}
                  {room.is_ephemeral ? " · ephemeral" : ""}
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {!isJoined && lifecycle === "ok" && room.join_code ? (
              <Button
                size="sm"
                className="rounded-full"
                onClick={() => rejoinMutation.mutate(room.join_code as string)}
                disabled={rejoinMutation.isPending}
              >
                <LogIn className="size-4" aria-hidden="true" /> Rejoin
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-full"
                  aria-label="Room actions"
                >
                  <MoreVertical className="size-5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => setTab("people")}>
                  <Users className="size-4" aria-hidden="true" /> Members (
                  {membersQuery.data?.length ?? 0})
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTab("share")}>
                  <Share2 className="size-4" aria-hidden="true" /> Invite &amp; join code
                </DropdownMenuItem>
                {isJoined ? (
                  <DropdownMenuItem
                    onSelect={() => leaveMutation.mutate()}
                    disabled={leaveMutation.isPending}
                  >
                    <LogOut className="size-4" aria-hidden="true" /> Leave room
                  </DropdownMenuItem>
                ) : null}
                {isHost && lifecycle === "ok" ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => endMutation.mutate()}
                    disabled={endMutation.isPending}
                  >
                    <PowerOff className="size-4" aria-hidden="true" /> End room
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Self-reporting is rejected server-side, so the host never sees
                a Report action for their own room. Play policy requires the
                report path to stay one tap away from the content itself. */}
            {!isHost ? (
              <ReportDialog
                targetType="room"
                targetRoomId={room.id}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 rounded-full"
                    aria-label="Report this room"
                    title="Report this room"
                  >
                    <Flag className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
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

      </header>

      {/* Stage first: the player is the reason people are here, so it sits
          directly under the header on every screen size. */}
      <section className="mt-3" aria-label={`${stageLabel} together`}>
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
            onSearchVisibilityChange={onStageSearchVisibilityChange}
          />
        )}

      </section>

      {/* Who is here — oval avatars right under the stage, like the mock. */}
      <RoomPresenceRail
        members={membersQuery.data ?? []}
        presence={presence}
        onOpenPeople={() => setTab("people")}
      />

      {/* Sticky section switcher — one focused surface at a time. With search
          collapsed it hugs the video so chat is reachable without scrolling. */}
      <nav
        ref={tabsNavRef}
        aria-label="Room sections"
        className={`sticky top-14 z-20 -mx-3 border-b border-border/60 bg-background/85 px-3 backdrop-blur-xl transition-all duration-300 sm:mx-0 ${
          stageSearchOpen ? "mt-3" : "mt-1"
        }`}
      >
        <div className="grid grid-cols-3">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2.5 text-xs font-semibold transition-colors sm:flex-row sm:gap-2 sm:py-3 sm:text-sm ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full transition-opacity ${
                    active ? "bg-primary opacity-100" : "opacity-0"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </nav>

      {/* Every panel stays mounted so realtime subscriptions and playback
          survive tab switches; only visibility changes. */}
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

        {/* Device sharing lives with the other sharing tools now that the
            stage is reserved for the synchronized player. */}
        {room.privacy === "private" || room.privacy === "invite_only" ? (
          <LocalMediaRoom
            roomId={room.id}
            userId={user?.id}
            canShare={isHost || myMembership?.can_control_playback === true}
            roomActive={lifecycle === "ok"}
          />
        ) : null}

        {!isHost && !room.description ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Only the host can invite people to this room.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
