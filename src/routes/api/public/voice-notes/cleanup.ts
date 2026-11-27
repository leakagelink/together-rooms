/**
 * Hourly voice-note storage cleanup, called by the database (pg_cron + pg_net)
 * with the shared database-to-worker bearer secret. Removes recordings whose
 * chat message was deleted or expired. Returns counts only, never paths.
 */
import { createFileRoute } from "@tanstack/react-router";

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export const Route = createFileRoute("/api/public/voice-notes/cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["PUSH_DISPATCH_SECRET"];
        if (!expected) return new Response("Not configured", { status: 503 });
        const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        if (provided.length !== expected.length) return unauthorized();
        let mismatch = 0;
        for (let i = 0; i < expected.length; i += 1) {
          mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
        }
        if (mismatch !== 0) return unauthorized();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("orphan_voice_note_paths", { _limit: 500 });
        if (error) return new Response("Lookup failed", { status: 500 });
        const paths = (data ?? []) as string[];
        let removed = 0;
        for (let i = 0; i < paths.length; i += 100) {
          const batch = paths.slice(i, i + 100);
          const { error: removeError } = await supabaseAdmin.storage.from("voice-notes").remove(batch);
          if (!removeError) removed += batch.length;
        }
        return Response.json({ ok: true, removed });
      },
    },
  },
});
