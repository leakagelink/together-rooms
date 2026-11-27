import {
  Flower2,
  Gamepad2,
  Headphones,
  Heart,
  Moon,
  Music,
  Rocket,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { avatarPreset, type AvatarPresetId } from "@/lib/avatar-presets";

const PRESET_ICONS: Record<AvatarPresetId, LucideIcon> = {
  spark: Sparkles,
  moon: Moon,
  music: Music,
  heart: Heart,
  rocket: Rocket,
  headphones: Headphones,
  flower: Flower2,
  game: Gamepad2,
};

/** A ready-made profile avatar; no network request or uploaded photo is needed. */
export function PresetAvatar({
  id,
  className = "",
}: {
  id: AvatarPresetId;
  className?: string;
}) {
  const preset = avatarPreset(id);
  const Icon = PRESET_ICONS[id];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-primary-foreground ${preset.className} ${className}`}
    >
      <Icon className="size-[48%]" strokeWidth={2.1} />
    </span>
  );
}
