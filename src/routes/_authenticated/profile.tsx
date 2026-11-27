import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Camera,
  ChevronRight,
  DoorOpen,
  ListMusic,
  LogOut,
  Settings,
  ShieldCheck,
  UserPen,
  type LucideIcon,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { profileSchema } from "@/lib/validation";
import { myProfileQueryOptions } from "@/lib/profile-query";
import {
  AVATAR_BUCKET,
  avatarObjectPath,
  avatarRefFor,
  buildAvatarObjectPath,
  checkAvatarFile,
  prepareAvatarImage,
} from "@/lib/avatar";

const profileQueryOptions = myProfileQueryOptions;

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Your profile — SyncTogether" },
      { name: "description", content: "Manage your SyncTogether profile photo, display name, username and bio." },
      { property: "og:title", content: "Your profile — SyncTogether" },
      { property: "og:description", content: "Manage your SyncTogether profile." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(profileQueryOptions(context.user.id)),
  component: ProfilePage,
  errorComponent: () => (
    <AppShell>
      <ErrorState message="Your profile couldn't be loaded." />
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <ErrorState message="This profile doesn't exist." />
    </AppShell>
  ),
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const profileQuery = useQuery(profileQueryOptions(user.id));
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function setAvatar(nextRef: string | null) {
    const previousPath = avatarObjectPath(profileQuery.data?.avatar_url);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: nextRef })
      .eq("id", user.id);
    if (updateError) throw updateError;
    if (previousPath && previousPath !== avatarObjectPath(nextRef)) {
      // Best effort: the old file is no longer referenced anywhere.
      await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);
    }
    await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
  }

  async function onPhotoPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const check = checkAvatarFile(file);
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    setPhotoBusy(true);
    try {
      const image = await prepareAvatarImage(file);
      const objectPath = buildAvatarObjectPath(user.id);
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(objectPath, image, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;
      try {
        await setAvatar(avatarRefFor(objectPath));
      } catch (err) {
        await supabase.storage.from(AVATAR_BUCKET).remove([objectPath]);
        throw err;
      }
      toast.success("Profile photo updated.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await setAvatar(null);
      toast.success("Profile photo removed.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  }

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
        .eq("id", user.id);
      if (updateError) throw updateError;
      toast.success("Profile saved.");
      await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <h1 className="sr-only">Your profile</h1>
      {profileQuery.isPending ? (
        <LoadingState label="Loading profile" rows={3} />
      ) : profileQuery.isError ? (
        <ErrorState
          message={errorMessage(profileQuery.error)}
          onRetry={() => void profileQuery.refetch()}
        />
      ) : (
        <div className="mx-auto max-w-xl">
          <section className="glass relative overflow-hidden rounded-3xl px-5 pt-6 pb-6 text-center">
            <div aria-hidden="true" className="bg-liquid-hero pointer-events-none absolute inset-x-0 top-0 h-32" />
            <div className="relative flex flex-col items-center">
              <div className="relative">
                <UserAvatar
                  name={profileQuery.data?.display_name || user.email}
                  src={profileQuery.data?.avatar_url}
                  size="xl"
                  className={`ring-4 shadow-[var(--shadow-glow)] ${photoBusy ? "opacity-60" : ""}`}
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoBusy}
                  aria-label={profileQuery.data?.avatar_url ? "Change profile photo" : "Add profile photo"}
                  className="press bg-liquid absolute -right-1 -bottom-1 grid size-10 place-items-center rounded-full text-primary-foreground ring-4 ring-background shadow-[var(--shadow-glow)] disabled:opacity-60"
                >
                  <Camera className="size-5" aria-hidden="true" />
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={onPhotoPicked}
                />
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoBusy}
                  className="text-lavender hover:underline disabled:opacity-60"
                >
                  {photoBusy ? "Uploading…" : profileQuery.data?.avatar_url ? "Change photo" : "Add photo"}
                </button>
                {profileQuery.data?.avatar_url && !photoBusy ? (
                  <button
                    type="button"
                    onClick={() => void removePhoto()}
                    className="text-muted-foreground hover:text-destructive hover:underline"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <p className="mt-3 font-display text-2xl font-bold">
                {profileQuery.data?.display_name || "Add your name"}
              </p>
              {profileQuery.data?.username ? (
                <p className="mt-0.5 text-sm text-muted-foreground">@{profileQuery.data.username}</p>
              ) : null}
              {profileQuery.data?.bio ? (
                <p className="mt-3 max-w-sm text-sm text-muted-foreground">{profileQuery.data.bio}</p>
              ) : null}
            </div>
          </section>

          <nav aria-label="Profile" className="mt-4 space-y-2.5">
            <ProfileRow
              icon={UserPen}
              label="Edit Profile"
              onClick={() => {
                setEditing((value) => !value);
                window.setTimeout(() => document.getElementById("displayName")?.focus(), 50);
              }}
              expanded={editing}
            />
            {editing ? (
            <form onSubmit={save} id="edit-profile" className="glass space-y-5 rounded-3xl p-5 sm:p-6" noValidate>
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
                <Button type="submit" size="lg" disabled={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  SyncTogether is free for everyone.
                </span>

              </div>
            </form>
            ) : null}
            <ProfileRow icon={ListMusic} label="My Playlists" to="/playlists" />
            <ProfileRow icon={DoorOpen} label="My Rooms" to="/rooms" />
            <ProfileRow icon={ShieldCheck} label="Privacy" to="/settings/privacy" />
            <ProfileRow icon={Settings} label="Settings" to="/settings" />
            <ProfileRow
              icon={LogOut}
              label="Sign Out"
              tone="danger"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth/login", replace: true });
              }}
            />
          </nav>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Only what you enter here is shared, and only with the audience you allow in privacy
            settings.
          </p>
        </div>
      )}
    </AppShell>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  to,
  onClick,
  expanded,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  to?: "/playlists" | "/rooms" | "/settings" | "/settings/privacy";
  onClick?: () => void;
  expanded?: boolean;
  tone?: "danger";
}) {
  const className = `press glass flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-[15px] font-semibold hover:bg-glass-strong ${
    tone === "danger" ? "text-destructive" : ""
  }`;
  const content = (
    <>
      <Icon className={`size-5 shrink-0 ${tone === "danger" ? "" : "text-lavender"}`} aria-hidden="true" />
      <span className="flex-1">{label}</span>
      {tone === "danger" ? null : (
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
      )}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-expanded={expanded}>
      {content}
    </button>
  );
}
