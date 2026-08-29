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
      className="mt-3 flex w-full items-center gap-2.5 overflow-x-auto px-0.5 py-1 text-left [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {shown.map((member) => {
        const status: PresenceStatus = presence[member.user_id] ?? "offline";
        return (
          <span key={member.user_id} className="relative shrink-0">
            {member.avatar_url ? (
              <img
                src={member.avatar_url}
                alt=""
                className="size-11 rounded-full object-cover ring-2 ring-primary/45 ring-offset-2 ring-offset-card"
                loading="lazy"
              />
            ) : (
              <span className="grid size-11 place-items-center rounded-full bg-primary/12 text-sm font-black text-primary ring-2 ring-primary/45 ring-offset-2 ring-offset-card">
                {initials(member.display_name)}
              </span>
            )}
            <span
              aria-hidden="true"
              className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card ${DOT[status]}`}
            />
          </span>
        );
      })}
      {overflow > 0 ? (
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-xs font-black text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </button>
  );
}
