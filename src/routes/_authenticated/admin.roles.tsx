import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { StaffGate } from "@/components/admin/staff-gate";
import { ErrorState, LoadingState } from "@/components/state-views";
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
  assignAppRole,
  listAppRoles,
  revokeAppRole,
  searchUsers,
  type AppStaffRole,
  type UserSearchRow,
} from "@/lib/admin.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";

export const Route = createFileRoute("/_authenticated/admin/roles")({
  head: () => ({
    meta: [
      { title: "Role management — SyncTogether" },
      { name: "description", content: "Internal SyncTogether staff role administration." },
      { property: "og:title", content: "Role management — SyncTogether" },
      { property: "og:description", content: "Internal SyncTogether staff role administration." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <StaffGate requireAdmin>
      <RolesPage />
    </StaffGate>
  ),
});

function RolesPage() {
  const queryClient = useQueryClient();
  const fetchRoles = useServerFn(listAppRoles);
  const runSearch = useServerFn(searchUsers);
  const assign = useServerFn(assignAppRole);
  const revoke = useServerFn(revokeAppRole);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<UserSearchRow[] | null>(null);
  const [grantRole, setGrantRole] = useState<AppStaffRole>("moderator");

  const roles = useQuery({
    queryKey: queryKeys.staff.roles(),
    queryFn: () => fetchRoles(),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.staff.roles() });
    void queryClient.invalidateQueries({ queryKey: ["staff", "context"] });
  }

  const searchMutation = useMutation({
    mutationFn: () => runSearch({ data: { q: term.trim() } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      setResults(result.rows);
    },
    onError: () => toast.error("The search could not be completed."),
  });

  const assignMutation = useMutation({
    mutationFn: (userId: string) => assign({ data: { user_id: userId, role: grantRole } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      toast.success("Role granted.");
      refresh();
    },
    onError: () => toast.error("The role could not be granted."),
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { userId: string; role: AppStaffRole }) =>
      revoke({ data: { user_id: input.userId, role: input.role } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      toast.success("Role revoked.");
      refresh();
    },
    onError: () => toast.error("The role could not be revoked."),
  });

  const rows = roles.data?.ok ? roles.data.rows : [];
  const selfId = roles.data?.ok ? roles.data.self_id : "";

  return (
    <AppShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/admin">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to console
        </Link>
      </Button>

      <h1 className="mt-3 text-2xl font-semibold">Role management</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Administrators only. Every grant and revoke is written to the audit log. You cannot remove
        your own admin role, and the last remaining admin cannot be removed.
      </p>

      <section aria-labelledby="grant-heading" className="mt-8 rounded-lg border border-border bg-card p-4">
        <h2 id="grant-heading" className="text-lg font-semibold">
          Grant a role
        </h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (term.trim().length < 2) {
              toast.error("Enter at least two characters.");
              return;
            }
            searchMutation.mutate();
          }}
        >
          <div className="min-w-56 flex-1">
            <Label htmlFor="user-search">Find a user by email or username</Label>
            <Input
              id="user-search"
              className="mt-1"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="grant-role">Role</Label>
            <Select value={grantRole} onValueChange={(v) => setGrantRole(v as AppStaffRole)}>
              <SelectTrigger id="grant-role" className="mt-1 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="moderator">Moderator</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={searchMutation.isPending}>
            <Search className="size-4" aria-hidden="true" /> Search
          </Button>
        </form>

        {results ? (
          results.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No matching users.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
              {results.map((u) => (
                <li key={u.user_id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {u.display_name ?? u.username ?? "Unnamed user"}
                    </p>
                    <p className="truncate text-muted-foreground">{u.email ?? "—"}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r} variant="outline">
                        {r}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={assignMutation.isPending || u.roles.includes(grantRole)}
                    onClick={() => assignMutation.mutate(u.user_id)}
                  >
                    Grant {grantRole}
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      <section aria-labelledby="current-heading" className="mt-8">
        <h2 id="current-heading" className="text-lg font-semibold">
          Current staff
        </h2>
        {roles.isPending ? (
          <LoadingState label="Loading roles" />
        ) : roles.isError ? (
          <ErrorState message="Roles could not be loaded." onRetry={roles.refetch} />
        ) : roles.data && !roles.data.ok ? (
          <ErrorState message={rpcMessage(roles.data.reason)} />
        ) : rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No staff roles assigned.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {rows.map((r) => (
              <li
                key={`${r.user_id}-${r.role}`}
                className="flex flex-wrap items-center gap-3 p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.display_name ?? r.username ?? "Unnamed user"}
                    {r.user_id === selfId ? " (you)" : ""}
                  </p>
                  <p className="truncate text-muted-foreground">{r.email ?? "—"}</p>
                </div>
                <Badge variant="outline">{r.role}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revokeMutation.isPending || r.user_id === selfId}
                  onClick={() => revokeMutation.mutate({ userId: r.user_id, role: r.role })}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
