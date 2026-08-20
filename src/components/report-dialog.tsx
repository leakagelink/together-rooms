import { useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
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

export function ReportDialog({
  targetType,
  targetUserId,
  targetRoomId,
  targetRef,
  trigger,
}: {
  targetType: "user" | "room" | "message" | "other";
  targetUserId?: string;
  targetRoomId?: string;
  targetRef?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const parsed = reportSchema.safeParse({ category, details });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("forbidden");
      const { error: insertError } = await supabase.from("user_reports").insert({
        reporter_id: auth.user.id,
        target_type: targetType,
        target_user_id: targetUserId ?? null,
        target_room_id: targetRoomId ?? null,
        target_ref: targetRef ?? null,
        category: parsed.data.category,
        details: parsed.data.details || null,
      });
      if (insertError) throw insertError;
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
          <DialogTitle>Report {targetType}</DialogTitle>
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