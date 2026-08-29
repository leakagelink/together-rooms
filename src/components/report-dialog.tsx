import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Flag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { reportRoomMessage } from "@/lib/chat.functions";
import { errorMessage } from "@/lib/errors";
import { rpcMessage } from "@/lib/rpc-types";
import { reportSchema } from "@/lib/validation";

const CATEGORIES = [
  "harassment_or_bullying",
  "hate_speech",
  "sexual_content",
  "violence_or_threats",
  "spam_or_scam",
  "child_safety",
  "copyright_infringement",
  "self_harm",
  "other",
];

const LABELS: Record<string, string> = {
  harassment_or_bullying: "Harassment or bullying",
  hate_speech: "Hate speech",
  sexual_content: "Sexual or adult content",
  violence_or_threats: "Violence or threats",
  spam_or_scam: "Spam or scam",
  child_safety: "Child safety",
  copyright_infringement: "Copyright infringement",
  self_harm: "Self-harm",
  other: "Something else",
};

export type ReportTargetType =
  | "user"
  | "room"
  | "message"
  | "resource"
  | "note"
  | "task"
  | "queue_item"
  | "playlist"
  | "local_media_session";

const TARGET_NOUN: Record<ReportTargetType, string> = {
  user: "user",
  room: "room",
  message: "message",
  resource: "link",
  note: "note",
  task: "task",
  queue_item: "queued track",
  playlist: "playlist",
  local_media_session: "shared media",
};

export function ReportDialog({
  targetType,
  targetUserId,
  targetRoomId,
  targetMessageId,
  targetRef,
  trigger,
}: {
  targetType: ReportTargetType;
  targetUserId?: string;
  targetRoomId?: string;
  targetMessageId?: string;
  targetRef?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitMessageReport = useServerFn(reportRoomMessage);

  async function submit() {
    const parsed = reportSchema.safeParse({ category, details });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (targetMessageId) {
        // Message reports go through the RPC so membership, self-report and
        // duplicate/spam rules are enforced server-side.
        const result = await submitMessageReport({
          data: {
            message_id: targetMessageId,
            category: parsed.data.category,
            ...(parsed.data.details ? { details: parsed.data.details } : {}),
          },
        });
        if (!result.ok) throw new Error(reasonMessage(result.reason));
        if (result.outcome === "already_reported") {
          toast.info("You already reported this. Our team is on it.");
          setOpen(false);
          return;
        }
      } else {
        // Every non-message surface goes through report_content, which
        // re-checks membership, self-reporting, duplicates and rate limits in
        // the database. Direct table writes are revoked.
        const reference = targetRef ?? targetUserId ?? targetRoomId;
        if (!reference) throw new Error("invalid_request");
        const { data, error: rpcError } = await supabase.rpc("report_content", {
          _target_type: targetType,
          _target_id: reference,
          _category: parsed.data.category,
          _details: parsed.data.details || null,
        } as never);
        if (rpcError) throw rpcError;
        const result = data as { ok?: boolean; reason?: string; outcome?: string } | null;
        if (!result?.ok) throw new Error(rpcMessage((result?.reason ?? "unknown") as never));
        if (result.outcome === "already_reported") {
          toast.info("You already reported this. Our team is on it.");
          setOpen(false);
          return;
        }
      }
      void track("report_submitted", { target_type: targetType });
      toast.success("Report received. Our moderation team will review it.");
      setOpen(false);
      setCategory("");
      setDetails("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Flag className="size-4" aria-hidden="true" /> Report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this {TARGET_NOUN[targetType]}</DialogTitle>
          <DialogDescription>
            Reports are reviewed by our moderation team. Blocking someone is immediate and separate
            from reporting.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="report-category">Reason</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="report-category">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-details">Details (optional)</Label>
            <Textarea
              id="report-details"
              value={details}
              maxLength={2000}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="What happened?"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Sending…" : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
