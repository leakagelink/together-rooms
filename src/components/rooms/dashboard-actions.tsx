import { Link } from "@tanstack/react-router";
import { BookOpen, Clapperboard, Music2, Users, UserPlus, Video, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Room types offered as quick-create shortcuts. All are real room types. */
export const QUICK_ROOM_TYPES = [
  { type: "watch", label: "Watch", icon: Clapperboard },
  { type: "music", label: "Music", icon: Music2 },
  { type: "study", label: "Study", icon: BookOpen },
  { type: "friends", label: "Hangout", icon: Users },
] as const;

export type QuickRoomType = (typeof QUICK_ROOM_TYPES)[number]["type"];

type Target = { kind: "create"; type?: QuickRoomType } | { kind: "join" };

/**
 * Liquid Sync home actions: Create Room / Join Room cards and quick room-type
 * tiles. Signed-in users get real links; signed-out visitors get `onGuest`,
 * which sends them to sign in first.
 */
export function DashboardActions({ onGuest }: { onGuest?: (target: Target) => void }) {
  function Action({
    target,
    className,
    label,
    children,
  }: {
    target: Target;
    className: string;
    label: string;
    children: ReactNode;
  }) {
    if (onGuest) {
      return (
        <button type="button" aria-label={label} className={className} onClick={() => onGuest(target)}>
          {children}
        </button>
      );
    }
    if (target.kind === "join") {
      return (
        <Link to="/rooms/join" aria-label={label} className={className}>
          {children}
        </Link>
      );
    }
    return (
      <Link
        to="/rooms/new"
        search={target.type ? { type: target.type } : {}}
        aria-label={label}
        className={className}
      >
        {children}
      </Link>
    );
  }

  const bigCard =
    "press group relative flex min-h-36 flex-col items-center justify-center gap-2 overflow-hidden rounded-3xl p-4 text-center focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Action target={{ kind: "create" }} label="Create room" className={`${bigCard} glass-selected`}>
          <CardIcon icon={Video} highlighted />
          <span className="font-display text-base font-bold">Create Room</span>
          <span className="text-xs leading-snug text-muted-foreground">
            Start a watch, music or study room
          </span>
        </Action>
        <Action target={{ kind: "join" }} label="Join room" className={`${bigCard} glass hover:bg-glass-strong`}>
          <CardIcon icon={UserPlus} />
          <span className="font-display text-base font-bold">Join Room</span>
          <span className="text-xs leading-snug text-muted-foreground">
            Enter a room code or invitation link
          </span>
        </Action>
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {QUICK_ROOM_TYPES.map(({ type, label, icon: Icon }) => (
          <Action
            key={type}
            target={{ kind: "create", type }}
            label={`Create a ${label} room`}
            className="press glass flex min-h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-glass-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon className="size-5 text-lavender" aria-hidden="true" />
            {label}
          </Action>
        ))}
      </div>
    </div>
  );
}

function CardIcon({ icon: Icon, highlighted = false }: { icon: LucideIcon; highlighted?: boolean }) {
  return (
    <span
      className={`flex size-12 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105 ${
        highlighted ? "bg-liquid text-primary-foreground" : "border border-glass-border bg-glass-strong text-lavender"
      }`}
    >
      <Icon className="size-6" aria-hidden="true" />
    </span>
  );
}

export function DashboardGreeting({ name }: { name: string | null }) {
  return (
    <div>
      <h1 className="text-[1.75rem] leading-tight sm:text-3xl">
        Hey{name ? `, ${name}` : " there"} <span aria-hidden="true">👋</span>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">What are we watching together?</p>
    </div>
  );
}
