/**
 * PHASE 11 — UMP-T1 … T6
 *
 * Advertising consent gathered through Google's User Messaging Platform. The
 * governing rule everywhere: anything other than an explicit, successfully
 * gathered permission means no ad request.
 */
import { describe, expect, it } from "vitest";

import {
  mayInitializeAds,
  nextUmpAction,
  resolveAdConsent,
  shouldOfferPrivacyOptions,
  umpToAdConsent,
  UNRESOLVED_UMP,
  type UmpState,
} from "./consent";

const state = (patch: Partial<UmpState> = {}): UmpState => ({ ...UNRESOLVED_UMP, ...patch });

const obtained = state({
  status: "obtained",
  formStatus: "available",
  canRequestAds: true,
  personalizedAllowed: true,
  privacyOptionsRequired: true,
});

describe("UMP", () => {
  it("UMP-T1: consent is gathered before any ad request is possible", () => {
    expect(mayInitializeAds(UNRESOLVED_UMP)).toBe(false);
    expect(umpToAdConsent(UNRESOLVED_UMP)).toBe("unresolved");
    expect(mayInitializeAds(obtained)).toBe(true);
  });

  it("UMP-T2: a required consent form is shown when it is available", () => {
    expect(nextUmpAction(state({ status: "required", formStatus: "available" }))).toEqual({
      action: "show_form",
      reason: "consent_required",
    });
    expect(nextUmpAction(obtained).action).toBe("proceed");
    expect(nextUmpAction(state({ status: "not_required" })).action).toBe("proceed");
  });

  it("UMP-T3: a failed consent gather never counts as consent", () => {
    const failed = state({ status: "obtained", canRequestAds: true, error: "network" });
    expect(nextUmpAction(failed)).toEqual({ action: "wait", reason: "gathering_failed" });
    expect(umpToAdConsent(failed)).toBe("unresolved");
    expect(mayInitializeAds(failed)).toBe(false);
  });

  it("UMP-T4: refusing personalization still allows non-personalized ads", () => {
    const limited = state({
      status: "obtained",
      formStatus: "available",
      canRequestAds: true,
      personalizedAllowed: false,
    });
    expect(umpToAdConsent(limited)).toBe("granted_limited");
    const denied = state({ status: "obtained", formStatus: "available", canRequestAds: false });
    expect(umpToAdConsent(denied)).toBe("denied");
  });

  it("UMP-T5: the in-app ads switch can only make the platform decision stricter", () => {
    expect(resolveAdConsent(obtained, false)).toBe("denied");
    expect(resolveAdConsent(obtained, true)).toBe("granted_personalized");
    // The app switch cannot override a platform denial.
    const platformDenied = state({
      status: "obtained",
      formStatus: "available",
      canRequestAds: false,
    });
    expect(resolveAdConsent(platformDenied, true)).toBe("denied");
    // And no app setting rescues an unresolved platform state.
    expect(resolveAdConsent(UNRESOLVED_UMP, true)).toBe("unresolved");
  });

  it("UMP-T6: the privacy options entry point stays reachable when required", () => {
    expect(shouldOfferPrivacyOptions(obtained)).toBe(true);
    expect(shouldOfferPrivacyOptions(state({ privacyOptionsRequired: false }))).toBe(false);
    expect(shouldOfferPrivacyOptions(UNRESOLVED_UMP)).toBe(false);
  });
});
