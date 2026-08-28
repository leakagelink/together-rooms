import { describe, expect, it } from "vitest";

import { DEFAULT_AD_FREQUENCY, resolveAdUnits, TEST_AD_UNITS, mergeAdFrequency } from "./config";
import { checkFrequency, newFrequencyState, recordFullscreenShown } from "./frequency";
import { evaluateAdPlacement, type AdPlacementContext } from "./placement";
import { isAdEventSafe, sanitizeAdEvent } from "./analytics-safety";

const BASE: AdPlacementContext = {
  consent: "granted_personalized",
  activeCall: false,
  activeVideoPlayback: false,
  activeAudioPlayback: false,
  activeLocalMedia: false,
  chatTyping: false,
  formEntry: false,
  sensitiveFlow: null,
  criticalNavigation: false,
  configured: true,
};

const CONFIG = { ...DEFAULT_AD_FREQUENCY, app_open_enabled: true };

describe("ad placement policy (ADS-T1..T12)", () => {
  it("T1: PHASE 15 — there is no paid plan, so no placement can be skipped by tier", () => {
    // The app is free for everyone: eligibility depends only on configuration,
    // consent, activity and frequency.
    for (const format of ["banner", "interstitial", "app_open"] as const) {
      const decision = evaluateAdPlacement(format, BASE, CONFIG);
      expect(decision.reason).not.toBe("NO_AD_PREMIUM");
    }
    expect(evaluateAdPlacement("banner", { ...BASE, configured: false }, CONFIG)).toMatchObject({
      eligible: false,
      reason: "NO_AD_NOT_CONFIGURED",
    });
  });

  it("T2: unresolved consent blocks all ads (no request leaves the device)", () => {
    expect(evaluateAdPlacement("banner", { ...BASE, consent: "unresolved" }, CONFIG)).toMatchObject(
      {
        eligible: false,
        reason: "NO_AD_CONSENT_UNRESOLVED",
      },
    );
  });

  it("T3: denied consent blocks all ads", () => {
    expect(evaluateAdPlacement("banner", { ...BASE, consent: "denied" }, CONFIG).reason).toBe(
      "NO_AD_CONSENT_DENIED",
    );
  });

  it("T4: limited consent allows only non-personalized requests", () => {
    const decision = evaluateAdPlacement("banner", { ...BASE, consent: "granted_limited" }, CONFIG);
    expect(decision.eligible).toBe(true);
    expect(decision.nonPersonalized).toBe(true);
  });

  it("T5: active calls block ads", () => {
    expect(evaluateAdPlacement("interstitial", { ...BASE, activeCall: true }, CONFIG).reason).toBe(
      "NO_AD_ACTIVE_CALL",
    );
  });

  it("T6: active video, audio and local media block ads", () => {
    expect(
      evaluateAdPlacement("banner", { ...BASE, activeVideoPlayback: true }, CONFIG).reason,
    ).toBe("NO_AD_ACTIVE_VIDEO");
    expect(
      evaluateAdPlacement("banner", { ...BASE, activeAudioPlayback: true }, CONFIG).reason,
    ).toBe("NO_AD_ACTIVE_AUDIO");
    expect(evaluateAdPlacement("banner", { ...BASE, activeLocalMedia: true }, CONFIG).reason).toBe(
      "NO_AD_ACTIVE_LOCAL_MEDIA",
    );
  });

  it("T7: typing and form entry block ads", () => {
    expect(evaluateAdPlacement("banner", { ...BASE, chatTyping: true }, CONFIG).reason).toBe(
      "NO_AD_CHAT_TYPING",
    );
    expect(evaluateAdPlacement("banner", { ...BASE, formEntry: true }, CONFIG).reason).toBe(
      "NO_AD_FORM_ENTRY",
    );
  });

  it("T8: sensitive flows (deletion, privacy, payment, reporting, auth) block ads", () => {
    const expected = {
      account_deletion: "NO_AD_ACCOUNT_DELETION",
      privacy_settings: "NO_AD_PRIVACY_SETTINGS",
      consent: "NO_AD_PRIVACY_SETTINGS",
      payment: "NO_AD_PAYMENT_FLOW",
      report: "NO_AD_REPORT_FLOW",
      block: "NO_AD_REPORT_FLOW",
      auth: "NO_AD_SENSITIVE_FLOW",
    } as const;
    for (const [flow, reason] of Object.entries(expected)) {
      expect(
        evaluateAdPlacement("banner", { ...BASE, sensitiveFlow: flow as never }, CONFIG).reason,
      ).toBe(reason);
    }
  });

  it("T9: full-screen formats never appear over critical navigation", () => {
    expect(
      evaluateAdPlacement("interstitial", { ...BASE, criticalNavigation: true }, CONFIG).reason,
    ).toBe("NO_AD_CRITICAL_NAVIGATION");
    expect(
      evaluateAdPlacement("banner", { ...BASE, criticalNavigation: true }, CONFIG).eligible,
    ).toBe(true);
  });

  it("T10: a missing ad configuration disables ads instead of falling back", () => {
    expect(evaluateAdPlacement("banner", { ...BASE, configured: false }, CONFIG).reason).toBe(
      "NO_AD_NOT_CONFIGURED",
    );
  });

  it("T11: a remote kill switch disables every format", () => {
    expect(evaluateAdPlacement("banner", BASE, { ...CONFIG, ads_enabled: false }).reason).toBe(
      "NO_AD_DISABLED_REMOTELY",
    );
  });

  it("T12: disabled formats are individually blocked", () => {
    expect(
      evaluateAdPlacement("app_open", BASE, { ...CONFIG, app_open_enabled: false }).reason,
    ).toBe("NO_AD_FORMAT_DISABLED");
  });
});

describe("ad configuration safety (ADS-T13..T15)", () => {
  it("T13: development always uses Google's official test units", () => {
    const resolved = resolveAdUnits("development", { banner: "ca-app-pub-real/1" });
    expect(resolved.units).toEqual(TEST_AD_UNITS);
    expect(resolved.testMode).toBe(true);
  });

  it("T14: production without configured units disables ads (no test-unit fallback)", () => {
    const resolved = resolveAdUnits("production", {});
    expect(resolved.units).toBeNull();
    expect(resolved.configError).toContain("missing production ad unit");
  });

  it("T15: production refuses test units", () => {
    const resolved = resolveAdUnits("production", {
      banner: TEST_AD_UNITS.banner,
      interstitial: "ca-app-pub-real/2",
      appOpen: "ca-app-pub-real/3",
    });
    expect(resolved.units).toBeNull();
    expect(resolved.configError).toContain("test ad unit");
  });

  it("merges remote overrides over conservative defaults and ignores junk", () => {
    const merged = mergeAdFrequency({ max_fullscreen_per_session: 1, ads_enabled: "yes" });
    expect(merged.max_fullscreen_per_session).toBe(1);
    expect(merged.ads_enabled).toBe(DEFAULT_AD_FREQUENCY.ads_enabled);
  });
});

describe("ad frequency caps (ADS-T16..T19)", () => {
  const t0 = 1_000_000;

  it("T16: no full-screen ad during the session warm-up window", () => {
    const state = newFrequencyState(t0);
    expect(checkFrequency("interstitial", state, CONFIG, t0 + 10_000)).toEqual({
      allowed: false,
      reason: "session_warmup",
    });
  });

  it("T17: a minimum interval is enforced between full-screen ads", () => {
    let state = newFrequencyState(t0);
    const shownAt = t0 + 120_000;
    state = recordFullscreenShown("interstitial", state, shownAt);
    expect(checkFrequency("interstitial", state, CONFIG, shownAt + 30_000)).toMatchObject({
      allowed: false,
    });
    expect(checkFrequency("interstitial", state, CONFIG, shownAt + 200_000 + 120_000).allowed).toBe(
      true,
    );
  });

  it("T18: the per-session cap is respected", () => {
    let state = newFrequencyState(t0);
    state = recordFullscreenShown("interstitial", state, t0 + 100_000);
    state = recordFullscreenShown("interstitial", state, t0 + 400_000);
    expect(checkFrequency("interstitial", state, CONFIG, t0 + 900_000)).toEqual({
      allowed: false,
      reason: "session_cap",
    });
  });

  it("T19: app-open ads are never stacked with another full-screen ad", () => {
    let state = newFrequencyState(t0);
    state = recordFullscreenShown("app_open", state, t0 + 100_000);
    expect(checkFrequency("interstitial", state, CONFIG, t0 + 120_000)).toMatchObject({
      allowed: false,
      reason: "app_open_stacking",
    });
  });
});

describe("ad analytics safety (ADS-T20)", () => {
  it("T20: only allow-listed operational fields survive sanitization", () => {
    const payload = sanitizeAdEvent({
      format: "banner",
      placement: "rooms_list_footer",
      eligible: false,
      reason: "NO_AD_PREMIUM",
      room_id: "11111111-1111-1111-1111-111111111111",
      message: "hello there",
      email: "a@b.c",
      purchase_token: "secret",
    });
    expect(payload).toEqual({
      format: "banner",
      placement: "rooms_list_footer",
      eligible: false,
      reason: "NO_AD_PREMIUM",
    });
    expect(isAdEventSafe(payload as Record<string, unknown>)).toBe(true);
  });
});
