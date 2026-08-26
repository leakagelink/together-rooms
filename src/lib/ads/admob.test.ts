/**
 * PHASE 11 — ADMOB-T1 … T12
 *
 * Ad behaviour is a policy question before it is a technical one. These cover
 * eligibility, consent gating, frequency, Premium suppression and the SDK
 * boundary itself.
 */
import { describe, expect, it, vi } from "vitest";

import { AdProvider } from "./provider";
import { DEFAULT_AD_FREQUENCY, resolveAdUnits } from "./config";
import type { AdPlacementContext } from "./placement";
import { createNativeAdSdk, getAdsBridge, type NativeAdsBridge } from "./admob-bridge";

const context = (patch: Partial<AdPlacementContext> = {}): AdPlacementContext => ({
  premium: false,
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
  ...patch,
});

const units = {
  banner: "ca-app-pub-1/banner",
  interstitial: "ca-app-pub-1/int",
  appOpen: "ca-app-pub-1/open",
};

let clock = 0;

function makeProvider(overrides: Partial<ConstructorParameters<typeof AdProvider>[0]> = {}) {
  clock = 0;
  const shown: { unit: string; npa: boolean }[] = [];
  const sdk = {
    showBanner: (unit: string, npa: boolean) => shown.push({ unit, npa }),
    hideBanner: () => {},
    showFullscreen: async (unit: string, npa: boolean) => void shown.push({ unit, npa }),
  };
  const provider = new AdProvider({
    units,
    testMode: false,
    config: DEFAULT_AD_FREQUENCY,
    sdk,
    now: () => clock,
    ...overrides,
  });
  return { provider, shown };
}

describe("ADMOB", () => {
  it("ADMOB-T1: development builds may only use official Google test units", () => {
    const dev = resolveAdUnits("development", {});
    expect(dev.testMode).toBe(true);
    expect(dev.units?.banner).toContain("ca-app-pub-3940256099942544");
  });

  it("ADMOB-T2: production with no configured units disables ads instead of using test units", () => {
    const prod = resolveAdUnits("production", {});
    expect(prod.units).toBeNull();
    expect(prod.testMode).toBe(false);
  });

  it("ADMOB-T3: Premium accounts are never eligible for any format", () => {
    const { provider } = makeProvider();
    for (const format of ["banner", "interstitial", "app_open"] as const) {
      expect(
        provider.evaluate({ format, placement: "rooms_list_footer" }, context({ premium: true })).eligible,
      ).toBe(false);
    }
  });

  it("ADMOB-T4: unresolved consent blocks every ad request", () => {
    const { provider } = makeProvider();
    const outcome = provider.evaluate(
      { format: "banner", placement: "rooms_list_footer" },
      context({ consent: "unresolved" }),
    );
    expect(outcome.eligible).toBe(false);
  });

  it("ADMOB-T5: limited consent still serves ads, but non-personalized", () => {
    const { provider } = makeProvider();
    const outcome = provider.evaluate(
      { format: "banner", placement: "rooms_list_footer" },
      context({ consent: "granted_limited" }),
    );
    expect(outcome.eligible).toBe(true);
    expect(outcome.nonPersonalized).toBe(true);
  });

  it("ADMOB-T6: denied consent blocks ads entirely", () => {
    const { provider } = makeProvider();
    expect(
      provider.evaluate({ format: "banner", placement: "rooms_list_footer" }, context({ consent: "denied" }))
        .eligible,
    ).toBe(false);
  });

  it("ADMOB-T7: no ad interrupts a call, playback or local media session", () => {
    const { provider } = makeProvider();
    for (const flag of [
      "activeCall",
      "activeVideoPlayback",
      "activeAudioPlayback",
      "activeLocalMedia",
    ] as const) {
      const outcome = provider.evaluate(
        { format: "interstitial", placement: "room_session_ended" },
        context({ [flag]: true } as Partial<AdPlacementContext>),
      );
      expect(outcome.eligible).toBe(false);
    }
  });

  it("ADMOB-T8: sensitive flows are ad-free", () => {
    const { provider } = makeProvider();
    const outcome = provider.evaluate(
      { format: "banner", placement: "rooms_list_footer" },
      context({ sensitiveFlow: "privacy_settings" }),
    );
    expect(outcome.eligible).toBe(false);
  });

  it("ADMOB-T9: full-screen formats respect the frequency cap", async () => {
    const { provider, shown } = makeProvider();
    // The first full-screen ad only becomes eligible after the session warmup.
    expect(await provider.request({ format: "interstitial", placement: "room_session_ended" }, context())).toBe(
      false,
    );
    clock = 10 * 60_000;
    expect(await provider.request({ format: "interstitial", placement: "room_session_ended" }, context())).toBe(
      true,
    );
    // A second one immediately afterwards is refused by the interval cap.
    expect(await provider.request({ format: "interstitial", placement: "room_session_ended" }, context())).toBe(
      false,
    );
    expect(shown).toHaveLength(1);
  });

  it("ADMOB-T10: unconfigured units mean nothing is ever requested", async () => {
    const { provider, shown } = makeProvider({ units: null });
    await provider.request({ format: "banner", placement: "rooms_list_footer" }, context({ configured: false }));
    expect(shown).toHaveLength(0);
  });

  it("ADMOB-T11: no ad SDK exists in the web build", () => {
    expect(getAdsBridge()).toBeNull();
  });

  it("ADMOB-T12: the native banner is never instantiated twice and failures are swallowed", async () => {
    const showBanner = vi.fn().mockRejectedValue(new Error("no fill"));
    const showInterstitial = vi.fn().mockRejectedValue(new Error("no fill"));
    const bridge = {
      isAvailable: () => true,
      initialize: vi.fn(),
      showBanner,
      hideBanner: vi.fn().mockResolvedValue(undefined),
      showInterstitial,
      consent: {} as NativeAdsBridge["consent"],
    } as unknown as NativeAdsBridge;
    const sdk = createNativeAdSdk(bridge);
    sdk.showBanner?.("unit", false);
    sdk.showBanner?.("unit", false);
    expect(showBanner).toHaveBeenCalledTimes(1);
    // A rejected ad load must not throw into the app.
    await expect(sdk.showFullscreen?.("unit", false)).resolves.toBeUndefined();
  });
});
