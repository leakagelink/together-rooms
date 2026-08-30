import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { PowerOff } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { StaffGate } from "@/components/admin/staff-gate";
import { EmptyState, ErrorState, LoadingState } from "@/components/state-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { forceEndRoom, listPlatformRooms } from "@/lib/admin.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";

export const Route = createFileRoute("/_authenticated/admin/rooms")({
  head: () => ({
    meta: [
      { title: "Room management — SyncTogether admin" },
      { name: "description", content: "Monitor live SyncTogether rooms, review activity and shut down rooms that break the rules." },
      { property: "og:title", content: "Room management — SyncTogether admin" },
      {
        property: "og:description",
        content: "Monitor live SyncTogether rooms and shut down rooms that break the rules.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <StaffGate requireAdmin>
      <AdminRooms />
    </StaffGate>
  ),
});

const PAGE_SIZE = 25;
const ANY = "__any__";

type RoomStatus = "draft" | "active" | "paused" | "ended" | "archived";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function AdminRooms() {
  const queryClient = useQueryClient();
  const fetchRooms = useServerFn(listPlatformRooms);
  const endRoom = useServerFn(forceEndRoom);

  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => {
      setQ(term.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(id);
  }, [term]);

  const filters = useMemo(
    () => ({
      q: q || null,
      status: status === ANY ? null : (status as RoomStatus),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [q, status, page],
  );

  const rooms = useQuery({
    queryKey: queryKeys.staff.rooms(filters),
    queryFn: () => fetchRooms({ data: filters }),
    placeholderData: keepPreviousData,
  });

  const mutation = useMutation({
    mutationFn: (roomId: string) => endRoom({ data: { room_id: roomId, reason: "admin_console" } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      toast.success("Room ended");
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: () => toast.error("The room could not be ended."),
  });

  const rows = rooms.data?.ok ? rooms.data.rows : [];
  const total = rooms.data?.ok ? rooms.data.total : 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <AppShell>
      <div>
        <h1 className="text-2xl font-semibold">Rooms</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every room on the platform, with owner, participants and activity. Ending a room is audited.
        </p>
      </div>
      <AdminNav />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="r-q">Search</Label>
          <Input
            id="r-q"
            className="mt-1"
            placeholder="Room name"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="r-status">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
          >
            <SelectTrigger id="r-status" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="ended">Ended</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4">
        {rooms.isPending ? (
          <LoadingState label="Loading rooms" />
        ) : rooms.isError ? (
          <ErrorState message="Rooms could not be loaded." onRetry={rooms.refetch} />
        ) : rooms.data && !rooms.data.ok ? (
          <ErrorState message={rpcMessage(rooms.data.reason)} />
        ) : rows.length === 0 ? (
          <EmptyState title="No rooms found" description="Try a different search or status." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {rows.map((r) => (
              <li key={r.room_id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <Badge variant="outline">{r.type}</Badge>
                    <Badge variant={r.status === "active" ? "secondary" : "outline"}>
                      {r.status}
                    </Badge>
                    <Badge variant="outline">{r.privacy}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Host: {r.owner_name ?? "unknown"} · {r.member_count} member(s) ·{" "}
                    {r.message_count} message(s)
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatDate(r.created_at)} · Expires {formatDate(r.expires_at)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={r.status === "ended" || mutation.isPending}
                  onClick={() => mutation.mutate(r.room_id)}
                >
                  <PowerOff className="size-4" aria-hidden="true" /> End room
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total === 0 ? "No results" : `${total} room(s) · page ${page + 1} of ${maxPage + 1}`}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0 || rooms.isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= maxPage || rooms.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
