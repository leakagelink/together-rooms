/**
 * FCM push registration (Android/Capacitor only).
 *
 * The browser build is a no-op: the plugin is imported dynamically so the web
 * bundle never pulls native code. The device token is stored server-side
 * through the `register_push_token` RPC, which is scoped to the signed-in user
 * by RLS — the client never decides who a notification belongs to.
 */
import { supabase } from "@/integrations/supabase/client";

let started = false;

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

async function storeToken(token: string): Promise<void> {
  const { error } = await supabase.rpc("register_push_token", {
    _token: token,
    _platform: "android",
  });
  if (error) console.warn("push token registration failed", error.message);
}

export async function startPushRegistration(): Promise<void> {
  if (started || !isNative()) return;
  started = true;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== "granted") {
      started = false;
      return;
    }

    await PushNotifications.removeAllListeners();
    await PushNotifications.addListener("registration", (token) => {
      void storeToken(token.value);
    });
    await PushNotifications.addListener("registrationError", (err) => {
      console.warn("push registration error", err);
    });

    await PushNotifications.register();
  } catch (error) {
    started = false;
    console.warn("push notifications unavailable", error);
  }
}

export function resetPushRegistrationForTests(): void {
  started = false;
}
