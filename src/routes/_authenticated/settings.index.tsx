import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  BadgeAlert,
  Bell,
  ChevronRight,
  Lock,
  Moon,
  Scale,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  Users,
} from "lucide-react";
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
import { applyThemePreference } from "@/lib/ui/theme";

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
  // Liquid Sync is dark by default; only an explicit "Light" choice switches.
  useEffect(() => {
    applyThemePreference(form.theme);
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
      <h1 className="text-[1.75rem] sm:text-3xl">Settings</h1>

      <nav aria-label="Settings sections" className="mt-5 max-w-xl space-y-2.5">
        {SECTION_LINKS.map((item) => {
          const { to, label, description, icon: Icon } = item;
          return (
          <Link
            key={label}
            to={to}
            {...("hash" in item ? { hash: item.hash } : {})}
            className="press glass flex min-h-16 items-center gap-3 rounded-2xl px-4 py-3 hover:bg-glass-strong"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/15 text-lavender">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">{description}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
          );
        })}
      </nav>


      <section id="appearance" aria-labelledby="appearance-heading" className="mt-8 max-w-xl scroll-mt-20">
        <h2 id="appearance-heading" className="mb-3 text-lg">
          Appearance
        </h2>
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
                  <SelectItem value="system">Default (dark glass)</SelectItem>
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
      </section>

      <PlanSummary />

      <LegalLinks />
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
    <div className="glass flex items-start justify-between gap-4 rounded-2xl p-4">
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
    <section className="surface-panel mt-8 max-w-xl rounded-3xl p-5" aria-labelledby="plan-heading">
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

const SECTION_LINKS = [
  { to: "/profile", label: "Account", description: "Name, username and bio", icon: UserIcon },
  {
    to: "/settings/notifications",
    label: "Notifications",
    description: "Alerts, chat and room activity",
    icon: Bell,
  },
  { to: "/settings/privacy", label: "Privacy", description: "Who can invite you, visibility", icon: Lock },
  { to: "/settings", hash: "appearance", label: "Appearance", description: "Theme and motion", icon: Moon },
] as const;

const LEGAL_LINKS = [
  {
    to: "/privacy",
    label: "Privacy Policy",
    description: "What data we collect and how it is used.",
    icon: ShieldCheck,
  },
  {
    to: "/terms",
    label: "Terms of Service",
    description: "The rules for using SyncTogether.",
    icon: Scale,
  },
  {
    to: "/guidelines",
    label: "Community Guidelines",
    description: "What is allowed in rooms and chat.",
    icon: Users,
  },
  {
    to: "/child-safety",
    label: "Child Safety Standards",
    description: "Our CSAE policy and reporting channel.",
    icon: BadgeAlert,
  },
  {
    to: "/delete-account",
    label: "Delete my account",
    description: "Permanently remove your account and data.",
    icon: Trash2,
  },
] as const;

function LegalLinks() {
  return (
    <section id="legal" className="mt-8 max-w-xl scroll-mt-20" aria-labelledby="legal-heading">
      <h2 id="legal-heading" className="text-sm font-semibold">
        Legal &amp; safety
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Policies, community rules and account deletion.
      </p>
      <ul className="surface-panel mt-3 divide-y divide-border overflow-hidden rounded-3xl p-0">
        {LEGAL_LINKS.map(({ to, label, description, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-glass-strong"
            >
              <Icon className="size-4 shrink-0 text-lavender" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{description}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">© {new Date().getFullYear()} SyncTogether</p>
    </section>
  );
}

