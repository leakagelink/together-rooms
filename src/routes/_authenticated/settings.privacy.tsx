import { createFileRoute } from "@tanstack/react-router";

import { AdPrivacyOptions } from "@/components/ads/AdPrivacyOptions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AccountDataPanel } from "@/components/account-data-panel";
import { ErrorState, LoadingState } from "@/components/state-views";
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
import { Switch } from "@/components/ui/switch";
import { useAdContextFlag } from "@/hooks/useAds";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { setAnalyticsConsent } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/settings/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy settings — SyncTogether" },
      {
        name: "description",
        content: "Control visibility, invites, messaging, consent and retention.",
      },
      { property: "og:title", content: "Privacy settings — SyncTogether" },
      { property: "og:description", content: "Control visibility, consent and data retention." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrivacySettingsPage,
});

const VISIBILITY = [
  { value: "private", label: "Only me" },
  { value: "contacts", label: "People I share a room with" },
  { value: "members", label: "Signed-in members" },
  { value: "public", label: "Anyone" },
];

function PrivacySettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Consent and account-deletion surfaces never carry ads.
  useAdContextFlag({ sensitiveFlow: "privacy_settings" });
  const [form, setForm] = useState({
    profile_visibility: "members",
    room_visibility: "private",
    who_can_invite: "contacts",
    who_can_message: "contacts",
    activity_visibility: "private",
    searchable_by_username: false,
    analytics_consent: false,
    personalization_consent: false,
    ads_consent: false,
    room_data_retention_days: 30,
  });
  const [saving, setSaving] = useState(false);

  const privacyQuery = useQuery({
    enabled: Boolean(user),
    queryKey: ["privacy_settings", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("privacy_settings")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const d = privacyQuery.data;
    if (d) {
      setForm({
        profile_visibility: d.profile_visibility,
        room_visibility: d.room_visibility,
        who_can_invite: d.who_can_invite,
        who_can_message: d.who_can_message,
        activity_visibility: d.activity_visibility,
        searchable_by_username: d.searchable_by_username,
        analytics_consent: d.analytics_consent,
        personalization_consent: d.personalization_consent,
        ads_consent: d.ads_consent,
        room_data_retention_days: d.room_data_retention_days,
      });
      setAnalyticsConsent(d.analytics_consent);
    }
  }, [privacyQuery.data]);

  async function save() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("privacy_settings")
        .update(form as never)
        .eq("user_id", user!.id);
      if (error) throw error;
      setAnalyticsConsent(form.analytics_consent);
      toast.success("Privacy settings saved.");
      await queryClient.invalidateQueries({ queryKey: ["privacy_settings", user?.id] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Privacy settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We collect only what these features need. Nothing here is shared with advertisers — no ads
        SDK is integrated.
      </p>

      <div className="mt-8 max-w-xl space-y-6">
        {privacyQuery.isPending ? (
          <LoadingState label="Loading privacy settings" rows={4} />
        ) : privacyQuery.isError ? (
          <ErrorState
            message={errorMessage(privacyQuery.error)}
            onRetry={() => void privacyQuery.refetch()}
          />
        ) : (
          <>
            <section className="surface-panel space-y-5 p-6">
              <h2 className="text-sm font-semibold">Visibility</h2>
              <VisibilityRow
                id="profile_visibility"
                label="Who can see my profile"
                value={form.profile_visibility}
                onChange={(v) => setForm({ ...form, profile_visibility: v })}
              />
              <VisibilityRow
                id="room_visibility"
                label="Who can see my rooms"
                value={form.room_visibility}
                onChange={(v) => setForm({ ...form, room_visibility: v })}
              />
              <VisibilityRow
                id="who_can_invite"
                label="Who can invite me"
                value={form.who_can_invite}
                onChange={(v) => setForm({ ...form, who_can_invite: v })}
              />
              <VisibilityRow
                id="who_can_message"
                label="Who can message me"
                value={form.who_can_message}
                onChange={(v) => setForm({ ...form, who_can_message: v })}
              />
              <VisibilityRow
                id="activity_visibility"
                label="Who can see my activity"
                value={form.activity_visibility}
                onChange={(v) => setForm({ ...form, activity_visibility: v })}
              />
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
                <div>
                  <Label htmlFor="searchable">Findable by username</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Off by default.</p>
                </div>
                <Switch
                  id="searchable"
                  checked={form.searchable_by_username}
                  onCheckedChange={(v) => setForm({ ...form, searchable_by_username: v })}
                />
              </div>
            </section>

            <section className="surface-panel space-y-5 p-6">
              <h2 className="text-sm font-semibold">Consent</h2>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
                <div>
                  <Label htmlFor="analytics">Product analytics</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Event names only, never message or media content.
                  </p>
                </div>
                <Switch
                  id="analytics"
                  checked={form.analytics_consent}
                  onCheckedChange={(v) => setForm({ ...form, analytics_consent: v })}
                />
              </div>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
                <div>
                  <Label htmlFor="personalization">Personalization</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Not used yet; stored for later.
                  </p>
                </div>
                <Switch
                  id="personalization"
                  checked={form.personalization_consent}
                  onCheckedChange={(v) => setForm({ ...form, personalization_consent: v })}
                />
              </div>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
                <div>
                  <Label htmlFor="ads">Show ads</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Turning this off keeps SyncTogether ad-free for you.
                  </p>

                </div>
                <Switch
                  id="ads"
                  checked={form.ads_consent}
                  onCheckedChange={(v) => setForm({ ...form, ads_consent: v })}
                />
              </div>
              <AdPrivacyOptions />
            </section>

            <section className="surface-panel space-y-4 p-6">
              <h2 className="text-sm font-semibold">Retention</h2>
              <div className="space-y-2">
                <Label htmlFor="retention">Keep room data for (days)</Label>
                <Input
                  id="retention"
                  type="number"
                  min={1}
                  max={365}
                  value={form.room_data_retention_days}
                  onChange={(e) =>
                    setForm({ ...form, room_data_retention_days: Number(e.target.value) })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Preference is stored now; automated purging is scheduled for the next phase.
                </p>
              </div>
            </section>

            <AccountDataPanel />

            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save privacy settings"}
            </Button>
          </>
        )}
      </div>
    </AppShell>
  );
}

function VisibilityRow({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VISIBILITY.map((v) => (
            <SelectItem key={v.value} value={v.value}>
              {v.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
