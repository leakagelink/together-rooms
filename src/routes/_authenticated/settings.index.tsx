import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { INCLUDED_FEATURES } from "@/lib/entitlements";
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
        Manage{" "}
        <Link to="/settings/notifications" className="text-primary hover:underline">
          notifications
        </Link>{" "}
        or{" "}
        <Link to="/settings/privacy" className="text-primary hover:underline">
          privacy settings
        </Link>
        .
      </p>

      <PlanSummary />

      <LegalLinks />


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

/**
 * PHASE 15 — SyncTogether is free. There is no plan to display, upgrade or
 * restore, so this section simply states what every account gets.
 */
function PlanSummary() {
  return (
    <section className="surface-panel mt-6 max-w-xl p-5" aria-labelledby="plan-heading">
      <h2 id="plan-heading" className="text-sm font-semibold">
        Your plan
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        SyncTogether is free. There are no subscriptions and no in-app purchases.
      </p>
      <dl className="mt-3 space-y-1.5">
        {INCLUDED_FEATURES.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-4 text-xs">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="shrink-0 font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const LEGAL_LINKS = [
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms of Service" },
  { to: "/guidelines", label: "Community Guidelines" },
  { to: "/child-safety", label: "Child Safety Standards" },
  { to: "/delete-account", label: "Account deletion" },
] as const;

function LegalLinks() {
  return (
    <section className="surface-panel mt-6 max-w-xl p-5" aria-labelledby="legal-heading">
      <h2 id="legal-heading" className="text-sm font-semibold">
        Legal &amp; safety
      </h2>
      <ul className="mt-3 space-y-2 text-sm">
        {LEGAL_LINKS.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="text-primary hover:underline">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

