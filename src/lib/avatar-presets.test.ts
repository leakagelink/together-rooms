import { describe, expect, it } from "vitest";

import {
  AVATAR_PRESETS,
  avatarPresetId,
  avatarPresetRef,
  type AvatarPresetId,
} from "./avatar-presets";

describe("built-in profile avatars", () => {
  it("offers unique choices that all round-trip through the profile reference", () => {
    expect(AVATAR_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(AVATAR_PRESETS.map((preset) => preset.id)).size).toBe(AVATAR_PRESETS.length);
    for (const preset of AVATAR_PRESETS) {
      expect(avatarPresetId(avatarPresetRef(preset.id))).toBe(preset.id);
    }
  });

  it("rejects unknown presets and values that are not preset references", () => {
    expect(avatarPresetId("preset:unknown")).toBeNull();
    expect(avatarPresetId("preset:spark/extra")).toBeNull();
    expect(avatarPresetId("https://example.com/avatar.png")).toBeNull();
    expect(avatarPresetId(null)).toBeNull();
  });

  it("keeps preset references compact and unambiguous", () => {
    const id: AvatarPresetId = "spark";
    expect(avatarPresetRef(id)).toBe("preset:spark");
  });
});
