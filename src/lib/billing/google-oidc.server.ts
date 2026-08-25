/**
 * PHASE 11 — verification of the OIDC token Google Cloud Pub/Sub attaches to a
 * push request (server-only).
 *
 * The RTDN endpoint is publicly reachable, so authentication of the CALLER is
 * the entire security boundary. A push subscription configured with a service
 * account signs every delivery with a Google-issued OIDC token; we verify:
 *
 *   - RS256 signature against Google's published JWKS
 *   - issuer is accounts.google.com
 *   - audience matches the configured audience
 *   - email matches the configured push service account AND is verified
 *   - the token is currently valid (exp/iat with small clock skew)
 *
 * Anything that cannot be fully verified is rejected. There is no shared-secret
 * fallback and no "unauthenticated but plausible" path.
 */

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const CLOCK_SKEW_SECONDS = 60;

export type OidcFailure =
  | "missing_token"
  | "malformed_token"
  | "unknown_key"
  | "bad_signature"
  | "bad_issuer"
  | "bad_audience"
  | "bad_email"
  | "expired"
  | "not_configured"
  | "jwks_unavailable";

export type OidcResult = { ok: true; email: string } | { ok: false; reason: OidcFailure };

interface Jwk {
  kid: string;
  n: string;
  e: string;
  alg?: string;
  kty: string;
}

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;

function b64urlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const json = new TextDecoder().decode(b64urlToBytes(segment));
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function loadJwks(): Promise<Jwk[] | null> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < 3_600_000) return jwksCache.keys;
  try {
    const response = await fetch(JWKS_URL);
    if (!response.ok) return null;
    const json = (await response.json()) as { keys?: Jwk[] };
    if (!Array.isArray(json.keys)) return null;
    jwksCache = { fetchedAt: now, keys: json.keys };
    return json.keys;
  } catch {
    return null;
  }
}

/**
 * Verifies a Pub/Sub push OIDC token. Never throws.
 *
 * `expectedAudience` and `expectedEmail` come from server configuration
 * (`PLAY_RTDN_AUDIENCE`, `PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`). When they are not
 * configured the endpoint refuses every request — it never opens up.
 */
export async function verifyPubSubOidcToken(
  authorizationHeader: string | null,
  expectedAudience: string | undefined,
  expectedEmail: string | undefined,
): Promise<OidcResult> {
  if (!expectedAudience || !expectedEmail) return { ok: false, reason: "not_configured" };
  if (!authorizationHeader) return { ok: false, reason: "missing_token" };

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) return { ok: false, reason: "missing_token" };
  const token = match[1].trim();

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_token" };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeSegment(headerPart);
  const payload = decodeSegment(payloadPart);
  if (!header || !payload) return { ok: false, reason: "malformed_token" };
  if (header["alg"] !== "RS256") return { ok: false, reason: "malformed_token" };

  const kid = typeof header["kid"] === "string" ? header["kid"] : null;
  if (!kid) return { ok: false, reason: "malformed_token" };

  const keys = await loadJwks();
  if (!keys) return { ok: false, reason: "jwks_unavailable" };
  const jwk = keys.find((key) => key.kid === kid);
  if (!jwk) return { ok: false, reason: "unknown_key" };

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(signaturePart) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${headerPart}.${payloadPart}`) as unknown as ArrayBuffer,
    );
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  return validateOidcClaims(payload, expectedAudience, expectedEmail, Date.now());
}

/**
 * Pure claim validation, separated so the rules are directly testable without
 * minting real Google-signed tokens.
 */
export function validateOidcClaims(
  payload: Record<string, unknown>,
  expectedAudience: string,
  expectedEmail: string,
  nowMs: number,
): OidcResult {
  const iss = typeof payload["iss"] === "string" ? payload["iss"] : "";
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
    return { ok: false, reason: "bad_issuer" };
  }
  const aud = typeof payload["aud"] === "string" ? payload["aud"] : "";
  if (aud !== expectedAudience) return { ok: false, reason: "bad_audience" };

  const email = typeof payload["email"] === "string" ? payload["email"] : "";
  const emailVerified = payload["email_verified"];
  if (!email || email !== expectedEmail) return { ok: false, reason: "bad_email" };
  if (emailVerified !== true && emailVerified !== "true") return { ok: false, reason: "bad_email" };

  const now = Math.floor(nowMs / 1000);
  const exp = typeof payload["exp"] === "number" ? payload["exp"] : 0;
  const iat = typeof payload["iat"] === "number" ? payload["iat"] : 0;
  if (!exp || exp + CLOCK_SKEW_SECONDS < now) return { ok: false, reason: "expired" };
  if (iat && iat - CLOCK_SKEW_SECONDS > now) return { ok: false, reason: "expired" };

  return { ok: true, email };
}
