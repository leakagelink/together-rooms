/**
 * PHASE 11 — Google Play Real-time Developer Notifications (Pub/Sub push).
 *
 * This endpoint is publicly reachable by design (Pub/Sub calls it from
 * Google's infrastructure), so the entire security boundary lives here:
 *
 *  - the caller must present a Google-signed OIDC token whose audience and
 *    service-account email match our configuration; anything else is 401,
 *  - the notification body is untrusted and never grants anything by itself,
 *  - processing is exactly-once by Pub/Sub message id,
 *  - responses are opaque: no entitlement, account or user data is returned.
 *
 * Response contract for Pub/Sub: 2xx acknowledges the message (stop
 * redelivery), 5xx asks for redelivery. A message we cannot ever process
 * (malformed, wrong package, unknown token) is acknowledged, because retrying
 * it forever would only build a backlog.
 */
import { createFileRoute } from "@tanstack/react-router";

import { decodeRtdnEnvelope } from "@/lib/billing/rtdn";
import { verifyPubSubOidcToken } from "@/lib/billing/google-oidc.server";
import { EXPECTED_PACKAGE_NAME } from "@/lib/billing/products";
import { correlationFromHeaders } from "@/lib/observability/correlation";
import { createLogger } from "@/lib/observability/logger";
import { classifyReason } from "@/lib/observability/errors";

const ACK = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/billing/rtdn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await verifyPubSubOidcToken(
          request.headers.get("authorization"),
          process.env["PLAY_RTDN_AUDIENCE"],
          process.env["PLAY_RTDN_SERVICE_ACCOUNT_EMAIL"],
        );
        if (!auth.ok) {
          // Never explain why; an attacker learns nothing from a probe.
          console.warn("[rtdn] rejected delivery:", auth.reason);
          const status = auth.reason === "jwks_unavailable" ? 503 : 401;
          return new Response("Unauthorized", { status });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return ACK({ ok: false, reason: "malformed" });
        }

        const packageName = process.env["GOOGLE_PLAY_PACKAGE_NAME"] ?? EXPECTED_PACKAGE_NAME;
        const decoded = decodeRtdnEnvelope(body, packageName);
        if (!decoded.ok) {
          console.warn("[rtdn] undecodable message:", decoded.reason);
          // Permanently undecodable: acknowledge so Pub/Sub stops retrying.
          return ACK({ ok: false, reason: decoded.reason });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { processRtdnMessage } = await import("@/lib/billing/rtdn.server");
          const result = await processRtdnMessage(
            supabaseAdmin as unknown as Parameters<typeof processRtdnMessage>[0],
            decoded.message,
          );
          if (result.outcome === "error") {
            // Transient: ask Pub/Sub to redeliver.
            return new Response("retry", { status: 503 });
          }
          return ACK({ ok: true, outcome: result.outcome });
        } catch (error) {
          console.error("[rtdn] processing failed:", (error as Error).message);
          return new Response("retry", { status: 503 });
        }
      },
    },
  },
});
