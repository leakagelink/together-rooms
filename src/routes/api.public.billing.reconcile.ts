/**
 * PHASE 12 — scheduled billing reconciliation trigger.
 *
 * Publicly routable (a scheduler must reach it), therefore authenticated here
 * with a shared secret compared in constant time. Without the secret
 * configured the endpoint is disabled entirely rather than left open.
 *
 * The work itself is idempotent and monotonic (see reconciliation.server.ts),
 * so an accidental double-trigger is harmless. Responses carry only counters
 * and a correlation id — never account or purchase data.
 */
import { createFileRoute } from "@tanstack/react-router";

import { correlationFromHeaders } from "@/lib/observability/correlation";
import { createLogger } from "@/lib/observability/logger";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/billing/reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["BILLING_RECONCILE_SECRET"];
        if (!expected) return new Response("Not found", { status: 404 });

        const provided = request.headers.get("x-reconcile-secret") ?? "";
        if (!timingSafeEqual(provided, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const correlationId = correlationFromHeaders(request.headers, "recon");
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runBillingReconciliation } = await import("@/lib/billing/reconciliation.server");
          const summary = await runBillingReconciliation(
            supabaseAdmin as unknown as Parameters<typeof runBillingReconciliation>[0],
            { triggerSource: "http" },
          );
          return new Response(JSON.stringify({ ok: true, ...summary }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          const { captureError } = await import("@/lib/observability/monitor");
          captureError("BILLING", "reconciliation_crashed", error, { correlationId });
          return new Response("retry", { status: 503 });
        }
      },
    },
  },
});
