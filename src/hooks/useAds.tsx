import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/hooks/useAuth";
import { useEntitlement } from "@/hooks/useEntitlement";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeAdEvent } from "@/lib/ads/analytics-safety";
import { DEFAULT_AD_FREQUENCY, mergeAdFrequency, resolveAdUnits } from "@/lib/ads/config";
import type {
  AdFormat,
  AdPlacementContext,
  ConsentState,
  SensitiveFlow,
} from "@/lib/ads/placement";
import { AdProvider, type AdOutcome } from "@/lib/ads/provider";
import { createNativeAdSdk, getAdsBridge, getUmpBridge } from "@/lib/ads/admob-bridge";
import {
  mayInitializeAds,
  nextUmpAction,
  resolveAdConsent,
  shouldOfferPrivacyOptions,
  UNRESOLVED_UMP,
  type UmpState,
} from "@/lib/ads/consent";
import { track } from "@/lib/analytics";
import { getAdRuntimeConfig } from "@/lib/monetization.functions";
import { queryKeys } from "@/lib/query-keys";

/**
 * PHASE 9 — ad runtime.
 *
 * This provider owns the *only* ad decision path in the app. Screens declare
 * context (an active call, a sensitive flow, typing) and ask for a placement;
 * they never touch an SDK, a unit id or the consent state directly.
 */

interface ActivityFlags {
  activeCall: boolean;
  activeVideoPlayback: boolean;
  activeAudioPlayback: boolean;
  activeLocalMedia: boolean;
  chatTyping: boolean;
  formEntry: boolean;
  criticalNavigation: boolean;
  sensitiveFlow: SensitiveFlow | null;
}

const EMPTY_ACTIVITY: ActivityFlags = {
  activeCall: false,
  activeVideoPlayback: false,
  activeAudioPlayback: false,
  activeLocalMedia: false,
  chatTyping: false,
  formEntry: false,
  criticalNavigation: false,
  sensitiveFlow: null,
};

interface AdContextValue {
  /** Evaluate without requesting; used by slots to reserve or skip space. */
  evaluate: (format: AdFormat, placement: string) => AdOutcome;
  requestFullscreen: (placement: string) => Promise<boolean>;
  setActivity: (patch: Partial<ActivityFlags>) => void;
  adsPossible: boolean;
  consent: ConsentState;
  /** Raw platform consent state, for the privacy settings surface. */
  umpState: UmpState;
  /** True when Google requires a always-reachable privacy options entry point. */
  privacyOptionsAvailable: boolean;
  showPrivacyOptions: () => Promise<void>;
}

const AdRuntimeContext = createContext<AdContextValue | null>(null);

function environment(): "development" | "production" {
  return import.meta.env.PROD ? "production" : "development";
}

export function AdRuntimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { premium } = useEntitlement();
  const fetchAdConfig = useServerFn(getAdRuntimeConfig);
  const [activity, setActivityState] = useState<ActivityFlags>(EMPTY_ACTIVITY);
  const [appAdsConsent, setAppAdsConsent] = useState<boolean | null>(null);
  const [ump, setUmp] = useState<UmpState>(UNRESOLVED_UMP);

  // The in-app ads switch. It can only ever make the platform decision
  // stricter — it is never a substitute for the CMP.
  useEffect(() => {
    if (!user) {
      setAppAdsConsent(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from("privacy_settings")
      .select("ads_consent")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setAppAdsConsent(data ? Boolean(data.ads_consent) : null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // UMP consent gathering. Runs once at startup, BEFORE the ads SDK is
  // initialized, so no ad request can leave the device while consent is
  // unresolved. Failures leave consent unresolved (fail-closed).
  useEffect(() => {
    let cancelled = false;
    const bridge = getUmpBridge();
    void (async () => {
      try {
        let next = await bridge.requestConsentInfoUpdate();
        if (nextUmpAction(next).action === "show_form") {
          next = await bridge.showConsentFormIfRequired();
        }
        if (!cancelled) setUmp(next);
      } catch {
        if (!cancelled) setUmp({ ...UNRESOLVED_UMP, error: "gathering_failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const consent: ConsentState = useMemo(
    () => resolveAdConsent(ump, appAdsConsent),
    [ump, appAdsConsent],
  );

  const configQuery = useQuery({
    enabled: Boolean(user) && !premium,
    queryKey: queryKeys.account.adConfig(user?.id),
    staleTime: 300_000,
    queryFn: async () => {
      const result = await fetchAdConfig();
      return result.ok ? mergeAdFrequency(result.config) : DEFAULT_AD_FREQUENCY;
    },
  });

  const config = configQuery.data ?? DEFAULT_AD_FREQUENCY;

  const resolution = useMemo(
    () =>
      resolveAdUnits(environment(), {
        ...(import.meta.env["VITE_ADMOB_BANNER_UNIT"]
          ? { banner: import.meta.env["VITE_ADMOB_BANNER_UNIT"] as string }
          : {}),
        ...(import.meta.env["VITE_ADMOB_INTERSTITIAL_UNIT"]
          ? { interstitial: import.meta.env["VITE_ADMOB_INTERSTITIAL_UNIT"] as string }
          : {}),
        ...(import.meta.env["VITE_ADMOB_APP_OPEN_UNIT"]
          ? { appOpen: import.meta.env["VITE_ADMOB_APP_OPEN_UNIT"] as string }
          : {}),
      }),
    [],
  );

  const providerRef = useRef<AdProvider | null>(null);
  if (!providerRef.current) {
    providerRef.current = new AdProvider({
      units: resolution.units,
      testMode: resolution.testMode,
      config,
      // No SDK is bundled in the web build; the Android shell injects one and
      // it is attached only after consent permits ad requests.
      sdk: null,
      onDecision: (request, outcome) => {
        void track(outcome.eligible ? "ad_requested" : "ad_blocked", {
          ...sanitizeAdEvent({
            format: request.format,
            placement: request.placement,
            eligible: outcome.eligible,
            reason: outcome.reason,
            non_personalized: outcome.nonPersonalized,
            test_mode: outcome.testMode,
          }),
        });
      },
    });
  }
  useEffect(() => {
    providerRef.current?.updateConfig(config);
  }, [config]);

  // Initialize the Mobile Ads SDK only once consent allows an ad request at
  // all, and never for Premium accounts (they see no ads, so no SDK is needed).
  const sdkReady = useRef(false);
  useEffect(() => {
    if (sdkReady.current || premium) return;
    if (!mayInitializeAds(ump)) return;
    const bridge = getAdsBridge();
    if (!bridge) return;
    sdkReady.current = true;
    void bridge
      .initialize({
        testMode: resolution.testMode,
        nonPersonalized: consent !== "granted_personalized",
      })
      .then(() => {
        providerRef.current?.attachSdk(createNativeAdSdk(bridge));
      })
      .catch(() => {
        sdkReady.current = false;
      });
  }, [ump, premium, consent, resolution.testMode]);

  const showPrivacyOptions = useCallback(async () => {
    try {
      setUmp(await getUmpBridge().showPrivacyOptionsForm());
    } catch {
      /* Leaving the form open-failed keeps the previous state; never blocks. */
    }
  }, []);

  const context: AdPlacementContext = useMemo(
    () => ({
      premium,
      consent,
      configured: resolution.units !== null,
      ...activity,
    }),
    [premium, consent, resolution.units, activity],
  );

  const evaluate = useCallback(
    (format: AdFormat, placement: string) =>
      providerRef.current!.evaluate({ format, placement }, context),
    [context],
  );

  const requestFullscreen = useCallback(
    (placement: string) =>
      providerRef.current!.request({ format: "interstitial", placement }, context),
    [context],
  );

  const setActivity = useCallback((patch: Partial<ActivityFlags>) => {
    setActivityState((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<AdContextValue>(
    () => ({
      evaluate,
      requestFullscreen,
      setActivity,
      adsPossible: !premium && resolution.units !== null,
      consent,
      umpState: ump,
      privacyOptionsAvailable: shouldOfferPrivacyOptions(ump),
      showPrivacyOptions,
    }),
    [
      evaluate,
      requestFullscreen,
      setActivity,
      premium,
      resolution.units,
      consent,
      ump,
      showPrivacyOptions,
    ],
  );

  return <AdRuntimeContext.Provider value={value}>{children}</AdRuntimeContext.Provider>;
}

export function useAds(): AdContextValue {
  const ctx = useContext(AdRuntimeContext);
  if (ctx) return ctx;
  // Safe fallback outside the provider: nothing is ever eligible.
  return {
    evaluate: () => ({
      eligible: false,
      reason: "NO_AD_NOT_CONFIGURED",
      nonPersonalized: false,
      unitId: null,
      testMode: false,
    }),
    requestFullscreen: async () => false,
    setActivity: () => {},
    adsPossible: false,
    consent: "unresolved",
    umpState: UNRESOLVED_UMP,
    privacyOptionsAvailable: false,
    showPrivacyOptions: async () => {},
  };
}

/**
 * Declares a temporary context flag (an active call, a sensitive screen) for
 * as long as the component is mounted.
 */
export function useAdContextFlag(patch: Partial<ActivityFlags>) {
  const { setActivity } = useAds();
  const serialized = JSON.stringify(patch);
  useEffect(() => {
    const value = JSON.parse(serialized) as Partial<ActivityFlags>;
    setActivity(value);
    return () => {
      const cleared = Object.fromEntries(
        Object.keys(value).map((key) => [key, key === "sensitiveFlow" ? null : false]),
      ) as Partial<ActivityFlags>;
      setActivity(cleared);
    };
  }, [serialized, setActivity]);
}
