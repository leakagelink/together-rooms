import type { RoomMemberEntry } from "@/lib/rooms.functions";
import type { PresenceStatus } from "@/lib/realtime/events";

interface Props {
  members: RoomMemberEntry[];
  presence: Record<string, PresenceStatus>;
  /** Opens the People section when the rail is tapped. */
  onOpenPeople: () => void;
  max?: number;
}

const DOT: Record<PresenceStatus, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-muted-foreground/50",
};

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * Compact avatar strip under the stage — presence at a glance, mirroring the
 * room header count. Presence is advisory; membership stays authoritative.
 */
export function RoomPresenceRail({ members, presence, onOpenPeople, max = 5 }: Props) {
  if (members.length === 0) return null;
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  return (
    <button
      type="button"
      onClick={onOpenPeople}
      aria-label={`${members.length} members in this room. Open the People section.`}
      className="mt-3 flex w-full items-center gap-2 overflow-x-auto rounded-2xl border border-border/60 bg-card/50 px-3 py-2 text-left transition-colors hover:bg-card"
    >
      {shown.map((member) => {
        const status: PresenceStatus = presence[member.user_id] ?? "offline";
        return (
          <span key={member.user_id} className="relative shrink-0">
            {member.avatar_url ? (
              <img
                src={member.avatar_url}
                alt=""
                className="size-10 rounded-full border border-border/70 object-cover"
                loading="lazy"
              />
            ) : (
              <span className="grid size-10 place-items-center rounded-full border border-border/70 bg-muted text-xs font-bold text-muted-foreground">
                {initials(member.display_name)}
              </span>
            )}
            <span
              aria-hidden="true"
              className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background ${DOT[status]}`}
            />
          </span>
        );
      })}
      {overflow > 0 ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </button>
  );
}
