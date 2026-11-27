import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { clearAnalyticsConsent, setAnalyticsConsent } from "@/lib/analytics";
import { clearPersistedQueryCache } from "@/lib/query-persist";
import { clearLastRoute } from "@/lib/android/last-route";
import {
  clearNativeAuthSession,
  getPersistentSession,
  syncNativeAuthSession,
} from "@/lib/android/auth-session";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // Register the listener BEFORE the initial read so no event is missed.
    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // On Android cold start, INITIAL_SESSION can briefly be null while the
      // durable native copy is being restored. That is not a sign-out.
      if (event === "INITIAL_SESSION" && !nextSession) {
        void syncNativeAuthSession(event, nextSession).catch(() => {});
        return;
      }
      if (active) {
        setSession(nextSession);
        setLoading(false);
      }
      void syncNativeAuthSession(event, nextSession).catch(() => {});
      if (event === "SIGNED_OUT") {
        clearAnalyticsConsent();
        clearPersistedQueryCache();
        clearLastRoute();
      }
    });

    getPersistentSession()
      .then(({ session: restoredSession }) => {
        if (!active) return;
        setSession(restoredSession);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id;

  // Re-sync the persisted consent decision with the authoritative database
  // value once per signed-in session, so a change made on another device wins.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("privacy_settings")
      .select("analytics_consent")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setAnalyticsConsent(data.analytics_consent);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signOut = useCallback(async () => {
    clearAnalyticsConsent();
    clearPersistedQueryCache();
    clearLastRoute();
    // Remove the recovery copy even if the network sign-out request fails, so
    // an explicitly logged-out session can never reappear on the next launch.
    await clearNativeAuthSession().catch(() => {});
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ user: session?.user ?? null, session, loading, signOut }),
    [session, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
