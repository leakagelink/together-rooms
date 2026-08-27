/**
 * Registers the device for FCM push once a user is signed in and routes
 * notification taps to the same screens the in-app bell opens.
 * Renders nothing; no-op on web.
 */
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useAuth } from "@/hooks/useAuth";
import { setPushNavigator, startPushRegistration } from "@/lib/android/push";

export function PushRegistrar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setPushNavigator((target) => {
      void navigate(target as never);
    });
    return () => setPushNavigator(null);
  }, [navigate]);

  useEffect(() => {
    if (!user) return;
    void startPushRegistration();
  }, [user]);

  return null;
}
