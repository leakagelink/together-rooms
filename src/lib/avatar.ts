/**
 * Profile photos live in the private "avatars" storage bucket. The profile row
 * stores a `storage:avatars/<userId>/<file>` reference (never a public URL), and
 * the app resolves it to a short-lived signed URL for signed-in viewers only.
 */
export const AVATAR_BUCKET = "avatars";
export const AVATAR_REF_PREFIX = `storage:${AVATAR_BUCKET}/`;
/** Largest photo a user can pick before we shrink it on the device. */
export const AVATAR_MAX_PICK_BYTES = 10 * 1024 * 1024;
/** Edge length (px) of the square photo we upload. */
export const AVATAR_SIZE_PX = 512;
export const AVATAR_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isStoredAvatarRef(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(AVATAR_REF_PREFIX);
}

/** Object path inside the bucket for a stored reference, or null. */
export function avatarObjectPath(value: string | null | undefined): string | null {
  if (!isStoredAvatarRef(value)) return null;
  const path = value.slice(AVATAR_REF_PREFIX.length);
  return /^[0-9a-f-]{36}\/[A-Za-z0-9_.-]+$/.test(path) ? path : null;
}

export function buildAvatarObjectPath(userId: string, now: number = Date.now()): string {
  return `${userId}/${now}.jpg`;
}

export function avatarRefFor(objectPath: string): string {
  return `${AVATAR_REF_PREFIX}${objectPath}`;
}

/** Only our own stored photos or https images are ever rendered. */
export function isRenderableAvatarUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

export type AvatarFileCheck = { ok: true } | { ok: false; message: string };

export function checkAvatarFile(file: { type: string; size: number }): AvatarFileCheck {
  if (!(AVATAR_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: "Please pick a JPG, PNG or WebP photo." };
  }
  if (file.size > AVATAR_MAX_PICK_BYTES) {
    return { ok: false, message: "That photo is too large. Pick one under 10 MB." };
  }
  return { ok: true };
}

/** Center-crops and shrinks a picked photo to a square JPEG (browser only). */
export async function prepareAvatarImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const out = Math.min(AVATAR_SIZE_PX, side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your device couldn't process this photo.");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("Your device couldn't process this photo.");
    return blob;
  } finally {
    bitmap.close();
  }
}
