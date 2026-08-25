/**
 * PHASE 9 — authoritative Google Play purchase verification (server-only).
 *
 * FAIL-CLOSED: if credentials are absent, the Play API is unreachable, or the
 * response cannot be understood, verification FAILS. No entitlement is ever
 * granted from a client-supplied "purchase succeeded" claim.
 *
 * Credentials come from server secrets and are read inside the function, never
 * at module scope:
 *   GOOGLE_PLAY_PACKAGE_NAME
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON   (service account key JSON)
 */

export type VerificationOutcome =
  { ok: true; result: VerifiedPurchase } | { ok: false; reason: VerificationFailure };

export type VerificationFailure =
  | "verification_unavailable"
  | "verification_failed"
  | "purchase_not_found"
  | "purchase_pending"
  | "product_mismatch"
  | "package_mismatch";

export interface VerifiedPurchase {
  productId: string;
  /** Normalized lifecycle state. */
  state:
    "active" | "cancelled_active" | "grace_period" | "paused" | "expired" | "revoked" | "pending";
  expiresAt: string | null;
  graceUntil: string | null;
  autoRenewing: boolean;
  /** Monotonic ordering key derived from authoritative platform timestamps. */
  eventSeq: number;
  acknowledged: boolean;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);
  return buffer.buffer;
}

export async function getAccessToken(account: ServiceAccount): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    );
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(account.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(`${header}.${claim}`),
    );
    const assertion = `${header}.${claim}.${base64url(signature)}`;

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

/** Maps Play's subscriptionsv2 payload onto our normalized lifecycle. */
export function mapPlaySubscription(
  payload: Record<string, unknown>,
  fallbackProductId: string,
): VerifiedPurchase | null {
  const state =
    typeof payload["subscriptionState"] === "string" ? payload["subscriptionState"] : "";
  const lineItems = Array.isArray(payload["lineItems"])
    ? (payload["lineItems"] as Record<string, unknown>[])
    : [];
  const first = lineItems[0] ?? {};
  const productId =
    (typeof first["productId"] === "string" ? first["productId"] : null) ?? fallbackProductId;
  const expiresAt = typeof first["expiryTime"] === "string" ? first["expiryTime"] : null;
  const autoRenewing = Boolean(
    (first["autoRenewingPlan"] as Record<string, unknown> | undefined)?.["autoRenewEnabled"],
  );
  const acknowledged = payload["acknowledgementState"] === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";

  let normalized: VerifiedPurchase["state"];
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      normalized = autoRenewing ? "active" : "cancelled_active";
      break;
    case "SUBSCRIPTION_STATE_CANCELED":
      normalized = "cancelled_active";
      break;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      normalized = "grace_period";
      break;
    case "SUBSCRIPTION_STATE_PAUSED":
      normalized = "paused";
      break;
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_EXPIRED":
      normalized = "expired";
      break;
    case "SUBSCRIPTION_STATE_PENDING":
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
      normalized = "pending";
      break;
    default:
      return null;
  }

  const seqSource =
    expiresAt ?? (typeof payload["startTime"] === "string" ? payload["startTime"] : null);
  const eventSeq = seqSource ? Math.floor(Date.parse(seqSource) / 1000) : 0;
  if (Number.isNaN(eventSeq)) return null;

  return {
    productId,
    state: normalized,
    expiresAt,
    graceUntil: normalized === "grace_period" ? expiresAt : null,
    autoRenewing,
    eventSeq,
    acknowledged,
  };
}

/** Maps a verified purchase onto the billing event the database understands. */
export function eventTypeFor(result: VerifiedPurchase): string {
  switch (result.state) {
    case "active":
      return "purchase_verified";
    case "cancelled_active":
      return "cancelled";
    case "grace_period":
      return "grace_started";
    case "paused":
      return "paused";
    case "expired":
      return "expired";
    case "revoked":
      return "revoked";
    case "pending":
      return "pending";
  }
}

/**
 * Verifies one purchase token with Google Play. Never throws.
 */
export async function verifyPlayPurchase(
  productId: string,
  purchaseToken: string,
): Promise<VerificationOutcome> {
  // PHASE 11: the claimed product must be one this build is configured for.
  // A claim naming any other product is rejected before a Play call is made.
  const { serverProductConfig, isAllowedProduct } = await import("@/lib/billing/products");
  const productConfig = serverProductConfig(process.env as Record<string, string | undefined>);
  if (!productConfig.ok) return { ok: false, reason: "verification_unavailable" };
  if (!isAllowedProduct(productConfig, productId)) {
    return { ok: false, reason: "product_mismatch" };
  }

  const packageName = process.env["GOOGLE_PLAY_PACKAGE_NAME"];
  const rawAccount = process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"];
  if (!packageName || !rawAccount) {
    // No authoritative source configured → refuse to grant anything.
    return { ok: false, reason: "verification_unavailable" };
  }

  let account: ServiceAccount;
  try {
    account = JSON.parse(rawAccount) as ServiceAccount;
    if (!account.client_email || !account.private_key) throw new Error("incomplete");
  } catch {
    return { ok: false, reason: "verification_unavailable" };
  }

  const token = await getAccessToken(account);
  if (!token) return { ok: false, reason: "verification_unavailable" };

  try {
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/` +
      `${encodeURIComponent(purchaseToken)}`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 404 || response.status === 410) {
      return { ok: false, reason: "purchase_not_found" };
    }
    if (!response.ok) return { ok: false, reason: "verification_failed" };

    const payload = (await response.json()) as Record<string, unknown>;
    const mapped = mapPlaySubscription(payload, productId);
    if (!mapped) return { ok: false, reason: "verification_failed" };
    // Google's own answer decides the product; if it is not a product we sell,
    // no entitlement is derived from it.
    if (!isAllowedProduct(productConfig, mapped.productId)) {
      return { ok: false, reason: "product_mismatch" };
    }
    return { ok: true, result: mapped };
  } catch {
    return { ok: false, reason: "verification_failed" };
  }
}
