/** Join-code and invite-token helpers. Codes are random, never sequential. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 8-character unguessable room join code (~40 bits of entropy).
 *
 * Uses rejection sampling: 256 is not a multiple of the 31-character alphabet,
 * so `b % 31` would bias the first 8 symbols. Bytes >= 248 are discarded.
 */
export function generateJoinCode(length = 8) {
  const limit = 256 - (256 % ALPHABET.length);
  const out: string[] = [];
  while (out.length < length) {
    for (const b of randomBytes(length)) {
      if (b >= limit) continue;
      out.push(ALPHABET[b % ALPHABET.length]!);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/** Opaque invite token, shown once to the creator. Only its hash is stored. */
export function generateInviteToken() {
  return Array.from(randomBytes(24), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashInviteToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
