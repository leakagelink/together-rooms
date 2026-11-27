import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { DoorOpen, Lock, MoreVertical, Plus, Trash2, Users } from "lucide-react";

import { AppShell } from "@/components/app-shell";

import { EmptyState, ErrorState, LoadingState } from "@/components/state-views";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DashboardActions, DashboardGreeting } from "@/components/rooms/dashboard-actions";
import { ROOM_TYPE_ICONS, ROOM_TYPE_LABELS, roomStatusView } from "@/components/rooms/room-card-meta";
import { greetingName, myProfileQueryOptions } from "@/lib/profile-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { deleteRoom } from "@/lib/rooms.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";

const ROOM_FILTERS = [
  { key: "all", label: "All rooms" },
  { key: "hosting", label: "Hosting" },
  { key: "joined", label: "Joined" },
] as const;
type RoomFilter = (typeof ROOM_FILTERS)[number]["key"];

const roomsQueryOptions = () =>
  queryOptions({
    queryKey: ["rooms", "mine"],
    // The list must always reflect the server: a room created moments ago (or
    // on another device) has to appear as soon as this screen opens, so the
    // cached copy is shown instantly but revalidated on every mount.
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data: rows, error: queryError } = await supabase
        .from("rooms")
        .select("id, name, type, status, privacy, is_ephemeral, created_at, owner_id")
        .neq("status", "archived")
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      return rows ?? [];
    },
  });

export const Route = createFileRoute("/_authenticated/rooms/")({
  head: () => ({
    meta: [
      { title: "Your rooms — SyncTogether" },
      { name: "description", content: "Rooms you host or belong to on SyncTogether." },
      { property: "og:title", content: "Your rooms — SyncTogether" },
      { property: "og:description", content: "Rooms you host or belong to on SyncTogether." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(roomsQueryOptions()),
  component: RoomsPage,
  errorComponent: () => (
    <AppShell>
      <ErrorState message="Your rooms couldn't be loaded." />
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <EmptyState title="Not found" description="This page doesn't exist." />
    </AppShell>
  ),
});

function RoomsPage() {
  const { data, isPending, isError, error, refetch } = useQuery(roomsQueryOptions());
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const removeRoom = useServerFn(deleteRoom);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<RoomFilter>("all");
  const profile = useQuery({ ...myProfileQueryOptions(user?.id ?? ""), enabled: Boolean(user?.id) });

  const deleteMutation = useMutation({
    mutationFn: async (roomId: string) => {
      const result = await removeRoom({ data: { room_id: roomId } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
    },
    onSuccess: async () => {
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.mine() });
      await refetch();
      toast.success("Room deleted.");
    },
    onError: (mutationError: Error) => {
      setPendingDelete(null);
      toast.error(mutationError.message);
    },
  });

  const filtered = (data ?? []).filter((room) =>
    filter === "all" ? true : filter === "hosting" ? room.owner_id === user?.id : room.owner_id !== user?.id,
  );

  return (
    <AppShell>
      <DashboardGreeting name={greetingName(profile.data?.display_name, user?.email)} />

      <div className="mt-5">
        <DashboardActions />
      </div>

      <section aria-labelledby="your-rooms" className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 id="your-rooms" className="text-lg">
            Your rooms
          </h2>
          <span className="text-xs text-muted-foreground">Private &amp; invite-only</span>
        </div>
        <div role="tablist" aria-label="Filter rooms" className="-mx-2 mt-2 flex gap-2 overflow-x-auto px-2 py-2">
          {ROOM_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`press min-h-9 shrink-0 rounded-full px-4 text-sm font-semibold ${
                filter === key ? "glass-selected text-foreground" : "glass text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

      <div className="mt-4">
        {isPending ? (
          <LoadingState label="Loading your rooms" />
        ) : isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={data.length === 0 ? "No rooms yet" : "Nothing here yet"}
            description={
              data.length === 0
                ? "Create your first room, then invite the people you want in it."
                : filter === "hosting"
                  ? "Rooms you create will show up here."
                  : "Rooms you join with a code or invite will show up here."
            }
            action={
              <Button asChild>
                <Link to="/rooms/new" search={{}}>
                  <Plus className="size-4" aria-hidden="true" /> Create a room
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {filtered.map((room, index) => {
              const TypeIcon = ROOM_TYPE_ICONS[room.type as keyof typeof ROOM_TYPE_ICONS] ?? Users;
              const status = roomStatusView(room.status);
              const isOwner = room.owner_id === user?.id;
              return (
                <li
                  key={room.id}
                  className="animate-rise glass group relative flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-glass-strong"
                  style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                >
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-glass-border bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_45%,transparent),color-mix(in_oklab,var(--accent-blue)_25%,transparent))] text-foreground">
                    <TypeIcon className="size-6" aria-hidden="true" />
                  </span>
                  <Link
                    to="/rooms/$roomId"
                    params={{ roomId: room.id }}
                    className="min-w-0 flex-1 after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
                  >
                    <span className="block truncate font-display text-[15px] font-semibold">{room.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span
                        className={`inline-flex items-center gap-1.5 font-semibold ${
                          status.tone === "live" ? "text-success" : status.tone === "paused" ? "text-warning" : ""
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-full ${
                            status.tone === "live"
                              ? "bg-success shadow-[0_0_8px_var(--success)]"
                              : status.tone === "paused"
                                ? "bg-warning"
                                : "bg-muted-foreground"
                          }`}
                        />
                        {status.label}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{ROOM_TYPE_LABELS[room.type] ?? room.type}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Lock className="size-3" aria-hidden="true" />
                        {room.privacy === "invite_only" ? "Invite only" : "Private"}
                      </span>
                      {room.is_ephemeral ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>24h</span>
                        </>
                      ) : null}
                    </span>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`More options for ${room.name}`}
                        className="relative z-10 shrink-0 text-muted-foreground"
                      >
                        <MoreVertical className="size-5" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem asChild>
                        <Link to="/rooms/$roomId" params={{ roomId: room.id }}>
                          <DoorOpen className="size-4" aria-hidden="true" />
                          {room.status === "active" ? "Join room" : "Open room"}
                        </Link>
                      </DropdownMenuItem>
                      {isOwner ? (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setPendingDelete({ id: room.id, name: room.name })}
                        >
                          <Trash2 className="size-4" aria-hidden="true" /> Delete room
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this room?</AlertDialogTitle>
              <AlertDialogDescription>
                Everything in “{pendingDelete?.name}” — chat, notes, tasks, queue and invites — is
                removed for everyone. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMutation.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
                }}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete room"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      </section>
    </AppShell>
  );
}
