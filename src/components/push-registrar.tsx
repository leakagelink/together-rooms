/**
 * Registers the device for FCM push once a user is signed in.
 * Renders nothing; no-op on web.
 */
import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import { startPushRegistration } from "@/lib/android/push";

export function PushRegistrar() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    void startPushRegistration();
  }, [user]);

  return null;
}
