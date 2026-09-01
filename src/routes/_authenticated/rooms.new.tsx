import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Play } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { useAds } from "@/hooks/useAds";
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
import { Textarea } from "@/components/ui/textarea";
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
  component: NewRoomPage,
});

const TYPE_LABELS: Record<string, string> = {
  couple: "Couple",
  friends: "Friends",
  family: "Family",
  study: "Study",
  research: "Research",
  music: "Listen",
  watch: "Watch",
  game: "Games",
  private: "Private",
};

function NewRoomPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();
  const { requestFullscreen } = useAds();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<(typeof roomTypes)[number]>("friends");
  const [maxMembers, setMaxMembers] = useState("10");
  const [inviteOnly, setInviteOnly] = useState(true);
  const [ephemeral, setEphemeral] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [watchingAd, setWatchingAd] = useState(false);

  async function handleWatchAd() {
    setWatchingAd(true);
    try {
      const shown = await requestFullscreen("create_room_reward");
      if (shown) {
        toast.success("Thank you for watching! This helps keep SyncTogether free.");
      } else {
        toast.info("No ad available right now. You can still create your room!");
      }
    } catch {
      toast.error("Could not load video.");
    } finally {
      setWatchingAd(false);
    }
  }

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
      if (insertError) throw insertError;
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms.mine() });
      void track("room_created", { type: parsed.data.type, ephemeral: parsed.data.is_ephemeral });
      toast.success("Room created.");
      navigate({ to: "/rooms/$roomId", params: { roomId: room.id } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Create a room</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Rooms are private by default. Synchronized playback and voice are not available yet.
      </p>

      <form onSubmit={onSubmit} className="surface-panel mt-8 max-w-xl space-y-5 p-6" noValidate>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="type">Room type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roomTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
        </div>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <Label htmlFor="inviteOnly">Invite only</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Only people with a valid invite or join code can enter.
            </p>
          </div>
          <Switch id="inviteOnly" checked={inviteOnly} onCheckedChange={setInviteOnly} />
        </div>

        <div className="surface-panel flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Support SyncTogether</p>
              <p className="text-xs text-muted-foreground">
                Watch a short video to help keep the service free for everyone.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleWatchAd}
              disabled={watchingAd}
            >
              <Play className="mr-2 size-3.5" />
              {watchingAd ? "Loading..." : "Watch Ad"}
            </Button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
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
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create room"}
        </Button>
      </form>
    </AppShell>
  );
}
