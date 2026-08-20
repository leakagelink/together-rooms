import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({
    meta: [
      { title: "Settings — SyncTogether" },
      { name: "description", content: "Appearance, language and notification settings." },
      { property: "og:title", content: "Settings — SyncTogether" },
      { property: "og:description", content: "Appearance, language and notification settings." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    theme: "system",
    notify_email: true,
    notify_push: false,
    notify_room_invites: true,
    notify_room_activity: true,
    reduced_motion: false,
  });
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
    if (d) {
      setForm({
        theme: d.theme,
        notify_email: d.notify_email,
        notify_push: d.notify_push,
        notify_room_invites: d.notify_room_invites,
        notify_room_activity: d.notify_room_activity,
        reduced_motion: d.reduced_motion,
      });
    }
  }, [settingsQuery.data]);

  // Theme architecture: the stored preference drives the `dark` class.
  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = form.theme === "dark" || (form.theme === "system" && prefersDark);
    root.classList.toggle("dark", dark);
  }, [form.theme]);

  async function save() {
    setSaving(true);
    try {
      const { error } = await supabase.from("user_settings").update(form).eq("user_id", user!.id);
      if (error) throw error;
      toast.success("Settings saved.");
      await queryClient.invalidateQueries({ queryKey: ["user_settings", user?.id] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Looking for visibility and consent controls?{" "}
        <Link to="/settings/privacy" className="text-primary hover:underline">
          Privacy settings
        </Link>
        .
      </p>

      <div className="mt-8 max-w-xl">
        {settingsQuery.isPending ? (
          <LoadingState label="Loading settings" rows={3} />
        ) : settingsQuery.isError ? (
          <ErrorState
            message={errorMessage(settingsQuery.error)}
            onRetry={() => void settingsQuery.refetch()}
          />
        ) : (
          <div className="surface-panel space-y-5 p-6">
            <div className="space-y-2">
              <Label htmlFor="theme">Theme</Label>
              <Select value={form.theme} onValueChange={(v) => setForm({ ...form, theme: v })}>
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">Match my device</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ToggleRow
              id="notify_email"
              label="Email notifications"
              description="Account and security emails are always sent."
              checked={form.notify_email}
              onChange={(v) => setForm({ ...form, notify_email: v })}
            />
            <ToggleRow
              id="notify_push"
              label="Push notifications"
              description="Requires notification permission, asked only when you turn this on."
              checked={form.notify_push}
              onChange={(v) => setForm({ ...form, notify_push: v })}
            />
            <ToggleRow
              id="notify_room_invites"
              label="Room invites"
              checked={form.notify_room_invites}
              onChange={(v) => setForm({ ...form, notify_room_invites: v })}
            />
            <ToggleRow
              id="notify_room_activity"
              label="Room activity"
              checked={form.notify_room_activity}
              onChange={(v) => setForm({ ...form, notify_room_activity: v })}
            />
            <ToggleRow
              id="reduced_motion"
              label="Reduce motion"
              checked={form.reduced_motion}
              onChange={(v) => setForm({ ...form, reduced_motion: v })}
            />
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
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