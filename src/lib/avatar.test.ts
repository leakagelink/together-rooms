import { describe, expect, it } from "vitest";

import {
  avatarObjectPath,
  avatarRefFor,
  buildAvatarObjectPath,
  checkAvatarFile,
  isRenderableAvatarUrl,
} from "./avatar";

const UID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("profile photo rules", () => {
  it("stores photos inside the user's own folder", () => {
    expect(buildAvatarObjectPath(UID, 1700000000000)).toBe(`${UID}/1700000000000.jpg`);
  });

  it("round-trips a stored reference back to its object path", () => {
    const path = buildAvatarObjectPath(UID, 42);
    expect(avatarObjectPath(avatarRefFor(path))).toBe(path);
  });

  it("rejects references that try to escape the user folder", () => {
    expect(avatarObjectPath(`storage:avatars/${UID}/../other.jpg`)).toBeNull();
    expect(avatarObjectPath("storage:avatars/not-a-user/a.jpg")).toBeNull();
    expect(avatarObjectPath("https://example.com/a.jpg")).toBeNull();
  });

  it("accepts JPG, PNG and WebP up to 10 MB", () => {
    expect(checkAvatarFile({ type: "image/png", size: 10 * 1024 * 1024 }).ok).toBe(true);
    expect(checkAvatarFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 }).ok).toBe(false);
    expect(checkAvatarFile({ type: "image/gif", size: 100 }).ok).toBe(false);
  });

  it("only renders https image URLs directly", () => {
    expect(isRenderableAvatarUrl("https://cdn.example.com/a.jpg")).toBe(true);
    expect(isRenderableAvatarUrl("javascript:alert(1)")).toBe(false);
    expect(isRenderableAvatarUrl("http://insecure.example.com/a.jpg")).toBe(false);
  });
});
