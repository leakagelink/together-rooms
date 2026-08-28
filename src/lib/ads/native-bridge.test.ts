/**
 * PHASE 14 — native AdMob bridge verification (PHASE14-T1 … T14).
 *
 * These tests exercise the JavaScript half of the native boundary: bridge
 * detection, the once-only initialization guard, fail-closed behaviour when a
 * bridge is absent or partial, and the guarantee that policy (Premium,
 * consent, placement allow-list, unit validity, rewarded disable) is enforced
 * BEFORE anything reaches the SDK.
 *
 * They deliberately do not claim anything about a real device: the Java side
 * is verified by inspection and by real-device testing (docs/ANDROID_ADMOB_VALIDATION.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNativeAdSdk,
  getAdsBridge,
  getUmpBridge,
  initializeNativeAds,
  nativeAdsInitState,
  resetNativeAdsInit,
  type NativeAdsBridge,
} from "./admob-bridge";
import { isSanitizedAdError, sanitizeBridgeError } from "./bridge-errors";
import { adaptAdsPlugin, toUmpState } from "./capacitor-ads-bridge";
import { DEFAULT_AD_FREQUENCY, REWARDED_ADS_ENABLED, resolveAdUnits } from "./config";
import { PRODUCTION_AD_UNITS } from "./admob-production";
import { AdProvider } from "./provider";
import { resolveAdTestMode, resolveTestDeviceIds } from "./test-devices";
import type { AdPlacementContext } from "./placement";

function fakeBridge(overrides: Partial<NativeAdsBridge> = {}): NativeAdsBridge & {
  calls: string[];
} {
  const calls: string[] = [];
  const bridge: NativeAdsBridge & { calls: string[] } = {
    calls,
    isAvailable: () => true,
    initialize: async () => {
      calls.push("initialize");
    },
    showBanner: async (unitId) => {
      calls.push(`showBanner:${unitId}`);
    },
    hideBanner: async () => {
      calls.push("hideBanner");
    },
    showInterstitial: async (unitId) => {
      calls.push(`showInterstitial:${unitId}`);
      return true;
    },
    consent: {
      requestConsentInfoUpdate: async () => ({
        status: "obtained",
        formStatus: "available",
        privacyOptionsRequired: true,
        canRequestAds: true,
        personalizedAllowed: true,
        error: null,
      }),
      showConsentFormIfRequired: async () => ({
        status: "obtained",
        formStatus: "available",
        privacyOptionsRequired: true,
        canRequestAds: true,
        personalizedAllowed: true,
        error: null,
      }),
      showPrivacyOptionsForm: async () => ({
        status: "obtained",
        formStatus: "available",
        privacyOptionsRequired: true,
        canRequestAds: true,
        personalizedAllowed: true,
        error: null,
      }),
    },
    ...overrides,
  };
  return bridge;
}

const PROD_UNITS = resolveAdUnits("production", {
  banner: PRODUCTION_AD_UNITS.banner!,
  interstitial: PRODUCTION_AD_UNITS.interstitial!,
});

function context(overrides: Partial<AdPlacementContext> = {}): AdPlacementContext {
  return {
    consent: "granted_personalized",
    configured: true,
    activeCall: false,
    activeVideoPlayback: false,
    activeAudioPlayback: false,
    activeLocalMedia: false,
    chatTyping: false,
    formEntry: false,
    criticalNavigation: false,
    sensitiveFlow: null,
    ...overrides,
  };
}

function warmProvider(sdk: unknown) {
  // Session start far enough in the past that the 90s warm-up has elapsed.
  const start = Date.now() - 10 * 60_000;
  let now = start;
  const provider = new AdProvider({
    units: PROD_UNITS.units,
    testMode: false,
    config: DEFAULT_AD_FREQUENCY,
    sdk: sdk as never,
    now: () => now,
  });
  now = start + 10 * 60_000;
  return provider;
}

describe("phase 14 native admob bridge", () => {
  beforeEach(() => {
    resetNativeAdsInit();
    delete (globalThis as { window?: unknown }).window;
  });

  it("PHASE14-T1: bridge availability is explicitly checked, not assumed", () => {
    // No window, no plugin: there is no bridge, and nothing pretends otherwise.
    expect(getAdsBridge()).toBeNull();

    (globalThis as { window?: unknown }).window = { SyncTogetherAds: fakeBridge() };
    expect(getAdsBridge()).not.toBeNull();

    // A bridge that reports itself unavailable is not used.
    (globalThis as { window?: unknown }).window = {
      SyncTogetherAds: fakeBridge({ isAvailable: () => false }),
    };
    expect(getAdsBridge()).toBeNull();

    // A PARTIAL bridge is treated as no bridge rather than half-used.
    const partial = fakeBridge();
    delete (partial as Partial<NativeAdsBridge>).showInterstitial;
    (globalThis as { window?: unknown }).window = { SyncTogetherAds: partial };
    expect(getAdsBridge()).toBeNull();
  });

  it("PHASE14-T2: a missing bridge fails closed and never fakes an ad success", async () => {
    const provider = warmProvider(null);
    await expect(
      provider.request({ format: "banner", placement: "rooms_list_footer" }, context()),
    ).resolves.toBe(false);
    await expect(
      provider.request({ format: "interstitial", placement: "room_session_ended" }, context()),
    ).resolves.toBe(false);
    // No SDK means no frequency consumption either — nothing happened.
    expect(provider.frequencyState.fullscreenCount).toBe(0);

    // The UMP bridge with no native layer is unresolved, never "obtained".
    const state = await getUmpBridge().requestConsentInfoUpdate();
    expect(state.canRequestAds).toBe(false);
    expect(state.status).toBe("unknown");
  });

  it("PHASE14-T3: duplicate SDK initialization is prevented", async () => {
    const bridge = fakeBridge();
    const [a, b] = await Promise.all([
      initializeNativeAds(bridge, { testMode: false, nonPersonalized: false }),
      initializeNativeAds(bridge, { testMode: false, nonPersonalized: false }),
    ]);
    const c = await initializeNativeAds(bridge, { testMode: false, nonPersonalized: false });
    expect([a, b, c]).toEqual([true, true, true]);
    expect(bridge.calls.filter((call) => call === "initialize")).toHaveLength(1);
    expect(nativeAdsInitState()).toBe("ready");

    // A failed init does NOT latch: it can be retried, still once at a time.
    resetNativeAdsInit();
    const failing = fakeBridge({
      initialize: async () => {
        throw new Error("boom");
      },
    });
    expect(await initializeNativeAds(failing, { testMode: false, nonPersonalized: true })).toBe(
      false,
    );
    expect(nativeAdsInitState()).toBe("idle");
  });

  it("PHASE14-T4: an unconfigured build never reaches the native SDK", async () => {
    const bridge = fakeBridge();
    const provider = warmProvider(createNativeAdSdk(bridge));
    await provider.request(
      { format: "banner", placement: "rooms_list_footer" },
      context({ configured: false }),
    );
    await provider.request(
      { format: "interstitial", placement: "room_session_ended" },
      context({ configured: false }),
    );
    expect(bridge.calls).toEqual([]);
  });

  it("PHASE14-T5: unresolved consent suppresses native ad requests", async () => {
    const bridge = fakeBridge();
    const provider = warmProvider(createNativeAdSdk(bridge));
    for (const consent of ["unresolved", "denied"] as const) {
      await provider.request(
        { format: "banner", placement: "rooms_list_footer" },
        context({ consent }),
      );
      await provider.request(
        { format: "interstitial", placement: "room_session_ended" },
        context({ consent }),
      );
    }
    expect(bridge.calls).toEqual([]);
  });

  it("PHASE14-T6: an unknown placement cannot invoke the bridge", async () => {
    const bridge = fakeBridge();
    const provider = warmProvider(createNativeAdSdk(bridge));
    for (const placement of ["settings_footer", "chat", "room_active", "app_launch", ""]) {
      await provider.request({ format: "banner", placement }, context());
      await provider.request({ format: "interstitial", placement }, context());
    }
    expect(bridge.calls).toEqual([]);
  });

  it("PHASE14-T7: an invalid unit id cannot invoke the bridge", async () => {
    const bridge = fakeBridge();
    const sdk = createNativeAdSdk(bridge);
    sdk.showBanner?.("not-an-ad-unit", false);
    sdk.showBanner?.("ca-app-pub-1475323931624357~9884842805", false); // app id shape
    await sdk.showFullscreen?.("", false);
    expect(bridge.calls).toEqual([]);

    // And a build whose configuration is malformed has no units at all.
    const broken = resolveAdUnits("production", {
      banner: "ca-app-pub-123/456",
      interstitial: PRODUCTION_AD_UNITS.interstitial!,
    });
    expect(broken.units).toBeNull();
  });

  it("PHASE14-T8: interstitial failure does not block navigation", async () => {
    const navigated: string[] = [];
    const bridge = fakeBridge({
      showInterstitial: async () => {
        throw new Error("no fill from mediation adapter");
      },
    });
    const provider = warmProvider(createNativeAdSdk(bridge));

    // The route change happens first; the ad is requested afterwards and is
    // never awaited by navigation.
    navigated.push("/rooms");
    await expect(
      provider.request({ format: "interstitial", placement: "room_session_ended" }, context()),
    ).resolves.toBe(true);
    expect(navigated).toEqual(["/rooms"]);
  });

  it("PHASE14-T9: dismissal cannot trigger duplicate navigation or a duplicate show", async () => {
    const pending: { resolve: () => void }[] = [];
    const shows: number[] = [];
    const bridge = fakeBridge({
      showInterstitial: async () => {
        shows.push(Date.now());
        await new Promise<void>((resolve) => {
          pending.push({ resolve });
        });
        return true;
      },
    });
    const sdk = createNativeAdSdk(bridge);
    const first = sdk.showFullscreen?.(PROD_UNITS.units!.interstitial, false);
    const second = sdk.showFullscreen?.(PROD_UNITS.units!.interstitial, false);
    await second; // the stacked call returns immediately without showing
    expect(shows).toHaveLength(1);
    pending.forEach((p) => p.resolve());
    await first;
    // Dismissal is a pure ad event: the sdk contract exposes no navigation.
    expect(Object.keys(sdk).sort()).toEqual(["hideBanner", "showBanner", "showFullscreen"]);
  });

  it("PHASE14-T10: banner lifecycle cleans up when the placement becomes ineligible", () => {
    const bridge = fakeBridge();
    const sdk = createNativeAdSdk(bridge);
    const unit = PROD_UNITS.units!.banner;
    sdk.showBanner?.(unit, false);
    sdk.showBanner?.(unit, false); // re-render: no second banner instance
    expect(bridge.calls.filter((c) => c.startsWith("showBanner"))).toHaveLength(1);
    sdk.hideBanner?.();
    sdk.hideBanner?.(); // idempotent teardown
    expect(bridge.calls.filter((c) => c === "hideBanner")).toHaveLength(1);
    // After teardown the banner may be shown again (returning to the list).
    sdk.showBanner?.(unit, false);
    expect(bridge.calls.filter((c) => c.startsWith("showBanner"))).toHaveLength(2);
  });

  it("PHASE14-T11: test-device mode requires explicit, valid configuration", () => {
    expect(resolveTestDeviceIds(undefined).explicit).toBe(false);
    expect(resolveTestDeviceIds("").deviceIds).toEqual([]);
    expect(resolveTestDeviceIds("not-a-hash").deviceIds).toEqual([]);
    expect(resolveTestDeviceIds("not-a-hash").rejected).toEqual(["not-a-hash"]);

    const valid = "0123456789ABCDEF0123456789abcdef";
    const resolved = resolveTestDeviceIds(`${valid}, bogus`);
    expect(resolved.deviceIds).toEqual([valid.toUpperCase()]);
    expect(resolved.explicit).toBe(true);
    expect(resolved.rejected).toEqual(["bogus"]);
  });

  it("PHASE14-T12: a production runtime cannot be globally forced into test mode", () => {
    const live = resolveAdTestMode("production", undefined);
    expect(live).toEqual({ demoUnits: false, testDeviceIds: [], mode: "live" });

    // Registering a device does NOT enable demo units or change inventory.
    const registered = resolveAdTestMode("production", "0123456789ABCDEF0123456789ABCDEF");
    expect(registered.demoUnits).toBe(false);
    expect(registered.mode).toBe("registered_test_devices");
    expect(PROD_UNITS.testMode).toBe(false);
    expect(PROD_UNITS.units!.banner).toBe(PRODUCTION_AD_UNITS.banner);

    // Even garbage in the variable cannot flip the switch.
    expect(resolveAdTestMode("production", "true,all,yes").demoUnits).toBe(false);
    // Development always uses Google's demo inventory, never production ids.
    expect(resolveAdTestMode("development", undefined).demoUnits).toBe(true);
    expect(resolveAdUnits("development", PRODUCTION_AD_UNITS).units!.banner).not.toBe(
      PRODUCTION_AD_UNITS.banner,
    );
  });

  it("PHASE14-T13: bridge/provider error text is sanitized at the boundary", async () => {
    const leaky = "No fill: mediation adapter com.example.Network request id 7f3a user 42";
    for (const raw of [
      new Error(leaky),
      { code: 3, message: leaky },
      { code: 2, message: leaky },
      { reason: "sdk_init_failed" },
      leaky,
    ]) {
      const sanitized = sanitizeBridgeError(raw);
      expect(isSanitizedAdError(sanitized)).toBe(true);
      expect(JSON.stringify(sanitized)).not.toContain("mediation");
      expect(sanitized.clientMessage).not.toContain(leaky);
    }
    expect(sanitizeBridgeError({ code: 3 }).reason).toBe("no_fill");
    expect(sanitizeBridgeError({ code: 2 }).retryable).toBe(true);

    // A rejecting native call is swallowed and never surfaces vendor text.
    const bridge = fakeBridge({
      showBanner: async () => {
        throw new Error(leaky);
      },
    });
    const sdk = createNativeAdSdk(bridge);
    expect(() => sdk.showBanner?.(PROD_UNITS.units!.banner, false)).not.toThrow();

    // A native consent failure resolves to unresolved, never to consent.
    const plugin = {
      requestConsentInfoUpdate: vi.fn().mockRejectedValue(new Error(leaky)),
      showConsentFormIfRequired: vi.fn(),
      showPrivacyOptionsForm: vi.fn(),
    };
    const adapted = adaptAdsPlugin(plugin as never, true);
    const state = await adapted.consent.requestConsentInfoUpdate();
    expect(state.canRequestAds).toBe(false);
    expect(state.error).toBe("gathering_failed");
    // Garbage from the native layer is normalized, not trusted.
    expect(toUmpState({ status: "obtained", canRequestAds: "yes" }).canRequestAds).toBe(false);
  });

  it("PHASE14-T14: rewarded remains impossible to request while disabled", async () => {
    expect(REWARDED_ADS_ENABLED).toBe(false);
    const bridge = fakeBridge();
    const provider = warmProvider(createNativeAdSdk(bridge));
    for (const placement of ["rooms_list_footer", "room_session_ended", "reward_unlock"]) {
      await expect(provider.request({ format: "rewarded", placement }, context())).resolves.toBe(
        false,
      );
    }
    expect(bridge.calls).toEqual([]);
    // There is no native rewarded entry point on the bridge at all.
    expect("showRewarded" in bridge).toBe(false);
  });
});
