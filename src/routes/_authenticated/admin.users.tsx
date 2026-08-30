import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ShieldOff, ShieldCheck } from "lucide-react";
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
import {
  listPlatformUsers,
  setAccountStatus,
  type AdminUserRow,
} from "@/lib/admin.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "User management — SyncTogether admin" },
      { name: "description", content: "Search SyncTogether accounts, review activity and suspend or restore users." },
      { property: "og:title", content: "User management — SyncTogether admin" },
      {
        property: "og:description",
        content: "Search SyncTogether accounts, review activity and suspend or restore users.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <StaffGate requireAdmin>
      <AdminUsers />
    </StaffGate>
  ),
});

const PAGE_SIZE = 25;
const ANY = "__any__";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function AdminUsers() {
  const queryClient = useQueryClient();
  const fetchUsers = useServerFn(listPlatformUsers);
  const updateStatus = useServerFn(setAccountStatus);

  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ANY);
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
      status: status === ANY ? null : (status as AdminUserRow["status"]),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [q, status, page],
  );

  const users = useQuery({
    queryKey: queryKeys.staff.users(filters),
    queryFn: () => fetchUsers({ data: filters }),
    placeholderData: keepPreviousData,
  });

  const mutation = useMutation({
    mutationFn: (input: { user_id: string; status: "active" | "suspended" }) =>
      updateStatus({ data: input }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      toast.success("Account updated");
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: () => toast.error("The account could not be updated."),
  });

  const rows = users.data?.ok ? users.data.rows : [];
  const total = users.data?.ok ? users.data.total : 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <AppShell>
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search every account, inspect activity and suspend abusive users. All changes are audited.
        </p>
      </div>
      <AdminNav />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="u-q">Search</Label>
          <Input
            id="u-q"
            className="mt-1"
            placeholder="Email, username or display name"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="u-status">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
          >
            <SelectTrigger id="u-status" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="deactivated">Deactivated</SelectItem>
              <SelectItem value="deleted">Deleted</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4">
        {users.isPending ? (
          <LoadingState label="Loading users" />
        ) : users.isError ? (
          <ErrorState message="Users could not be loaded." onRetry={users.refetch} />
        ) : users.data && !users.data.ok ? (
          <ErrorState message={rpcMessage(users.data.reason)} />
        ) : rows.length === 0 ? (
          <EmptyState title="No users found" description="Try a different search or status." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {rows.map((u) => {
              const suspended = u.status === "suspended";
              const isAdmin = u.roles.includes("admin");
              return (
                <li key={u.user_id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {u.display_name ?? u.username ?? "Unnamed"}
                      </span>
                      {u.roles.map((r) => (
                        <Badge key={r} variant="outline">
                          {r}
                        </Badge>
                      ))}
                      <Badge variant={suspended ? "destructive" : "secondary"}>{u.status}</Badge>
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{u.email ?? "—"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Joined {formatDate(u.created_at)} · Last sign-in {formatDate(u.last_sign_in_at)} ·{" "}
                      {u.rooms_owned} room(s)
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={suspended ? "outline" : "destructive"}
                    disabled={isAdmin || mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        user_id: u.user_id,
                        status: suspended ? "active" : "suspended",
                      })
                    }
                  >
                    {suspended ? (
                      <>
                        <ShieldCheck className="size-4" aria-hidden="true" /> Reactivate
                      </>
                    ) : (
                      <>
                        <ShieldOff className="size-4" aria-hidden="true" /> Suspend
                      </>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total === 0 ? "No results" : `${total} user(s) · page ${page + 1} of ${maxPage + 1}`}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0 || users.isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= maxPage || users.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
