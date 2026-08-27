/**
 * Push dispatch endpoint.
 *
 * The database calls this (via pg_net) whenever a notification row is inserted.
 * The caller is authenticated by a shared bearer secret that only the database
 * and this worker hold; the body only carries a notification id, so a leaked
 * body cannot be used to forge notification content.
 */
import { createFileRoute } from "@tanstack/react-router";

import { sendPushToUser } from "@/lib/notifications/push-send.server";

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export const Route = createFileRoute("/api/public/push/dispatch")({
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

        let notificationId: unknown;
        try {
          notificationId = ((await request.json()) as { notification_id?: unknown })
            .notification_id;
        } catch {
          return new Response("Invalid body", { status: 400 });
        }
        if (typeof notificationId !== "string" || notificationId.length === 0) {
          return new Response("Invalid body", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: notification, error } = await supabaseAdmin
          .from("notifications")
          .select("user_id, type, title, body, data")
          .eq("id", notificationId)
          .maybeSingle();
        if (error) return new Response("Lookup failed", { status: 500 });
        if (!notification) return new Response("Not found", { status: 404 });

        try {
          const delivered = await sendPushToUser(notification.user_id, {
            title: notification.title,
            body: notification.body ?? "",
            data: {
              type: notification.type,
              payload: JSON.stringify(notification.data ?? {}),
            },
          });
          return Response.json({ delivered });
        } catch (sendError) {
          console.error("push dispatch failed", sendError);
          return new Response("Send failed", { status: 502 });
        }
      },
    },
  },
});
