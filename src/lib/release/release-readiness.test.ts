/**
 * PHASE 15 — free-only release gate.
 *
 * The audit is pure configuration logic, so it is tested exhaustively here
 * rather than at packaging time. Every gate below corresponds to a Play
 * pre-launch rejection reason we have actually seen or been warned about.
 */
import { describe, expect, it } from "vitest";

import { EXPECTED_PACKAGE_NAME } from "./app-identity";
import { auditReleaseCandidate, type ArtifactFacts, type ReleaseAuditInput } from "./artifact";

const goodArtifact: ArtifactFacts = {
  packageName: EXPECTED_PACKAGE_NAME,
  versionCode: 12,
  versionName: "1.2.0",
  previousVersionCode: 11,
  debuggable: false,
  signedWithReleaseKey: true,
  usesDebugKeystore: false,
  webContentsDebuggingEnabled: false,
  cleartextTrafficPermitted: false,
  minSdk: 23,
  targetSdk: 34,
};

function input(overrides: Partial<ArtifactFacts> = {}): ReleaseAuditInput {
  return {
    artifact: { ...goodArtifact, ...overrides },
    runtime: {
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "sb_publishable_example",
      mode: "production",
    },
    ads: {
      banner: "ca-app-pub-1111111111111111/2222222222",
      interstitial: "ca-app-pub-1111111111111111/3333333333",
      rewarded: "ca-app-pub-1111111111111111/4444444444",
    },
    adMobAppId: "ca-app-pub-1111111111111111~5555555555",
  };
}

describe("free-only release readiness", () => {
  it("REL-T1: a well-formed release candidate passes", () => {
    const result = auditReleaseCandidate(input());
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("REL-T2: the package name is pinned to the Play listing", () => {
    expect(EXPECTED_PACKAGE_NAME).toBe("com.synctogether.com");
    expect(auditReleaseCandidate(input({ packageName: "com.example.other" })).problems).toContain(
      "package_mismatch",
    );
  });

  it("REL-T3: version codes must exist and increase", () => {
    expect(auditReleaseCandidate(input({ versionCode: 0 })).problems).toContain(
      "missing_version_code",
    );
    expect(
      auditReleaseCandidate(input({ versionCode: 11, previousVersionCode: 11 })).problems,
    ).toContain("non_monotonic_version_code");
  });

  it("REL-T4: the version name must be semver-shaped", () => {
    expect(auditReleaseCandidate(input({ versionName: "v1.2" })).problems).toContain(
      "invalid_version_name",
    );
  });

  it("REL-T5: debuggable, unsigned or debug-signed builds are refused", () => {
    expect(auditReleaseCandidate(input({ debuggable: true })).problems).toContain(
      "debuggable_release",
    );
    expect(auditReleaseCandidate(input({ signedWithReleaseKey: false })).problems).toContain(
      "unsigned_release",
    );
    expect(auditReleaseCandidate(input({ usesDebugKeystore: true })).problems).toContain(
      "debug_signing_in_release",
    );
  });

  it("REL-T6: WebView debugging and cleartext traffic are refused", () => {
    expect(auditReleaseCandidate(input({ webContentsDebuggingEnabled: true })).problems).toContain(
      "webview_debugging_enabled",
    );
    expect(auditReleaseCandidate(input({ cleartextTrafficPermitted: true })).problems).toContain(
      "cleartext_enabled",
    );
  });

  it("REL-T7: SDK floors are enforced", () => {
    expect(auditReleaseCandidate(input({ minSdk: 21 })).problems).toContain("min_sdk_too_low");
    expect(auditReleaseCandidate(input({ targetSdk: 33 })).problems).toContain(
      "target_sdk_too_low",
    );
  });

  it("REL-T8: backend runtime misconfiguration blocks the release", () => {
    const base = input();
    const result = auditReleaseCandidate({
      ...base,
      runtime: { ...base.runtime, supabaseUrl: "" },
    });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.startsWith("runtime:"))).toBe(true);
  });

  it("REL-T9: test or missing ad units block the release", () => {
    const base = input();
    const result = auditReleaseCandidate({ ...base, ads: {} });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.startsWith("ads:"))).toBe(true);
  });

  it("REL-T10: the audit reports every problem at once, not just the first", () => {
    const result = auditReleaseCandidate(
      input({ debuggable: true, signedWithReleaseKey: false, minSdk: 19 }),
    );
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });

  it("REL-T11: the gate has no purchasable-product dependency", () => {
    // Phase 15 is free-only: nothing in the release gate may reference billing.
    const source = auditReleaseCandidate.toString();
    expect(source).not.toMatch(/subscription|billing|premium/i);
  });
});
