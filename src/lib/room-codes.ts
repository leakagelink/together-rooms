/** Join-code and invite-token helpers. Codes are random, never sequential. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 8-character unguessable room join code (~40 bits of entropy). */
export function generateJoinCode(length = 8) {
  return Array.from(randomBytes(length), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Opaque invite token, shown once to the creator. Only its hash is stored. */
export function generateInviteToken() {
  return Array.from(randomBytes(24), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashInviteToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
