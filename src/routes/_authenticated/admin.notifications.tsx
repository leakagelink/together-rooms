import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { BellRing, Send, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { StaffGate } from "@/components/admin/staff-gate";
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
import { Textarea } from "@/components/ui/textarea";
import {
  listPlatformRooms,
  listRecentBroadcasts,
  searchUsers,
  sendAdminNotification,
  type AdminRoomRow,
  type UserSearchRow,
} from "@/lib/admin.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";

export const Route = createFileRoute("/_authenticated/admin/notifications")({
  head: () => ({
    meta: [
      { title: "Send announcements — SyncTogether admin" },
      {
        name: "description",
        content: "Compose and send custom in-app announcements to all users, staff, a room or selected accounts.",
      },
      { property: "og:title", content: "Send announcements — SyncTogether admin" },
      {
        property: "og:description",
        content: "Compose and send custom in-app announcements to SyncTogether members.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <StaffGate requireAdmin>
      <AdminNotifications />
    </StaffGate>
  ),
});

type Audience = "all" | "staff" | "room" | "users";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function AdminNotifications() {
  const queryClient = useQueryClient();
  const send = useServerFn(sendAdminNotification);
  const fetchBroadcasts = useServerFn(listRecentBroadcasts);
  const fetchRooms = useServerFn(listPlatformRooms);
  const findUsers = useServerFn(searchUsers);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [roomId, setRoomId] = useState<string>("");
  const [userTerm, setUserTerm] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [picked, setPicked] = useState<UserSearchRow[]>([]);

  useEffect(() => {
    const id = setTimeout(() => setUserQuery(userTerm.trim()), 350);
    return () => clearTimeout(id);
  }, [userTerm]);

  const rooms = useQuery({
    queryKey: queryKeys.staff.rooms({ picker: true }),
    queryFn: () => fetchRooms({ data: { q: null, status: "active", limit: 50, offset: 0 } }),
    enabled: audience === "room",
  });

  const userResults = useQuery({
    queryKey: queryKeys.staff.users({ picker: userQuery }),
    queryFn: () => findUsers({ data: { q: userQuery } }),
    enabled: audience === "users" && userQuery.length >= 3,
  });

  const broadcasts = useQuery({
    queryKey: queryKeys.staff.broadcasts(),
    queryFn: () => fetchBroadcasts(),
    staleTime: 15_000,
  });

  const mutation = useMutation({
    mutationFn: () =>
      send({
        data: {
          title: title.trim(),
          body: body.trim() || undefined,
          audience,
          room_id: audience === "room" ? roomId : null,
          user_ids: audience === "users" ? picked.map((u) => u.user_id) : null,
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      toast.success(`Sent to ${result.sent} member(s)`);
      setTitle("");
      setBody("");
      setPicked([]);
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.broadcasts() });
    },
    onError: () => toast.error("The announcement could not be sent."),
  });

  const roomRows: AdminRoomRow[] = rooms.data?.ok ? rooms.data.rows : [];
  const found: UserSearchRow[] = userResults.data?.ok ? userResults.data.rows : [];
  const history = broadcasts.data?.ok ? broadcasts.data.rows : [];

  const canSend =
    title.trim().length > 0 &&
    !mutation.isPending &&
    (audience !== "room" || roomId.length > 0) &&
    (audience !== "users" || picked.length > 0);

  return (
    <AppShell>
      <div>
        <h1 className="text-2xl font-semibold">Custom notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send an in-app announcement. Recipients see it in their notification centre instantly.
        </p>
      </div>
      <AdminNav />

      <section aria-labelledby="compose" className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 id="compose" className="flex items-center gap-2 text-lg font-semibold">
          <BellRing className="size-4" aria-hidden="true" /> Compose
        </h2>

        <div className="mt-4 grid gap-4">
          <div>
            <Label htmlFor="n-title">Title</Label>
            <Input
              id="n-title"
              className="mt-1"
              maxLength={120}
              value={title}
              placeholder="New feature: shared playlists"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="n-body">Message</Label>
            <Textarea
              id="n-body"
              className="mt-1"
              rows={3}
              maxLength={240}
              value={body}
              placeholder="Tell members what changed (240 characters max)."
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{body.length}/240</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="n-audience">Audience</Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
                <SelectTrigger id="n-audience" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="staff">Staff only</SelectItem>
                  <SelectItem value="room">Members of a room</SelectItem>
                  <SelectItem value="users">Selected users</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {audience === "room" ? (
              <div>
                <Label htmlFor="n-room">Room</Label>
                <Select value={roomId} onValueChange={setRoomId}>
                  <SelectTrigger id="n-room" className="mt-1">
                    <SelectValue placeholder={rooms.isPending ? "Loading…" : "Pick a room"} />
                  </SelectTrigger>
                  <SelectContent>
                    {roomRows.map((r) => (
                      <SelectItem key={r.room_id} value={r.room_id}>
                        {r.name} · {r.member_count} member(s)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          {audience === "users" ? (
            <div>
              <Label htmlFor="n-users">Find users</Label>
              <Input
                id="n-users"
                className="mt-1"
                placeholder="Type at least 3 characters"
                value={userTerm}
                onChange={(e) => setUserTerm(e.target.value)}
              />
              {picked.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {picked.map((u) => (
                    <li key={u.user_id}>
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary"
                        onClick={() =>
                          setPicked((prev) => prev.filter((p) => p.user_id !== u.user_id))
                        }
                      >
                        {u.display_name ?? u.username ?? u.email ?? "user"}
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {found.length > 0 ? (
                <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                  {found
                    .filter((u) => !picked.some((p) => p.user_id === u.user_id))
                    .map((u) => (
                      <li key={u.user_id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60"
                          onClick={() => setPicked((prev) => [...prev, u].slice(0, 200))}
                        >
                          <span>{u.display_name ?? u.username ?? "Unnamed"}</span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div>
            <Button disabled={!canSend} onClick={() => mutation.mutate()}>
              <Send className="size-4" aria-hidden="true" />
              {mutation.isPending ? "Sending…" : "Send announcement"}
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="history" className="mt-8">
        <h2 id="history" className="text-lg font-semibold">
          Recent announcements
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {history.map((row) => {
              const meta = (row.metadata ?? {}) as Record<string, unknown>;
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-2 p-3">
                  <span className="font-medium">{String(meta["title"] ?? "Announcement")}</span>
                  <Badge variant="outline">{String(meta["audience"] ?? "all")}</Badge>
                  <span className="text-muted-foreground">
                    {String(meta["sent"] ?? 0)} recipient(s) · by {row.actor_name ?? "admin"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(row.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
