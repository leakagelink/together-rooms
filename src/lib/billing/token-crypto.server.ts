/**
 * PHASE 12.1 — recoverable purchase-token envelope (server-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * Google Play's acknowledge endpoint requires the RAW purchase token, and the
 * Play Developer API offers no way to enumerate or look up unacknowledged
 * purchases by anything other than a token we already hold. Storing only a
 * SHA-256 hash therefore made automatic acknowledgement recovery impossible
 * once the request that carried the token ended: the entitlement stayed
 * granted, but Play auto-refunded it after three days.
 *
 * So a *recoverable* copy of the token is kept — encrypted — for the minimum
 * period recovery needs, alongside the hash that keeps idempotency intact.
 *
 * KEY MANAGEMENT — STATED HONESTLY
 * --------------------------------
 * This deployment has NO KMS, HSM or managed key service. The only secure
 * material available is a server-side environment secret
 * (`BILLING_TOKEN_RECOVERY_KEY_V1`), injected into the server runtime and not
 * readable by the browser, by database clients, or by SQL. The key therefore
 * does NOT live beside the ciphertext (which lives in Postgres), which is the
 * property that matters most for a database compromise — but this is
 * "best available for this platform", NOT hardware-backed key management.
 *
 * CRYPTO
 * ------
 * AES-256-GCM (WebCrypto, available in the Worker runtime), a fresh random
 * 96-bit IV per token, authenticated ciphertext, and an explicit key version
 * in the envelope so keys can be rotated without a migration.
 *
 *   envelope := "v1.<keyVersion>.<base64url(iv)>.<base64url(ciphertext||tag)>"
 */

export const RECOVERY_ENVELOPE_VERSION = "v1";
/** Default key version when the deployment does not pin one. */
export const CURRENT_KEY_VERSION = 1;

/**
 * PHASE 13 — rotation without a code change. The deployment pins which key
 * version NEW envelopes are sealed with; decryption always uses the version
 * recorded inside the envelope, so previous versions stay readable as long as
 * their secret remains configured.
 */
export function currentKeyVersion(): number {
  const raw = process.env["BILLING_TOKEN_RECOVERY_KEY_VERSION"];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : CURRENT_KEY_VERSION;
}

/** Retention: Play's auto-refund window is 3 days; keep a small operator margin. */
export const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function envKeyName(version: number): string {
  return `BILLING_TOKEN_RECOVERY_KEY_V${version}`;
}


function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Derives a 256-bit AES key from the environment secret. The secret is an
 * opaque high-entropy string, so it is hashed to a fixed-length key rather
 * than used directly.
 */
async function importKey(version: number): Promise<CryptoKey | null> {
  const secret = process.env[envKeyName(version)];
  if (!secret || secret.length < 16) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function recoveryEncryptionAvailable(): boolean {
  const secret = process.env[envKeyName(currentKeyVersion())];
  return Boolean(secret && secret.length >= 16);
}

export interface RecoveryEnvelope {
  ciphertext: string;
  keyVersion: number;
}

/** Encrypts a raw purchase token. Returns null when no key is configured. */
export async function sealRecoveryToken(rawToken: string): Promise<RecoveryEnvelope | null> {
  const version = currentKeyVersion();
  const key = await importKey(version);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(rawToken),
  );
  return {
    ciphertext: [
      RECOVERY_ENVELOPE_VERSION,
      String(version),
      b64url(iv),
      b64url(new Uint8Array(sealed)),
    ].join("."),
    keyVersion: version,
  };
}

/**
 * Decrypts a recovery envelope. Never throws: malformed input, an unknown key
 * version, or a failed authentication tag all yield null, so a corrupted or
 * tampered row degrades to "cannot recover" instead of undefined behaviour.
 */
export async function openRecoveryToken(
  envelope: string | null | undefined,
): Promise<string | null> {
  if (!envelope || typeof envelope !== "string") return null;
  const parts = envelope.split(".");
  if (parts.length !== 4) return null;
  const [prefix, versionRaw, ivRaw, dataRaw] = parts as [string, string, string, string];
  if (prefix !== RECOVERY_ENVELOPE_VERSION) return null;
  const version = Number.parseInt(versionRaw, 10);
  if (!Number.isInteger(version) || version < 1) return null;

  const iv = unb64url(ivRaw);
  const data = unb64url(dataRaw);
  if (!iv || iv.length !== 12 || !data || data.length === 0) return null;

  const key = await importKey(version);
  if (!key) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      data as unknown as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
