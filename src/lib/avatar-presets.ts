/** Built-in avatars need no upload and are safe to show to other signed-in users. */
export const AVATAR_PRESET_PREFIX = "preset:";

export const AVATAR_PRESETS = [
  { id: "spark", label: "Spark", className: "avatar-preset-violet" },
  { id: "moon", label: "Moon", className: "avatar-preset-blue" },
  { id: "music", label: "Music", className: "avatar-preset-pink" },
  { id: "heart", label: "Heart", className: "avatar-preset-warm" },
  { id: "rocket", label: "Rocket", className: "avatar-preset-blue" },
  { id: "headphones", label: "Audio", className: "avatar-preset-violet" },
  { id: "flower", label: "Bloom", className: "avatar-preset-warm" },
  { id: "game", label: "Play", className: "avatar-preset-pink" },
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESETS)[number]["id"];

export function avatarPresetRef(id: AvatarPresetId): string {
  return `${AVATAR_PRESET_PREFIX}${id}`;
}

/** Returns a known preset id, rejecting arbitrary or malformed stored values. */
export function avatarPresetId(value: string | null | undefined): AvatarPresetId | null {
  if (!value?.startsWith(AVATAR_PRESET_PREFIX)) return null;
  const id = value.slice(AVATAR_PRESET_PREFIX.length);
  return AVATAR_PRESETS.some((preset) => preset.id === id) ? (id as AvatarPresetId) : null;
}

export function avatarPreset(id: AvatarPresetId) {
  return AVATAR_PRESETS.find((preset) => preset.id === id) ?? AVATAR_PRESETS[0];
}
