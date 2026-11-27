import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { RewardedGate } from "@/components/ads/rewarded-gate";
import { AppShell } from "@/components/app-shell";
import { ROOM_TYPE_ICONS, ROOM_TYPE_LABELS } from "@/components/rooms/room-card-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAdAccess } from "@/hooks/useAdAccess";
import { useAds } from "@/hooks/useAds";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { generateJoinCode } from "@/lib/room-codes";
import { createRoomSchema, roomTypes } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/rooms/new")({
  head: () => ({
    meta: [
      { title: "Create a room — SyncTogether" },
      {
        name: "description",
        content: "Create a private SyncTogether room and invite people to it.",
      },
      { property: "og:title", content: "Create a room — SyncTogether" },
      { property: "og:description", content: "Create a private SyncTogether room." },
      { name: "robots", content: "noindex" },
    ],
  }),
  // Quick-create tiles preselect a room type; anything else is ignored.
  validateSearch: (search: Record<string, unknown>): { type?: (typeof roomTypes)[number] } => {
    const value = search["type"];
    return typeof value === "string" && (roomTypes as readonly string[]).includes(value)
      ? { type: value as (typeof roomTypes)[number] }
      : {};
  },
  component: NewRoomPage,
});

const TYPE_DESCRIPTIONS: Record<string, string> = {
  couple: "Just the two of you",
  friends: "Hang out with friends",
  family: "Family time together",
  study: "Focus timer, notes, tasks",
  research: "Shared resources & notes",
  music: "Listen together",
  watch: "Videos & Shorts in sync",
  game: "Game night",
  private: "Only you and invitees",
};

function NewRoomPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();
  const { state: adAccess, refresh: refreshAdAccess } = useAdAccess();
  const { requestFullscreen } = useAds();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const search = Route.useSearch();
  const [type, setType] = useState<(typeof roomTypes)[number]>(search.type ?? "friends");
  const [maxMembers, setMaxMembers] = useState("10");
  const [inviteOnly, setInviteOnly] = useState(true);
  const [ephemeral, setEphemeral] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = createRoomSchema.safeParse({
      name,
      description,
      type,
      max_members: maxMembers,
      invite_only: inviteOnly,
      is_ephemeral: ephemeral,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (!user) throw new Error("forbidden");
      const { data: room, error: insertError } = await supabase
        .from("rooms")
        .insert({
          owner_id: user.id,
          host_id: user.id,
          name: parsed.data.name,
          description: parsed.data.description || null,
          type: parsed.data.type,
          privacy: parsed.data.invite_only ? "invite_only" : "private",
          invite_only: parsed.data.invite_only,
          is_ephemeral: parsed.data.is_ephemeral,
          max_members: parsed.data.max_members,
          join_code: generateJoinCode(),
          expires_at: parsed.data.is_ephemeral
            ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            : null,
        })
        .select("id")
        .single();
      if (insertError) {
        // Quota is enforced in Postgres, so this is the authoritative answer.
        if (insertError.message.includes("room_quota_exhausted")) {
          refreshAdAccess();
          setError(
            "You have already created a room in the last 24 hours. Watch a short ad below to create another one.",
          );
          return;
        }
        throw insertError;
      }
      // The new room must be present in the rooms list the moment the user
      // navigates back, even if the cached list was restored from storage.
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.mine() });
      void track("room_created", { type: parsed.data.type, ephemeral: parsed.data.is_ephemeral });
      refreshAdAccess();
      toast.success("Room created.");
      // The ad is a transition, never a wait: navigation happens first.
      navigate({ to: "/rooms/$roomId", params: { roomId: room.id } });
      void requestFullscreen("room_created_transition");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl sm:text-[1.75rem]">Create Room</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Rooms are private by default. Everything in SyncTogether is free.
      </p>

      <div className="mt-6 max-w-xl space-y-4">
        {adAccess.unlocked ? (
          <RewardedGate purpose="extra_room" onRewarded={refreshAdAccess} />
        ) : (
          <RewardedGate purpose="unlock" onRewarded={refreshAdAccess} />
        )}
      </div>

      <form onSubmit={onSubmit} className="surface-panel mt-6 max-w-xl space-y-6 rounded-3xl p-5 sm:p-6" noValidate>
        <div className="space-y-2">
          <Label htmlFor="name">Room name</Label>
          <Input
            id="name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Room type</legend>
          <div role="radiogroup" aria-label="Room type" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {roomTypes.map((t) => {
              const Icon = ROOM_TYPE_ICONS[t];
              const selected = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setType(t)}
                  className={`press relative flex min-h-[4.5rem] items-start gap-2.5 rounded-2xl p-3 text-left ${
                    selected ? "glass-selected" : "glass hover:bg-glass-strong"
                  }`}
                >
                  <Icon className={`mt-0.5 size-5 shrink-0 ${selected ? "text-lavender" : "text-muted-foreground"}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{ROOM_TYPE_LABELS[t]}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {TYPE_DESCRIPTIONS[t]}
                    </span>
                  </span>
                  {selected ? (
                    <Check className="absolute top-2 right-2 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="max">Maximum members</Label>
          <Input
            id="max"
            type="number"
            min={2}
            max={50}
            value={maxMembers}
            onChange={(e) => setMaxMembers(e.target.value)}
          />
        </div>
        <div className="glass flex items-start justify-between gap-4 rounded-2xl p-4">
          <div>
            <Label htmlFor="inviteOnly">Invite only</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Only people with a valid invite or join code can enter.
            </p>
          </div>
          <Switch id="inviteOnly" checked={inviteOnly} onCheckedChange={setInviteOnly} />
        </div>
        <div className="glass flex items-start justify-between gap-4 rounded-2xl p-4">
          <div>
            <Label htmlFor="ephemeral">Ephemeral room</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Expires after 24 hours. No media is stored by SyncTogether either way.
            </p>
          </div>
          <Switch id="ephemeral" checked={ephemeral} onCheckedChange={setEphemeral} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Creating…" : "Create Room"}
        </Button>
      </form>
    </AppShell>
  );
}
