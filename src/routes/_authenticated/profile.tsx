import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { profileSchema } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Your profile — SyncTogether" },
      { name: "description", content: "Manage your SyncTogether display name, username and bio." },
      { property: "og:title", content: "Your profile — SyncTogether" },
      { property: "og:description", content: "Manage your SyncTogether profile." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const profileQuery = useQuery({
    enabled: Boolean(user),
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio, status, subscription_tier")
        .eq("id", user!.id)
        .maybeSingle();
      if (queryError) throw queryError;
      return data;
    },
  });

  useEffect(() => {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.display_name ?? "");
      setUsername(profileQuery.data.username ?? "");
      setBio(profileQuery.data.bio ?? "");
    }
  }, [profileQuery.data]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = profileSchema.safeParse({ display_name: displayName, username, bio });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          display_name: parsed.data.display_name,
          username: parsed.data.username ? parsed.data.username : null,
          bio: parsed.data.bio ? parsed.data.bio : null,
        })
        .eq("id", user!.id);
      if (updateError) throw updateError;
      toast.success("Profile saved.");
      await queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Your profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Only what you enter here is shared, and only with the audience you allow in privacy settings.
      </p>

      <div className="mt-8 max-w-xl">
        {profileQuery.isPending ? (
          <LoadingState label="Loading profile" rows={3} />
        ) : profileQuery.isError ? (
          <ErrorState
            message={errorMessage(profileQuery.error)}
            onRetry={() => void profileQuery.refetch()}
          />
        ) : (
          <form onSubmit={save} className="surface-panel space-y-5 p-6" noValidate>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username (optional)</Label>
              <Input
                id="username"
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                aria-describedby="username-hint"
              />
              <p id="username-hint" className="text-xs text-muted-foreground">
                Lowercase letters, numbers and underscores, 3-24 characters.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bio">Bio (optional)</Label>
              <Textarea
                id="bio"
                maxLength={300}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Plan: {profileQuery.data?.subscription_tier ?? "free"}
              </span>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}