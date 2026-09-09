import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { DoorOpen, Plus, Trash2 } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { deleteRoom } from "@/lib/rooms.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";

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

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your rooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Private and invite-only. Public discovery is off in this release.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/rooms/join">
              <DoorOpen className="size-4" aria-hidden="true" /> Join
            </Link>
          </Button>
          <Button asChild>
            <Link to="/rooms/new">
              <Plus className="size-4" aria-hidden="true" /> New room
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-8">
        {isPending ? (
          <LoadingState label="Loading your rooms" />
        ) : isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : data.length === 0 ? (
          <EmptyState
            title="No rooms yet"
            description="Create your first room, then invite the people you want in it."
            action={
              <Button asChild>
                <Link to="/rooms/new">Create a room</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.map((room) => (
              <li key={room.id} className="relative">
                {room.owner_id === user?.id ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${room.name}`}
                    className="absolute right-2 top-2 z-10 size-9 rounded-full text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete({ id: room.id, name: room.name })}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
                <Link
                  to="/rooms/$roomId"
                  params={{ roomId: room.id }}
                  className="surface-panel block p-5 transition-shadow hover:shadow-[var(--shadow-elevated)]"
                >
                  <div className="flex items-start justify-between gap-3 pr-10">
                    <h2 className="text-base font-semibold">{room.name}</h2>
                    <Badge variant="secondary">{room.type}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {room.status} · {room.privacy}
                    {room.is_ephemeral ? " · ephemeral" : ""}
                  </p>
                </Link>
              </li>
            ))}
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
    </AppShell>
  );
}
