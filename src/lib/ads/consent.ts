/**
 * PHASE 11 — Google User Messaging Platform (UMP) consent state machine.
 *
 * Advertising consent is NOT analytics consent. SyncTogether keeps two
 * independent decisions:
 *
 *   analytics_consent   — our own product analytics (privacy_settings)
 *   UMP consent         — whether an ad request may be made at all, and
 *                         whether it may be personalized
 *
 * A user may allow analytics and refuse ads, or the reverse. Neither is ever
 * derived from the other. This module is pure: the native SDK reports raw UMP
 * values and this maps them onto the ad-eligibility consent state the
 * placement policy understands.
 */
import type { ConsentState } from "./placement";

/** Raw UMP ConsentInformation.ConsentStatus values. */
export type UmpConsentStatus = "unknown" | "required" | "not_required" | "obtained";

/** Raw UMP form availability. */
export type UmpFormStatus = "unknown" | "available" | "unavailable";

export interface UmpState {
  status: UmpConsentStatus;
  formStatus: UmpFormStatus;
  /** True when UMP says a privacy options entry point must be offered. */
  privacyOptionsRequired: boolean;
  /**
   * Whether the resolved consent permits personalized ads. Supplied by the
   * native layer from `canRequestAds` + the TCF/consent signals.
   */
  canRequestAds: boolean;
  personalizedAllowed: boolean;
  /** Set when the consent gathering itself failed. */
  error?: string | null;
}

export const UNRESOLVED_UMP: UmpState = {
  status: "unknown",
  formStatus: "unknown",
  privacyOptionsRequired: false,
  canRequestAds: false,
  personalizedAllowed: false,
  error: null,
};

export type UmpAction =
  | { action: "show_form"; reason: "consent_required" }
  | { action: "wait"; reason: "consent_unknown" | "gathering_failed" }
  | { action: "proceed"; reason: "consent_obtained" | "consent_not_required" };

/**
 * Decides what the app must do at launch after `requestConsentInfoUpdate`.
 * Failure is never treated as consent: it resolves to "wait", which keeps ads
 * ineligible.
 */
export function nextUmpAction(state: UmpState): UmpAction {
  if (state.error) return { action: "wait", reason: "gathering_failed" };
  switch (state.status) {
    case "required":
      return state.formStatus === "available"
        ? { action: "show_form", reason: "consent_required" }
        : { action: "wait", reason: "consent_unknown" };
    case "obtained":
      return { action: "proceed", reason: "consent_obtained" };
    case "not_required":
      return { action: "proceed", reason: "consent_not_required" };
    default:
      return { action: "wait", reason: "consent_unknown" };
  }
}

/**
 * Maps UMP onto the tri-state consent the ad placement policy consumes.
 * "unresolved" is deliberately distinct from "denied": neither allows an ad,
 * but only the latter is a user decision.
 */
export function umpToAdConsent(state: UmpState): ConsentState {
  if (state.error) return "unresolved";
  if (state.status === "unknown") return "unresolved";
  if (state.status === "required" && !state.canRequestAds) return "unresolved";
  if (!state.canRequestAds) return "denied";
  return state.personalizedAllowed ? "granted_personalized" : "granted_limited";
}

/**
 * Combines the platform CMP decision with the user's own in-app ads switch.
 * The stricter of the two always wins: turning ads off in SyncTogether denies
 * ads even if UMP consent was obtained, and UMP denial cannot be overridden by
 * an app setting.
 */
export function resolveAdConsent(ump: UmpState, appAdsConsent: boolean | null): ConsentState {
  const platform = umpToAdConsent(ump);
  if (appAdsConsent === false) return "denied";
  if (appAdsConsent === null) return platform === "unresolved" ? "unresolved" : platform;
  return platform;
}

/**
 * The privacy options entry point must be shown whenever UMP reports it as
 * required — it stays reachable from settings forever, with no reinstall and
 * no account deletion.
 */
export function shouldOfferPrivacyOptions(state: UmpState): boolean {
  return state.privacyOptionsRequired && state.formStatus !== "unknown";
}

/**
 * Ads may only be initialized once consent resolution allows it. Called before
 * the Mobile Ads SDK is initialized, so no ad request leaves the device while
 * consent is unresolved.
 */
export function mayInitializeAds(state: UmpState): boolean {
  if (state.error) return false;
  if (state.status === "unknown") return false;
  return state.canRequestAds;
}

/** The native UMP bridge contract. Absent on web; injected by the Android shell. */
export interface UmpBridge {
  requestConsentInfoUpdate(): Promise<UmpState>;
  showConsentFormIfRequired(): Promise<UmpState>;
  showPrivacyOptionsForm(): Promise<UmpState>;
  reset?(): Promise<void>;
}
