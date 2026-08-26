/**
 * PHASE 13.1 — ADMOB-PROD-T1 … T13
 *
 * These assert the *configuration boundary* and the policy consequences of it.
 * They cannot and do not assert that a real ad was served: that requires a
 * physical device and the AdMob network (see docs/ADMOB_PRODUCTION.md).
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_AD_FREQUENCY,
  isValidAdMobAppId,
  isValidAdUnitId,
  mergeAdFrequency,
  resolveAdUnits,
  REWARDED_ADS_ENABLED,
  TEST_ADMOB_APP_ID,
  TEST_AD_UNITS,
} from "./config";
import {
  PRODUCTION_ADMOB_APP_ID,
  PRODUCTION_AD_UNITS,
  resolveAdMobAppId,
  resolveConfiguredAdUnits,
} from "./admob-production";
import { AdProvider } from "./provider";
import type { AdPlacementContext } from "./placement";
import {
  APPROVED_BANNER_PLACEMENTS,
  APPROVED_INTERSTITIAL_TRANSITIONS,
  FORBIDDEN_AD_SURFACES,
  isApprovedBannerPlacement,
  isApprovedInterstitialTransition,
} from "./placement-map";

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

function productionProvider() {
  const resolution = resolveAdUnits("production", resolveConfiguredAdUnits("production"));
  return new AdProvider({
    units: resolution.units,
    testMode: resolution.testMode,
    config: { ...DEFAULT_AD_FREQUENCY },
  });
}

describe("PHASE 13.1 — AdMob production configuration", () => {
  it("ADMOB-PROD-T1: production App ID is validated, keeps its tilde and is not a test id", () => {
    expect(PRODUCTION_ADMOB_APP_ID).toBe("ca-app-pub-1475323931624357~5237247287");
    expect(PRODUCTION_ADMOB_APP_ID).toContain("~");
    expect(isValidAdMobAppId(PRODUCTION_ADMOB_APP_ID)).toBe(true);
    expect(resolveAdMobAppId("production").appId).toBe(PRODUCTION_ADMOB_APP_ID);
    // Escaped/mangled or test ids fail closed.
    expect(isValidAdMobAppId("ca-app-pub-1475323931624357&#126;5237247287")).toBe(false);
    expect(isValidAdMobAppId("ca-app-pub-1475323931624357/5237247287")).toBe(false);
    expect(resolveAdMobAppId("production", { appId: TEST_ADMOB_APP_ID }).appId).toBeNull();
    expect(resolveAdMobAppId("production", { appId: "nonsense" }).configError).toBeTruthy();
  });

  it("ADMOB-PROD-T2: the production banner unit exists only in the configuration boundary", () => {
    expect(PRODUCTION_AD_UNITS.banner).toBe("ca-app-pub-1475323931624357/9884842805");
    expect(isValidAdUnitId(PRODUCTION_AD_UNITS.banner)).toBe(true);
    const resolved = resolveAdUnits("production", resolveConfiguredAdUnits("production"));
    expect(resolved.units?.banner).toBe(PRODUCTION_AD_UNITS.banner);
  });

  it("ADMOB-PROD-T3: the production interstitial unit exists only in the configuration boundary", () => {
    expect(PRODUCTION_AD_UNITS.interstitial).toBe("ca-app-pub-1475323931624357/3102038535");
    expect(isValidAdUnitId(PRODUCTION_AD_UNITS.interstitial)).toBe(true);
    const resolved = resolveAdUnits("production", resolveConfiguredAdUnits("production"));
    expect(resolved.units?.interstitial).toBe(PRODUCTION_AD_UNITS.interstitial);
    // App-open is deliberately not configured at all.
    expect(resolved.units?.appOpen).toBeNull();
  });

  it("ADMOB-PROD-T4: the rewarded unit is configured but disabled by default", () => {
    expect(PRODUCTION_AD_UNITS.rewarded).toBe("ca-app-pub-1475323931624357/5045675599");
    expect(REWARDED_ADS_ENABLED).toBe(false);
    expect(DEFAULT_AD_FREQUENCY.rewarded_enabled).toBe(false);
    // Remote config cannot switch it on while the build flag is false.
    expect(mergeAdFrequency({ rewarded_enabled: true }).rewarded_enabled).toBe(false);
  });

  it("ADMOB-PROD-T5: a development build cannot silently use production inventory", () => {
    expect(
      resolveConfiguredAdUnits("development", {
        banner: PRODUCTION_AD_UNITS.banner!,
        interstitial: PRODUCTION_AD_UNITS.interstitial!,
      }),
    ).toEqual({});
    const dev = resolveAdUnits("development", PRODUCTION_AD_UNITS);
    expect(dev.testMode).toBe(true);
    expect(dev.units).toEqual(TEST_AD_UNITS);
    expect(dev.units?.banner).not.toBe(PRODUCTION_AD_UNITS.banner);
    expect(resolveAdMobAppId("development").appId).toBe(TEST_ADMOB_APP_ID);
  });

  it("ADMOB-PROD-T6: a production build cannot silently use test inventory", () => {
    const leaked = resolveAdUnits("production", {
      banner: TEST_AD_UNITS.banner,
      interstitial: PRODUCTION_AD_UNITS.interstitial!,
    });
    expect(leaked.units).toBeNull();
    expect(leaked.configError).toContain("test ad unit");
    expect(resolveAdUnits("production", TEST_AD_UNITS).units).toBeNull();
  });

  it("ADMOB-PROD-T7: invalid production configuration disables ad serving", () => {
    for (const bad of [
      {},
      { banner: PRODUCTION_AD_UNITS.banner! },
      { banner: "not-an-id", interstitial: PRODUCTION_AD_UNITS.interstitial! },
      {
        banner: PRODUCTION_AD_UNITS.banner!,
        interstitial: "ca-app-pub-1475323931624357~3102038535",
      },
    ]) {
      const resolution = resolveAdUnits("production", bad);
      expect(resolution.units).toBeNull();
      expect(resolution.configError).toBeTruthy();
      const provider = new AdProvider({
        units: resolution.units,
        testMode: false,
        config: DEFAULT_AD_FREQUENCY,
      });
      const outcome = provider.evaluate(
        { format: "banner", placement: APPROVED_BANNER_PLACEMENTS[0] },
        context({ configured: false }),
      );
      expect(outcome.eligible).toBe(false);
      expect(outcome.unitId).toBeNull();
    }
  });

  it("ADMOB-PROD-T8: Premium entitlement suppresses ad requests against real units", async () => {
    const provider = productionProvider();
    const outcome = provider.evaluate(
      { format: "banner", placement: APPROVED_BANNER_PLACEMENTS[0] },
      context({ premium: true }),
    );
    expect(outcome.eligible).toBe(false);
    expect(outcome.reason).toBe("NO_AD_PREMIUM");
    expect(outcome.unitId).toBeNull();
    await expect(
      provider.request(
        { format: "interstitial", placement: APPROVED_INTERSTITIAL_TRANSITIONS[0] },
        context({ premium: true }),
      ),
    ).resolves.toBe(false);
  });

  it("ADMOB-PROD-T9: unresolved advertising consent suppresses ad serving", () => {
    const provider = productionProvider();
    const unresolved = provider.evaluate(
      { format: "banner", placement: APPROVED_BANNER_PLACEMENTS[0] },
      context({ consent: "unresolved" }),
    );
    expect(unresolved.reason).toBe("NO_AD_CONSENT_UNRESOLVED");
    expect(unresolved.unitId).toBeNull();
    const denied = provider.evaluate(
      { format: "banner", placement: APPROVED_BANNER_PLACEMENTS[0] },
      context({ consent: "denied" }),
    );
    expect(denied.reason).toBe("NO_AD_CONSENT_DENIED");
    // Limited consent still serves, but non-personalized.
    const limited = provider.evaluate(
      { format: "banner", placement: APPROVED_BANNER_PLACEMENTS[0] },
      context({ consent: "granted_limited" }),
    );
    expect(limited.eligible).toBe(true);
    expect(limited.nonPersonalized).toBe(true);
  });

  it("ADMOB-PROD-T10: playback, call and local-media flows suppress ads", () => {
    const provider = productionProvider();
    const cases: [Partial<AdPlacementContext>, string][] = [
      [{ activeCall: true }, "NO_AD_ACTIVE_CALL"],
      [{ activeVideoPlayback: true }, "NO_AD_ACTIVE_VIDEO"],
      [{ activeAudioPlayback: true }, "NO_AD_ACTIVE_AUDIO"],
      [{ activeLocalMedia: true }, "NO_AD_ACTIVE_LOCAL_MEDIA"],
      [{ chatTyping: true }, "NO_AD_CHAT_TYPING"],
      [{ formEntry: true }, "NO_AD_FORM_ENTRY"],
      [{ sensitiveFlow: "payment" }, "NO_AD_PAYMENT_FLOW"],
      [{ sensitiveFlow: "privacy_settings" }, "NO_AD_PRIVACY_SETTINGS"],
    ];
    for (const [patch, reason] of cases) {
      const outcome = provider.evaluate(
        { format: "banner", placement: APPROVED_BANNER_PLACEMENTS[0] },
        context(patch),
      );
      expect(outcome.reason).toBe(reason);
      expect(outcome.unitId).toBeNull();
    }
  });

  it("ADMOB-PROD-T11: an interstitial requires an approved transition", () => {
    const provider = productionProvider();
    expect(isApprovedInterstitialTransition("room_session_ended")).toBe(true);
    for (const surface of ["app_launch", "room_active", "chat", "voice_call", "unknown_screen"]) {
      const outcome = provider.evaluate({ format: "interstitial", placement: surface }, context());
      expect(outcome.eligible).toBe(false);
      expect(outcome.reason).toBe("NO_AD_TRANSITION_NOT_APPROVED");
      expect(outcome.unitId).toBeNull();
    }
  });

  it("ADMOB-PROD-T12: banners cannot appear on interactive or unlisted surfaces", () => {
    const provider = productionProvider();
    for (const surface of FORBIDDEN_AD_SURFACES) {
      expect(isApprovedBannerPlacement(surface)).toBe(false);
      const outcome = provider.evaluate({ format: "banner", placement: surface }, context());
      expect(outcome.eligible).toBe(false);
      expect(outcome.reason).toBe("NO_AD_PLACEMENT_NOT_APPROVED");
      expect(outcome.unitId).toBeNull();
    }
    const allowed = provider.evaluate(
      { format: "banner", placement: "rooms_list_footer" },
      context(),
    );
    expect(allowed.eligible).toBe(true);
    expect(allowed.unitId).toBe(PRODUCTION_AD_UNITS.banner);
  });

  it("ADMOB-PROD-T13: rewarded ads cannot load unless explicitly enabled", async () => {
    const shown: string[] = [];
    const resolution = resolveAdUnits("production", resolveConfiguredAdUnits("production"));
    const provider = new AdProvider({
      units: resolution.units,
      testMode: false,
      // Even if remote config claims rewarded is on, the build flag wins.
      config: { ...DEFAULT_AD_FREQUENCY, rewarded_enabled: true },
      sdk: {
        showFullscreen: async (unitId) => {
          shown.push(unitId);
        },
      },
    });
    const outcome = provider.evaluate(
      { format: "rewarded", placement: "room_session_ended" },
      context(),
    );
    expect(outcome.eligible).toBe(REWARDED_ADS_ENABLED);
    expect(outcome.reason).toBe("NO_AD_REWARDED_DISABLED");
    await expect(
      provider.request({ format: "rewarded", placement: "room_session_ended" }, context()),
    ).resolves.toBe(false);
    expect(shown).toEqual([]);
  });
});
