/**
 * PHASE 9 — ad provider abstraction.
 *
 * Application code never talks to AdMob. It asks this provider for a
 * placement; the provider consults the centralized policy and the frequency
 * caps, and only then (optionally) reaches an SDK. Swapping or removing the ad
 * network is a change to this file alone.
 */
import type { AdFrequencyConfig, AdUnits } from "./config";
import {
  checkFrequency,
  newFrequencyState,
  recordFullscreenShown,
  type FrequencyState,
} from "./frequency";
import {
  evaluateAdPlacement,
  type AdFormat,
  type AdPlacementContext,
  type AdPlacementDecision,
} from "./placement";

export interface AdRequest {
  format: AdFormat;
  /** Named surface, used for policy review and operational analytics only. */
  placement: string;
}

export interface AdOutcome extends AdPlacementDecision {
  /** Set only when eligible; the unit the SDK would be asked for. */
  unitId: string | null;
  testMode: boolean;
}

/** The concrete SDK boundary. The web build has no implementation. */
export interface AdSdk {
  showBanner?(unitId: string, nonPersonalized: boolean): void;
  hideBanner?(): void;
  showFullscreen?(unitId: string, nonPersonalized: boolean): Promise<void>;
}

export interface AdProviderOptions {
  units: AdUnits | null;
  testMode: boolean;
  config: AdFrequencyConfig;
  sdk?: AdSdk | null;
  now?: () => number;
  onDecision?: (request: AdRequest, outcome: AdOutcome) => void;
}

export class AdProvider {
  private frequency: FrequencyState;
  private readonly now: () => number;

  constructor(private options: AdProviderOptions) {
    this.now = options.now ?? (() => Date.now());
    this.frequency = newFrequencyState(this.now());
  }

  /**
   * Attaches the SDK. Deliberately a separate step from construction: the SDK
   * is only ever attached after consent resolution permits ad requests.
   */
  attachSdk(sdk: AdSdk | null) {
    this.options = { ...this.options, sdk };
  }

  updateConfig(config: AdFrequencyConfig) {
    this.options = { ...this.options, config };
  }

  /** Pure decision, exposed so UI can reserve or release layout space. */
  evaluate(request: AdRequest, context: AdPlacementContext): AdOutcome {
    const decision = evaluateAdPlacement(request.format, context, this.options.config);
    if (!decision.eligible) {
      return { ...decision, unitId: null, testMode: this.options.testMode };
    }
    if (request.format !== "banner") {
      const verdict = checkFrequency(
        request.format,
        this.frequency,
        this.options.config,
        this.now(),
      );
      if (!verdict.allowed) {
        return {
          eligible: false,
          reason: "NO_AD_FREQUENCY_CAP",
          nonPersonalized: decision.nonPersonalized,
          unitId: null,
          testMode: this.options.testMode,
        };
      }
    }
    const units = this.options.units;
    const unitId = !units
      ? null
      : request.format === "banner"
        ? units.banner
        : request.format === "interstitial"
          ? units.interstitial
          : units.appOpen;
    return { ...decision, unitId, testMode: this.options.testMode };
  }

  /** Requests an ad. Returns false when nothing was (or could be) requested. */
  async request(request: AdRequest, context: AdPlacementContext): Promise<boolean> {
    const outcome = this.evaluate(request, context);
    this.options.onDecision?.(request, outcome);
    if (!outcome.eligible || !outcome.unitId) return false;

    const sdk = this.options.sdk;
    if (!sdk) return false;

    if (request.format === "banner") {
      sdk.showBanner?.(outcome.unitId, outcome.nonPersonalized);
      return true;
    }
    if (!sdk.showFullscreen) return false;
    await sdk.showFullscreen(outcome.unitId, outcome.nonPersonalized);
    this.frequency = recordFullscreenShown(request.format, this.frequency, this.now());
    return true;
  }

  hideBanner() {
    this.options.sdk?.hideBanner?.();
  }

  get frequencyState(): FrequencyState {
    return this.frequency;
  }
}

/** A provider that can never show anything (premium users, misconfiguration). */
export function createDisabledProvider(config: AdFrequencyConfig): AdProvider {
  return new AdProvider({ units: null, testMode: false, config, sdk: null });
}
