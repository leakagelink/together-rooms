import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Eye, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { StaffGate } from "@/components/admin/staff-gate";
import { ErrorState, LoadingState } from "@/components/state-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  createModerationAction,
  getRemovedMessage,
  getReportDetail,
  getUserEnforcement,
  reverseModerationAction,
  setReportStatus,
  type ModerationActionType,
  type ReportStatus,
} from "@/lib/admin.functions";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage, type Json } from "@/lib/rpc-types";

export const Route = createFileRoute("/_authenticated/admin/reports/$reportId")({
  head: () => ({
    meta: [
      { title: "Report review — SyncTogether" },
      { name: "description", content: "Internal SyncTogether report review and action tools." },
      { property: "og:title", content: "Report review — SyncTogether" },
      {
        property: "og:description",
        content: "Internal SyncTogether report review and action tools.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <StaffGate>
      <ReportReview />
    </StaffGate>
  ),
});

const DEFAULT_DURATION = "default";

/** Enforcement windows offered to staff. "default" defers to the RPC. */
const DURATIONS: { value: string; label: string }[] = [
  { value: DEFAULT_DURATION, label: "Default (7 days for a suspension)" },
  { value: "60", label: "1 hour" },
  { value: "1440", label: "24 hours" },
  { value: "10080", label: "7 days" },
  { value: "43200", label: "30 days" },
];

/** Actions that apply a time-limited restriction. */
const TIMED_ACTIONS: ModerationActionType[] = ["mute", "suspend"];

const ACTIONS: { value: ModerationActionType; label: string }[] = [
  { value: "warn", label: "Warn user" },
  { value: "mute", label: "Mute user" },
  { value: "kick", label: "Remove from room" },
  { value: "ban", label: "Ban from room" },
  { value: "suspend", label: "Suspend account" },
  { value: "content_removed", label: "Record content removal" },
  { value: "dismissed", label: "Record dismissal" },
];

function str(v: Json | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function ReportReview() {
  const { reportId } = useParams({ from: "/_authenticated/admin/reports/$reportId" });
  const queryClient = useQueryClient();

  const fetchDetail = useServerFn(getReportDetail);
  const updateStatus = useServerFn(setReportStatus);
  const addAction = useServerFn(createModerationAction);
  const undoAction = useServerFn(reverseModerationAction);
  const fetchEnforcement = useServerFn(getUserEnforcement);
  const revealMessage = useServerFn(getRemovedMessage);

  const [note, setNote] = useState("");
  const [nextStatus, setNextStatus] = useState<ReportStatus>("reviewing");
  const [action, setAction] = useState<ModerationActionType>("warn");
  const [actionReason, setActionReason] = useState("");
  const [duration, setDuration] = useState<string>(DEFAULT_DURATION);
  // Held in component state only — never written to the query cache.
  const [revealed, setRevealed] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: queryKeys.staff.report(reportId),
    queryFn: () => fetchDetail({ data: { report_id: reportId } }),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.staff.report(reportId) });
    void queryClient.invalidateQueries({ queryKey: ["staff", "reports"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.staff.overview() });
  }

  const statusMutation = useMutation({
    mutationFn: () =>
      updateStatus({
        data: {
          report_id: reportId,
          status: nextStatus,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      toast.success(`Report marked ${result.status}.`);
      setNote("");
      invalidate();
    },
    onError: () => toast.error("The status could not be updated."),
  });

  const targetUserId = detail.data?.ok ? str(detail.data.report["target_user_id"]) : null;

  const enforcement = useQuery({
    queryKey: ["staff", "enforcement", targetUserId],
    queryFn: () => fetchEnforcement({ data: { user_id: targetUserId! } }),
    enabled: Boolean(targetUserId),
  });

  const actionMutation = useMutation({
    mutationFn: () => {
      const report = detail.data?.ok ? detail.data.report : {};
      if (!targetUserId) throw new Error("This report has no account to act on.");
      const minutes =
        TIMED_ACTIONS.includes(action) && duration !== DEFAULT_DURATION ? Number(duration) : null;
      return addAction({
        data: {
          action,
          report_id: reportId,
          room_id: str(report["target_room_id"]),
          target_user_id: targetUserId,
          ...(minutes ? { duration_minutes: minutes } : {}),
          ...(actionReason.trim() ? { reason: actionReason.trim() } : {}),
        },
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      toast.success("Enforcement applied.");
      setActionReason("");
      invalidate();
      void enforcement.refetch();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "The action could not be applied."),
  });

  const reverseMutation = useMutation({
    mutationFn: (actionId: string) => undoAction({ data: { action_id: actionId } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      toast.success("Enforcement reversed.");
      invalidate();
      void enforcement.refetch();
    },
    onError: () => toast.error("The action could not be reversed."),
  });

  const revealMutation = useMutation({
    mutationFn: (messageId: string) => revealMessage({ data: { message_id: messageId } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(rpcMessage(result.reason));
        return;
      }
      setRevealed(result.content);
      invalidate();
    },
    onError: () => toast.error("That content could not be retrieved."),
  });

  if (detail.isPending) {
    return (
      <AppShell>
        <LoadingState label="Loading report" />
      </AppShell>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <AppShell>
        <ErrorState message="The report could not be loaded." onRetry={detail.refetch} />
      </AppShell>
    );
  }

  if (!detail.data.ok) {
    return (
      <AppShell>
        <ErrorState message={rpcMessage(detail.data.reason)} />
      </AppShell>
    );
  }

  const { report, message, actions, audit } = detail.data;
  const messageId = message ? str(message["id"]) : null;
  const messageRemoved = message ? str(message["status"]) !== "active" : false;

  return (
    <AppShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/admin">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to queue
        </Link>
      </Button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Report review</h1>
        <Badge variant="outline">{str(report["status"])}</Badge>
        <Badge variant="outline">{str(report["target_type"])}</Badge>
      </div>

      <dl className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Category</dt>
          <dd className="font-medium">{str(report["category"]) ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reported</dt>
          <dd className="font-medium">{formatDate(str(report["created_at"]))}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Target user</dt>
          <dd className="font-medium">{str(report["target_name"]) ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Room</dt>
          <dd className="font-medium">{str(report["room_name"]) ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Reporter details</dt>
          <dd className="whitespace-pre-wrap">
            {str(report["details"]) ?? "No details provided."}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        The reporter's identity is intentionally not shown here and is never revealed to the
        reported user.
      </p>

      {message ? (
        <section aria-labelledby="msg-heading" className="mt-8">
          <h2 id="msg-heading" className="text-lg font-semibold">
            Reported message
          </h2>
          <div className="mt-2 rounded-lg border border-border bg-card p-4 text-sm">
            <p className="text-xs text-muted-foreground">
              {formatDate(str(message["created_at"]))} · status {str(message["status"])}
            </p>
            {messageRemoved ? (
              <div className="mt-3">
                {revealed === null ? (
                  <>
                    <p className="text-muted-foreground">
                      This message was removed. Its original text is stored in the restricted
                      moderation archive.
                    </p>
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      disabled={!messageId || revealMutation.isPending}
                      onClick={() => messageId && revealMutation.mutate(messageId)}
                    >
                      <Eye className="size-4" aria-hidden="true" /> Reveal original text (audited)
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap rounded bg-muted p-3">{revealed}</p>
                    <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <ShieldAlert className="size-3" aria-hidden="true" />
                      This retrieval was recorded in the audit log.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <p className="mt-3 whitespace-pre-wrap">{str(message["content"])}</p>
            )}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="triage-heading" className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 id="triage-heading" className="text-lg font-semibold">
            Update status
          </h2>
          <div className="mt-3">
            <Label htmlFor="next-status">New status</Label>
            <Select value={nextStatus} onValueChange={(v) => setNextStatus(v as ReportStatus)}>
              <SelectTrigger id="next-status" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="actioned">Actioned</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3">
            <Label htmlFor="note">Moderator note (audit only)</Label>
            <Textarea
              id="note"
              className="mt-1"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this decision was made"
            />
          </div>
          <Button
            className="mt-3"
            disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate()}
          >
            Save status
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">Apply enforcement</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This takes effect immediately: mutes, removals, room bans and account suspensions are
            applied by the database, not just logged.
          </p>
          <div className="mt-3">
            <Label htmlFor="action">Action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as ModerationActionType)}>
              <SelectTrigger id="action" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {TIMED_ACTIONS.includes(action) ? (
            <div className="mt-3">
              <Label htmlFor="duration">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="duration" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="mt-3">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              className="mt-1"
              rows={3}
              maxLength={1000}
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>
          <Button
            className="mt-3"
            variant="secondary"
            disabled={actionMutation.isPending || !targetUserId}
            onClick={() => actionMutation.mutate()}
          >
            {actionMutation.isPending ? "Applying…" : "Apply enforcement"}
          </Button>
          {!targetUserId ? (
            <p className="mt-2 text-sm text-muted-foreground">
              This report is not linked to an account, so enforcement is unavailable.
            </p>
          ) : null}
        </div>
      </section>

      {enforcement.data?.ok ? (
        <section aria-labelledby="enforcement-heading" className="mt-8">
          <h2 id="enforcement-heading" className="text-lg font-semibold">
            Account enforcement
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Status: <strong>{enforcement.data.account_status ?? "unknown"}</strong> ·{" "}
            {enforcement.data.open_reports} open report(s) from{" "}
            {enforcement.data.distinct_reporters} reporter(s).
          </p>
          {enforcement.data.actions.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No enforcement has ever been applied to this account.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {enforcement.data.actions.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground">{a.reason ?? "No reason given"}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(a.created_at)}
                    {a.expires_at ? ` · expires ${formatDate(a.expires_at)}` : " · permanent"}
                  </span>
                  <Button
                    className="ml-auto"
                    size="sm"
                    variant="outline"
                    disabled={reverseMutation.isPending}
                    onClick={() => reverseMutation.mutate(a.id)}
                  >
                    Reverse
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 id="history-heading" className="text-lg font-semibold">
            Actions on this report
          </h2>
          {actions.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No actions recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {actions.map((a) => (
                <li key={str(a["id"]) ?? Math.random()} className="p-3">
                  <p className="font-medium">{str(a["action"])}</p>
                  <p className="text-muted-foreground">{str(a["reason"]) ?? "No reason given"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {str(a["actor_name"]) ?? "staff"} · {formatDate(str(a["created_at"]))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="text-lg font-semibold">Audit trail</h2>
          {audit.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No audit entries yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {audit.map((a) => (
                <li key={str(a["id"]) ?? Math.random()} className="p-3">
                  <p className="font-medium">{str(a["action"])}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {str(a["actor_name"]) ?? "system"} · {formatDate(str(a["created_at"]))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </AppShell>
  );
}
