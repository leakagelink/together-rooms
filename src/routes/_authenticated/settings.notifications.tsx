/**
 * Notification preferences.
 *
 * These toggles live in `user_settings` and are enforced server-side by the
 * `emit_notification` database function, so muting a category stops both the
 * in-app feed entry and the push — the client never filters after the fact.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  head: () => ({
    meta: [
      { title: "Notification settings — SyncTogether" },
      {
        name: "description",
        content: "Choose which room invites, room activity and chat notifications you receive.",
      },
      { property: "og:title", content: "Notification settings — SyncTogether" },
      {
        property: "og:description",
        content: "Control invites, activity and chat notifications.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotificationSettingsPage,
});

type Form = {
  notify_push: boolean;
  notify_email: boolean;
  notify_room_invites: boolean;
  notify_room_activity: boolean;
  notify_chat: boolean;
};

const DEFAULTS: Form = {
  notify_push: false,
  notify_email: true,
  notify_room_invites: true,
  notify_room_activity: true,
  notify_chat: true,
};

function NotificationSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const settingsQuery = useQuery({
    enabled: Boolean(user),
    queryKey: ["user_settings", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const d = settingsQuery.data;
    if (!d) return;
    setForm({
      notify_push: d.notify_push,
      notify_email: d.notify_email,
      notify_room_invites: d.notify_room_invites,
      notify_room_activity: d.notify_room_activity,
      notify_chat: d.notify_chat ?? true,
    });
  }, [settingsQuery.data]);

  async function save() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("user_settings")
        .update(form)
        .eq("user_id", user!.id);
      if (error) throw error;
      // Turning push on is the user gesture that justifies the OS prompt.
      if (form.notify_push) {
        const { startPushRegistration } = await import("@/lib/android/push");
        void startPushRegistration();
      }
      toast.success("Notification preferences saved.");
      await queryClient.invalidateQueries({ queryKey: ["user_settings", user?.id] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick what you want to hear about. Muted categories are skipped on the server, so they
        never reach your device or the activity feed.{" "}
        <Link to="/settings" className="text-primary hover:underline">
          Back to settings
        </Link>
        .
      </p>

      <div className="mt-8 max-w-xl">
        {settingsQuery.isPending ? (
          <LoadingState label="Loading notification settings" rows={3} />
        ) : settingsQuery.isError ? (
          <ErrorState
            message={errorMessage(settingsQuery.error)}
            onRetry={() => void settingsQuery.refetch()}
          />
        ) : (
          <div className="surface-panel space-y-5 p-6">
            <ToggleRow
              id="notify_room_invites"
              label="Room invites"
              description="When someone invites you to a room, or a member joins or leaves a room you host."
              checked={form.notify_room_invites}
              onChange={(v) => setForm({ ...form, notify_room_invites: v })}
            />
            <ToggleRow
              id="notify_room_activity"
              label="Room activity"
              description="Playback changes, queue updates and study tasks assigned to you."
              checked={form.notify_room_activity}
              onChange={(v) => setForm({ ...form, notify_room_activity: v })}
            />
            <ToggleRow
              id="notify_chat"
              label="Chat messages"
              description="New messages in your rooms, grouped so a busy chat sends one alert."
              checked={form.notify_chat}
              onChange={(v) => setForm({ ...form, notify_chat: v })}
            />

            <div className="border-t border-border pt-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Delivery
              </p>
              <div className="space-y-4">
                <ToggleRow
                  id="notify_push"
                  label="Push notifications"
                  description="Requires notification permission, asked only when you turn this on."
                  checked={form.notify_push}
                  onChange={(v) => setForm({ ...form, notify_push: v })}
                />
                <ToggleRow
                  id="notify_email"
                  label="Email notifications"
                  description="Account and security emails are always sent."
                  checked={form.notify_email}
                  onChange={(v) => setForm({ ...form, notify_email: v })}
                />
              </div>
            </div>

            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save preferences"}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
