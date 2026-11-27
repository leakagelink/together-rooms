import { BookOpen, Clapperboard, Gamepad2, Heart, Home, Lock, Music2, Search, Users } from "lucide-react";

export const ROOM_TYPE_ICONS = {
  couple: Heart,
  friends: Users,
  family: Home,
  study: BookOpen,
  research: Search,
  music: Music2,
  watch: Clapperboard,
  game: Gamepad2,
  private: Lock,
} as const;

export const ROOM_TYPE_LABELS: Record<string, string> = {
  couple: "Couple",
  friends: "Hangout",
  family: "Family",
  study: "Study",
  research: "Research",
  music: "Music",
  watch: "Watch",
  game: "Games",
  private: "Private",
};

/** Status label + tone for a room card. Only real room statuses are shown. */
export function roomStatusView(status: string): { label: string; tone: "live" | "paused" | "muted" } {
  switch (status) {
    case "active":
      return { label: "Live", tone: "live" };
    case "paused":
      return { label: "Paused", tone: "paused" };
    case "ended":
      return { label: "Ended", tone: "muted" };
    case "draft":
      return { label: "Draft", tone: "muted" };
    default:
      return { label: status, tone: "muted" };
  }
}
