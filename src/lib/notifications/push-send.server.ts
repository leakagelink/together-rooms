/**
 * Server-only FCM HTTP v1 sender.
 *
 * Auth uses a Google service-account JWT exchanged for an access token; the
 * private key lives in the FIREBASE_SERVICE_ACCOUNT secret and never leaves the
 * server. Tokens are read with the service-role client because delivery runs on
 * behalf of the system, not the recipient.
 */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function readServiceAccount(): ServiceAccount {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT"];
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured");
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing required fields");
  }
  return parsed;
}

function base64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
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

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status}`);
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google token exchange returned no access_token");
  return json.access_token;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Sends a push to every registered device of a user. Returns delivery count. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const account = readServiceAccount();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: tokens, error } = await supabaseAdmin
    .from("push_tokens")
    .select("token")
    .eq("user_id", userId);
  if (error) throw error;
  if (!tokens?.length) return 0;

  const accessToken = await getAccessToken(account);
  let delivered = 0;

  for (const row of tokens) {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: row.token,
            notification: { title: payload.title, body: payload.body },
            data: payload.data ?? {},
            android: { priority: "HIGH" },
          },
        }),
      },
    );
    if (response.ok) {
      delivered += 1;
      continue;
    }
    // 404/403 mean the token is dead; prune it so the table stays clean.
    if (response.status === 404 || response.status === 403) {
      await supabaseAdmin.from("push_tokens").delete().eq("token", row.token);
    }
  }

  return delivered;
}
