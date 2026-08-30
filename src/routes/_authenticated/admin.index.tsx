import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Users } from "lucide-react";

import { AppShell } from "@/components/app-shell";
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
import { useStaffContext } from "@/hooks/useStaffContext";
import {
  getModerationOverview,
  getReportQueue,
  type ReportRow,
  type ReportStatus,
  type ReportTarget,
} from "@/lib/admin.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Moderation console — SyncTogether" },
      { name: "description", content: "Internal SyncTogether report queue and moderation tools." },
      { property: "og:title", content: "Moderation console — SyncTogether" },
      {
        property: "og:description",
        content: "Internal SyncTogether report queue and moderation tools.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <StaffGate>
      <AdminDashboard />
    </StaffGate>
  ),
});

const PAGE_SIZE = 25;
const ANY = "__any__";

const STATUS_TONE: Record<ReportStatus, string> = {
  open: "bg-destructive/15 text-destructive",
  reviewing: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  actioned: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  dismissed: "bg-muted text-muted-foreground",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function AdminDashboard() {
  const { isAdmin } = useStaffContext();
  const fetchOverview = useServerFn(getModerationOverview);
  const fetchQueue = useServerFn(getReportQueue);

  const [status, setStatus] = useState<string>("open");
  const [targetType, setTargetType] = useState<string>(ANY);
  const [categoryInput, setCategoryInput] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  // Debounced free-text filter so typing doesn't hammer the queue endpoint.
  useEffect(() => {
    const id = setTimeout(() => {
      setCategory(categoryInput.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(id);
  }, [categoryInput]);

  const filters = useMemo(
    () => ({
      status: status === ANY ? null : (status as ReportStatus),
      target_type: targetType === ANY ? null : (targetType as ReportTarget),
      category: category || null,
      from: from ? new Date(`${from}T00:00:00Z`).toISOString() : null,
      to: to ? new Date(`${to}T23:59:59Z`).toISOString() : null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [status, targetType, category, from, to, page],
  );

  const overview = useQuery({
    queryKey: queryKeys.staff.overview(),
    queryFn: () => fetchOverview(),
    staleTime: 15_000,
  });

  const queue = useQuery({
    queryKey: queryKeys.staff.reports(filters),
    queryFn: () => fetchQueue({ data: filters }),
    placeholderData: keepPreviousData,
  });

  const counts = overview.data?.ok ? overview.data.counts : null;
  const recent = overview.data?.ok ? overview.data.recent_actions : [];

  const rows: ReportRow[] = queue.data?.ok ? queue.data.rows : [];
  const total = queue.data?.ok ? queue.data.total : 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin control center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal tool. Every action here is recorded in the audit trail.
          </p>
        </div>
        {isAdmin ? (
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/roles">
              <Users className="size-4" aria-hidden="true" /> Manage roles
            </Link>
          </Button>
        ) : null}
      </div>

      <AdminNav />

      {isAdmin ? (
        <section aria-labelledby="platform-heading" className="mt-6">
          <h2 id="platform-heading" className="text-lg font-semibold">
            Platform at a glance
          </h2>
          {stats.isPending ? (
            <LoadingState label="Loading platform stats" rows={1} />
          ) : stats.data && !stats.data.ok ? (
            <ErrorState message={rpcMessage(stats.data.reason)} />
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  ["Users", platform?.users_total ?? 0],
                  ["New (24h)", platform?.users_new_24h ?? 0],
                  ["Suspended", platform?.users_suspended ?? 0],
                  ["Live rooms", platform?.rooms_active ?? 0],
                  ["Rooms (24h)", platform?.rooms_new_24h ?? 0],
                  ["Messages (24h)", platform?.messages_24h ?? 0],
                  ["Open reports", platform?.reports_open ?? 0],
                  ["Rewarded ads today", platform?.ads_today ?? 0],
                  ["Notifications (24h)", platform?.notifications_24h ?? 0],
                  ["Rooms total", platform?.rooms_total ?? 0],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section aria-labelledby="overview-heading" className="mt-8">
        <h2 id="overview-heading" className="text-lg font-semibold">
          Reports overview
        </h2>
        {overview.isPending ? (
          <LoadingState label="Loading overview" rows={1} />
        ) : overview.data && !overview.data.ok ? (
          <ErrorState message={rpcMessage(overview.data.reason)} />
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Open", counts?.open ?? 0],
                ["Reviewing", counts?.reviewing ?? 0],
                ["Actioned", counts?.actioned ?? 0],
                ["Dismissed", counts?.dismissed ?? 0],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        )}
      </section>


      <section aria-labelledby="queue-heading" className="mt-8">
        <h2 id="queue-heading" className="text-lg font-semibold">
          Reports queue
        </h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label htmlFor="f-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(0);
              }}
            >
              <SelectTrigger id="f-status" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="actioned">Actioned</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="f-target">Target</Label>
            <Select
              value={targetType}
              onValueChange={(v) => {
                setTargetType(v);
                setPage(0);
              }}
            >
              <SelectTrigger id="f-target" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any target</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="room">Room</SelectItem>
                <SelectItem value="message">Message</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="f-category">Reason contains</Label>
            <Input
              id="f-category"
              className="mt-1"
              value={categoryInput}
              placeholder="harassment"
              onChange={(e) => setCategoryInput(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="f-from">From</Label>
            <Input
              id="f-from"
              type="date"
              className="mt-1"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <Input
              id="f-to"
              type="date"
              className="mt-1"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        <div className="mt-4">
          {queue.isPending ? (
            <LoadingState label="Loading reports" />
          ) : queue.isError ? (
            <ErrorState message="The report queue could not be loaded." onRetry={queue.refetch} />
          ) : queue.data && !queue.data.ok ? (
            <ErrorState message={rpcMessage(queue.data.reason)} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No reports match these filters"
              description="Adjust the filters above to widen the search."
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {rows.map((r) => (
                <li key={r.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status]}`}
                        >
                          {r.status}
                        </span>
                        <Badge variant="outline">{r.target_type}</Badge>
                        <span className="text-sm font-medium">{r.category}</span>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {r.target_name ? `Target: ${r.target_name}` : "Target: unknown"}
                        {r.room_name ? ` · Room: ${r.room_name}` : ""}
                        {r.action_count > 0 ? ` · ${r.action_count} action(s)` : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(r.created_at)}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/reports/$reportId" params={{ reportId: r.id }}>
                        Review
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {total === 0 ? "No results" : `${total} report(s) · page ${page + 1} of ${maxPage + 1}`}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0 || queue.isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= maxPage || queue.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="mt-10">
        <h2 id="recent-heading" className="text-lg font-semibold">
          Recent moderation actions
        </h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No actions recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {recent.map((raw) => {
              const a = raw as Record<string, string | null>;
              return (
                <li key={String(a["id"])} className="flex flex-wrap gap-2 p-3">
                  <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{a["action"]}</span>
                  <span className="text-muted-foreground">
                    by {a["actor_name"] ?? "staff"} on {a["target_name"] ?? "unknown user"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(a["created_at"])}
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
