/**
 * PHASE 13 — launch-readiness regression tests.
 *
 * These assert the properties that would otherwise only be discovered in a
 * Play testing track: that a production build refuses unsafe configuration,
 * that acknowledgement recovery cannot be left un-scheduled by accident, that
 * key rotation stays non-destructive, and that the Data Safety inventory
 * cannot claim something the implementation does not do.
 */
import { afterEach, describe, expect, it } from "vitest";

import { resolveAdUnits, TEST_AD_UNITS } from "@/lib/ads/config";
import { resolveProductConfig } from "@/lib/billing/products";
import { resolveDeepLink } from "@/lib/android/deep-link";
import { featureBlockedByPermission, permissionRecovery } from "@/lib/android/permissions";
import { validateRuntimeConfig } from "@/lib/android/environment";
import {
  openRecoveryToken,
  sealRecoveryToken,
  currentKeyVersion,
} from "@/lib/billing/token-crypto.server";

import { auditReleaseCandidate, type ReleaseAuditInput } from "./artifact";
import { DATA_SAFETY_INVENTORY, validateDataSafetyInventory } from "./data-safety";
import { rotationIsSafe, rotationPlan, validateRecoveryKeyConfig } from "./recovery-key";
import { validateSchedulerConfig } from "./scheduler";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

function healthyInput(): ReleaseAuditInput {
  return {
    artifact: {
      packageName: "app.lovable.synctogether",
      versionCode: 2,
      versionName: "1.0.0",
      previousVersionCode: 1,
      debuggable: false,
      signedWithReleaseKey: true,
      usesDebugKeystore: false,
      webContentsDebuggingEnabled: false,
      cleartextTrafficPermitted: false,
      minSdk: 23,
      targetSdk: 34,
    },
    runtime: {
      mode: "production",
      supabaseUrl: "https://ebvilmlrsmoyakatqzqr.supabase.co",
      supabasePublishableKey: "sb_publishable_A8gKpxFLxUb55nJEAgj-TQ_SKkjyJNy",
      appOrigin: "https://together-rooms.lovable.app",
    },
    billing: {
      premiumProductId: "synctogether.premium.monthly",
      packageName: "app.lovable.synctogether",
    },
    ads: {
      banner: "ca-app-pub-1111111111111111/1111111111",
      interstitial: "ca-app-pub-1111111111111111/2222222222",
      appOpen: "ca-app-pub-1111111111111111/3333333333",
    },
    scheduler: {
      secret: "s".repeat(48),
      endpointUrl: "https://together-rooms.lovable.app/api/public/billing/reconcile",
      intervalMinutes: 15,
    },
    recoveryKey: { currentVersion: 1, available: [{ version: 1, length: 64 }] },
  };
}

describe("PHASE 13 — release readiness", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("baseline: a fully configured release candidate passes", () => {
    expect(auditReleaseCandidate(healthyInput())).toEqual({ ok: true, problems: [] });
  });

  it("PHASE13-T1: production rejects development/test billing configuration", () => {
    for (const productId of ["android.test.purchased", "premium.test.monthly", "demo.premium"]) {
      const result = resolveProductConfig("production", {
        premiumProductId: productId,
        packageName: "app.lovable.synctogether",
      });
      expect(result.ok).toBe(false);
      expect(result.problems).toContain("test_product_in_production");
    }

    const audit = auditReleaseCandidate({
      ...healthyInput(),
      billing: {
        premiumProductId: "android.test.purchased",
        packageName: "app.lovable.synctogether",
      },
    });
    expect(audit.ok).toBe(false);
    expect(audit.problems).toContain("billing:test_product_in_production");

    // A mismatched package name must also block the build.
    expect(
      resolveProductConfig("production", {
        premiumProductId: "synctogether.premium.monthly",
        packageName: "com.someone.else",
      }).problems,
    ).toContain("package_mismatch");
  });

  it("PHASE13-T2: production rejects test ad configuration and never silently falls back", () => {
    const leaked = resolveAdUnits("production", TEST_AD_UNITS);
    expect(leaked.units).toBeNull();
    expect(leaked.testMode).toBe(false);
    expect(leaked.configError).toMatch(/test ad unit/);

    const missing = resolveAdUnits("production", { banner: "ca-app-pub-1/2" });
    expect(missing.units).toBeNull();
    expect(missing.configError).toMatch(/missing production ad unit/);

    const audit = auditReleaseCandidate({ ...healthyInput(), ads: TEST_AD_UNITS });
    expect(audit.ok).toBe(false);
    expect(audit.problems.some((p) => p.startsWith("ads:"))).toBe(true);
  });

  it("PHASE13-T3: billing scheduler configuration fails closed when missing or unsafe", () => {
    const none = validateSchedulerConfig({});
    expect(none.ok).toBe(false);
    expect(none.enabled).toBe(false);
    expect(none.problems).toContain("missing_secret");

    expect(validateSchedulerConfig({ ...healthyInput().scheduler, secret: "short" }).problems).toContain(
      "weak_secret",
    );
    expect(
      validateSchedulerConfig({
        ...healthyInput().scheduler,
        endpointUrl: "http://together-rooms.lovable.app/api/public/billing/reconcile",
      }).problems,
    ).toContain("insecure_endpoint");
    expect(
      validateSchedulerConfig({
        ...healthyInput().scheduler,
        endpointUrl: `https://together-rooms.lovable.app/api/public/billing/reconcile?secret=${"s".repeat(48)}`,
      }).problems,
    ).toContain("secret_in_url");
    expect(
      validateSchedulerConfig({ ...healthyInput().scheduler, intervalMinutes: 24 * 60 }).problems,
    ).toContain("interval_too_long");

    const audit = auditReleaseCandidate({ ...healthyInput(), scheduler: {} });
    expect(audit.problems).toContain("scheduler:missing_secret");
  });

  it("PHASE13-T4: recovery key configuration is validated safely", () => {
    expect(validateRecoveryKeyConfig({ currentVersion: 1, available: [] }).problems).toContain(
      "missing_current_key",
    );
    expect(
      validateRecoveryKeyConfig({ currentVersion: 1, available: [{ version: 1, length: 12 }] })
        .problems,
    ).toContain("weak_key");
    expect(
      validateRecoveryKeyConfig({ currentVersion: 0, available: [{ version: 1, length: 64 }] })
        .problems,
    ).toContain("invalid_key_version");

    const healthy = validateRecoveryKeyConfig({
      currentVersion: 2,
      available: [
        { version: 1, length: 64 },
        { version: 2, length: 64 },
      ],
      versionsWithOutstandingEnvelopes: [1],
    });
    expect(healthy.ok).toBe(true);
    expect(healthy.requiredVersions).toEqual([1, 2]);
  });

  it("PHASE13-T5: envelopes sealed with an older key stay recoverable across rotation", async () => {
    process.env["BILLING_TOKEN_RECOVERY_KEY_V1"] = KEY_A;
    delete process.env["BILLING_TOKEN_RECOVERY_KEY_VERSION"];
    expect(currentKeyVersion()).toBe(1);

    const old = await sealRecoveryToken("purchase-token-old");
    expect(old?.keyVersion).toBe(1);

    // Rotate: add V2, pin the deployment to it, keep V1 configured.
    process.env["BILLING_TOKEN_RECOVERY_KEY_V2"] = KEY_B;
    process.env["BILLING_TOKEN_RECOVERY_KEY_VERSION"] = "2";
    expect(currentKeyVersion()).toBe(2);

    const fresh = await sealRecoveryToken("purchase-token-new");
    expect(fresh?.keyVersion).toBe(2);
    expect(await openRecoveryToken(fresh!.ciphertext)).toBe("purchase-token-new");
    // The critical property: the pre-rotation envelope still opens.
    expect(await openRecoveryToken(old!.ciphertext)).toBe("purchase-token-old");

    // Retiring V1 while envelopes remain is destructive and must be refused.
    expect(rotationIsSafe(1, [1])).toBe(false);
    expect(rotationIsSafe(1, [2])).toBe(true);
    delete process.env["BILLING_TOKEN_RECOVERY_KEY_V1"];
    expect(await openRecoveryToken(old!.ciphertext)).toBeNull();

    const plan = rotationPlan(1, 2);
    expect(plan).toHaveLength(4);
    expect(plan.filter((s) => s.destructive)).toHaveLength(1);
    expect(plan[plan.length - 1]!.destructive).toBe(true);
  });

  it("PHASE13-T6: malformed or hostile App Links fail safely", () => {
    const hostile = [
      "https://evil.example.com/invite/" + "a".repeat(48),
      "//evil.example.com/rooms",
      "/\\evil.example.com",
      "javascript:alert(1)",
      "http://together-rooms.lovable.app/rooms",
      "https://together-rooms.lovable.app/../admin",
      "https://together-rooms.lovable.app/invite/NOT-A-TOKEN",
      "",
      "x".repeat(5000),
    ];
    for (const raw of hostile) {
      const result = resolveDeepLink(raw);
      expect(result.ok, raw).toBe(false);
    }

    const good = resolveDeepLink(`https://together-rooms.lovable.app/invite/${"a".repeat(48)}`);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.path.startsWith("/")).toBe(true);
      expect(good.kind).toBe("invite");
    }
  });

  it("PHASE13-T7: production configuration cannot silently use debug backend settings", () => {
    const dev = validateRuntimeConfig({
      mode: "production",
      supabaseUrl: "http://localhost:54321",
      supabasePublishableKey: "sb_publishable_local",
    });
    expect(dev.ok).toBe(false);
    expect(dev.problems).toContain("development_backend_in_release");

    const secret = validateRuntimeConfig({
      mode: "production",
      supabaseUrl: "https://ebvilmlrsmoyakatqzqr.supabase.co",
      supabasePublishableKey: "sb_secret_do_not_ship",
    });
    expect(secret.problems).toContain("secret_key_exposed");

    for (const artifact of [
      { debuggable: true, expected: "debuggable_release" },
      { usesDebugKeystore: true, expected: "debug_signing_in_release" },
      { webContentsDebuggingEnabled: true, expected: "webview_debugging_enabled" },
      { cleartextTrafficPermitted: true, expected: "cleartext_enabled" },
      { signedWithReleaseKey: false, expected: "unsigned_release" },
    ] as const) {
      const base = healthyInput();
      const audit = auditReleaseCandidate({
        ...base,
        artifact: { ...base.artifact, ...artifact },
      });
      expect(audit.problems, artifact.expected).toContain(artifact.expected);
    }
  });

  it("PHASE13-T8: permission-dependent features degrade safely when denied", () => {
    expect(featureBlockedByPermission("video_call", "camera")).toBe(true);
    expect(featureBlockedByPermission("voice_call", "microphone")).toBe(true);
    expect(featureBlockedByPermission("local_media", "media_picker")).toBe(true);

    // Everything else keeps working with every dangerous permission denied.
    for (const feature of ["rooms", "chat", "watch_together", "music", "study"] as const) {
      for (const denied of ["camera", "microphone", "media_picker", "notifications"] as const) {
        expect(featureBlockedByPermission(feature, denied), `${feature}/${denied}`).toBe(false);
      }
    }

    const permanent = permissionRecovery("microphone", "permanently_denied");
    expect(permanent.openSettings).toBe(true);
    expect(permanent.canRetry).toBe(false);
    const denied = permissionRecovery("camera", "denied");
    expect(denied.canRetry).toBe(true);
  });

  it("PHASE13-T9: the Data Safety inventory cannot contain unsupported assumptions", () => {
    expect(validateDataSafetyInventory()).toEqual({ ok: true, problems: [] });

    // Real behaviour: call and local media payloads are never stored server-side.
    const streams = DATA_SAFETY_INVENTORY.find((e) => e.category === "voice_video_streams")!;
    expect(streams.stored).toBe(false);
    expect(streams.sharedWith).toEqual([]);
    const media = DATA_SAFETY_INVENTORY.find((e) => e.category === "photos_videos_audio")!;
    expect(media.stored).toBe(false);

    // A fabricated claim is rejected.
    const bogus = validateDataSafetyInventory([
      { ...streams, stored: true, collected: false },
      { ...media, sharedWith: ["  "] },
      { ...streams, retention: "" },
    ]);
    expect(bogus.ok).toBe(false);
    expect(bogus.problems.map((p) => p.problem)).toEqual(
      expect.arrayContaining([
        "stored_but_not_collected",
        "shared_without_recipient",
        "missing_retention",
      ]),
    );
  });

  it("PHASE13-T10: the release audit catches missing critical values", () => {
    const audit = auditReleaseCandidate({
      artifact: {
        packageName: "com.example.other",
        versionCode: 1,
        versionName: "beta",
        previousVersionCode: 1,
        debuggable: true,
        signedWithReleaseKey: false,
        usesDebugKeystore: true,
        webContentsDebuggingEnabled: true,
        cleartextTrafficPermitted: true,
        minSdk: 19,
        targetSdk: 30,
      },
      runtime: { mode: "production", supabaseUrl: undefined, supabasePublishableKey: undefined },
      billing: {},
      ads: {},
      scheduler: {},
      recoveryKey: { currentVersion: 1, available: [] },
    });

    expect(audit.ok).toBe(false);
    expect(audit.problems).toEqual(
      expect.arrayContaining([
        "package_mismatch",
        "non_monotonic_version_code",
        "invalid_version_name",
        "debuggable_release",
        "unsigned_release",
        "debug_signing_in_release",
        "webview_debugging_enabled",
        "cleartext_enabled",
        "min_sdk_too_low",
        "target_sdk_too_low",
        "runtime:missing_supabase_url",
        "runtime:missing_supabase_key",
        "billing:missing_premium_product_id",
        "billing:missing_package_name",
        "scheduler:missing_secret",
        "recovery_key:missing_current_key",
      ]),
    );
  });
});
