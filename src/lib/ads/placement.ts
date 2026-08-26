/**
 * PHASE 9 — the single, centralized ad placement policy.
 *
 * Every ad request in the application must go through `evaluateAdPlacement`.
 * Components cannot request an ad directly, so there is no route by which a
 * developer can accidentally place an ad in a prohibited context.
 *
 * Nothing here is "hide the container": an ineligible placement never reaches
 * the SDK, so no ad is requested, loaded or billed.
 */
import { REWARDED_ADS_ENABLED, type AdFrequencyConfig } from "./config";

export type AdFormat = "banner" | "interstitial" | "app_open" | "rewarded";

/** Consent is deliberately tri-state: "unresolved" is NOT "denied by user". */
export type ConsentState = "unresolved" | "granted_personalized" | "granted_limited" | "denied";

/**
 * Sensitive surfaces where monetization ads are never allowed, regardless of
 * plan, consent or frequency state.
 */
export type SensitiveFlow =
  | "account_deletion"
  | "privacy_settings"
  | "consent"
  | "payment"
  | "restore_purchases"
  | "report"
  | "block"
  | "auth";

export interface AdPlacementContext {
  /** Authoritative premium flag from the server snapshot. */
  premium: boolean;
  /** Ads consent state derived from privacy_settings + the platform CMP. */
  consent: ConsentState;
  /** Live collaborative activity. */
  activeCall: boolean;
  activeVideoPlayback: boolean;
  activeAudioPlayback: boolean;
  activeLocalMedia: boolean;
  /** Momentary interaction states. */
  chatTyping: boolean;
  formEntry: boolean;
  /** Non-null while the user is on a sensitive surface. */
  sensitiveFlow: SensitiveFlow | null;
  /** True while a critical navigation/close affordance is on screen. */
  criticalNavigation: boolean;
  /** Ad units resolved for this build; null means "no valid configuration". */
  configured: boolean;
}

export type AdBlockReason =
  | "NO_AD_PREMIUM"
  | "NO_AD_NOT_CONFIGURED"
  | "NO_AD_DISABLED_REMOTELY"
  | "NO_AD_FORMAT_DISABLED"
  | "NO_AD_CONSENT_UNRESOLVED"
  | "NO_AD_CONSENT_DENIED"
  | "NO_AD_ACTIVE_CALL"
  | "NO_AD_ACTIVE_VIDEO"
  | "NO_AD_ACTIVE_AUDIO"
  | "NO_AD_ACTIVE_LOCAL_MEDIA"
  | "NO_AD_CHAT_TYPING"
  | "NO_AD_FORM_ENTRY"
  | "NO_AD_CRITICAL_NAVIGATION"
  | "NO_AD_ACCOUNT_DELETION"
  | "NO_AD_PRIVACY_SETTINGS"
  | "NO_AD_PAYMENT_FLOW"
  | "NO_AD_REPORT_FLOW"
  | "NO_AD_SENSITIVE_FLOW"
  | "NO_AD_FREQUENCY_CAP"
  | "NO_AD_PLACEMENT_NOT_APPROVED"
  | "NO_AD_TRANSITION_NOT_APPROVED"
  | "NO_AD_REWARDED_DISABLED";

export interface AdPlacementDecision {
  eligible: boolean;
  reason: AdBlockReason | null;
  /** Non-personalized request required (limited consent). */
  nonPersonalized: boolean;
}

const SENSITIVE_REASON: Record<SensitiveFlow, AdBlockReason> = {
  account_deletion: "NO_AD_ACCOUNT_DELETION",
  privacy_settings: "NO_AD_PRIVACY_SETTINGS",
  consent: "NO_AD_PRIVACY_SETTINGS",
  payment: "NO_AD_PAYMENT_FLOW",
  restore_purchases: "NO_AD_PAYMENT_FLOW",
  report: "NO_AD_REPORT_FLOW",
  block: "NO_AD_REPORT_FLOW",
  auth: "NO_AD_SENSITIVE_FLOW",
};

function deny(reason: AdBlockReason): AdPlacementDecision {
  return { eligible: false, reason, nonPersonalized: false };
}

export function evaluateAdPlacement(
  format: AdFormat,
  context: AdPlacementContext,
  config: AdFrequencyConfig,
): AdPlacementDecision {
  // 1. Entitlement first: premium users are never sent a monetization ad.
  if (context.premium) return deny("NO_AD_PREMIUM");
  if (!context.configured) return deny("NO_AD_NOT_CONFIGURED");
  if (!config.ads_enabled) return deny("NO_AD_DISABLED_REMOTELY");

  if (format === "banner" && !config.banner_enabled) return deny("NO_AD_FORMAT_DISABLED");
  if (format === "interstitial" && !config.interstitial_enabled)
    return deny("NO_AD_FORMAT_DISABLED");
  if (format === "app_open" && !config.app_open_enabled) return deny("NO_AD_FORMAT_DISABLED");
  // PHASE 13.1 — rewarded is configured but never activated: it is refused
  // before consent, frequency or anything else can make it eligible.
  if (format === "rewarded" && (!REWARDED_ADS_ENABLED || !config.rewarded_enabled)) {
    return deny("NO_AD_REWARDED_DISABLED");
  }

  // 2. Consent must be resolved before any SDK request leaves the device.
  if (context.consent === "unresolved") return deny("NO_AD_CONSENT_UNRESOLVED");
  if (context.consent === "denied") return deny("NO_AD_CONSENT_DENIED");

  // 3. Sensitive flows: safety and privacy stay frictionless.
  if (context.sensitiveFlow) return deny(SENSITIVE_REASON[context.sensitiveFlow]);

  // 4. Active collaboration is never interrupted or crowded.
  if (context.activeCall) return deny("NO_AD_ACTIVE_CALL");
  if (context.activeVideoPlayback) return deny("NO_AD_ACTIVE_VIDEO");
  if (context.activeAudioPlayback) return deny("NO_AD_ACTIVE_AUDIO");
  if (context.activeLocalMedia) return deny("NO_AD_ACTIVE_LOCAL_MEDIA");

  // 5. Momentary interaction states (full-screen formats are the risk here,
  //    but a banner must not appear next to a control the user is using).
  if (context.chatTyping) return deny("NO_AD_CHAT_TYPING");
  if (context.formEntry) return deny("NO_AD_FORM_ENTRY");
  if (context.criticalNavigation && format !== "banner") return deny("NO_AD_CRITICAL_NAVIGATION");

  return {
    eligible: true,
    reason: null,
    nonPersonalized: context.consent === "granted_limited",
  };
}
