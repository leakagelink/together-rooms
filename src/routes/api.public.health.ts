/**
 * PHASE 12 — health and readiness endpoint.
 *
 * Two distinct questions, deliberately separated:
 *
 *   LIVENESS  (`?probe=live`, default)  — is the worker running at all?
 *     Never touches a dependency, so a slow database cannot cause a restart
 *     loop. Always 200 while the process can serve requests.
 *
 *   READINESS (`?probe=ready`)          — can it serve real traffic?
 *     Performs one cheap, non-sensitive database round-trip and reports which
 *     required configuration groups are present. 503 when not ready.
 *
 * The response is deliberately information-poor: booleans and a duration. No
 * versions, hostnames, connection strings, key material, counts of users, or
 * error text — an unauthenticated caller learns nothing exploitable.
 */
import { createFileRoute } from "@tanstack/react-router";

import { correlationFromHeaders } from "@/lib/observability/correlation";
import { createLogger } from "@/lib/observability/logger";

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function checkDatabase(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // plan_limits is tiny, static configuration — no user data is touched.
    const { error } = await supabaseAdmin.from("plan_limits").select("plan_key").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const probe = url.searchParams.get("probe") === "ready" ? "ready" : "live";

        if (probe === "live") {
          return json({ status: "ok", probe: "live" }, 200);
        }

        const correlationId = correlationFromHeaders(request.headers, "health");
        const started = Date.now();
        const database = await checkDatabase();
        const durationMs = Date.now() - started;

        // Presence only — never the values.
        const config = {
          supabase: Boolean(process.env["SUPABASE_URL"]),
          billing: Boolean(
            process.env["GOOGLE_PLAY_PACKAGE_NAME"] &&
            process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"],
          ),
          rtdn: Boolean(
            process.env["PLAY_RTDN_AUDIENCE"] && process.env["PLAY_RTDN_SERVICE_ACCOUNT_EMAIL"],
          ),
        };

        const ready = database && config.supabase;
        if (!ready) {
          createLogger("SYSTEM", correlationId).error("readiness_failed", {
            outcome: "failed",
            data: { database, duration_ms: durationMs },
          });
        }

        return json(
          { status: ready ? "ok" : "degraded", probe: "ready", database, config, durationMs },
          ready ? 200 : 503,
        );
      },
    },
  },
});
