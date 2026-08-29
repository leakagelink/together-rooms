/**
 * PHASE 14.1 — static Android build-blocker checks (ANDROID-BUILD-T1 … T15).
 *
 * These tests read the REAL Android project files. They cannot compile Java —
 * this environment has no JDK and no Android SDK — so they deliberately claim
 * nothing about compilation. What they do catch is the class of mistake that
 * makes a Gradle build fail or, worse, produce an app whose native ad bridge
 * silently does not exist: package mismatches, missing/duplicated
 * dependencies, a plugin that is never registered, a manifest pointing at a
 * resource that is not there, shrink rules that strip the bridge, and any
 * reappearance of a forbidden ad format.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REWARDED_ADS_ENABLED } from "./config";
import { PRODUCTION_ADMOB_APP_ID } from "./admob-production";

const ANDROID = resolve(process.cwd(), "android");
const ADS_DIR = resolve(ANDROID, "app/src/main/java/com/synctogether/com/ads");
const APP_PACKAGE = "com.synctogether.com";

const read = (relative: string) => readFileSync(resolve(ANDROID, relative), "utf8");
const adsSources = () =>
  readdirSync(ADS_DIR)
    .filter((file) => file.endsWith(".java"))
    .map((file) => ({ file, source: readFileSync(resolve(ADS_DIR, file), "utf8") }));

const variables = read("variables.gradle");
const appGradle = read("app/build.gradle");
const manifest = read("app/src/main/AndroidManifest.xml");
const strings = read("app/src/main/res/values/strings.xml");
const proguard = read("app/proguard-rules.pro");
const mainActivity = read("app/src/main/java/com/synctogether/com/MainActivity.java");

function gradleInt(name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(variables);
  expect(match, `${name} missing from variables.gradle`).not.toBeNull();
  return Number(match![1]);
}

describe("phase 14.1 android build blockers", () => {
  it("ANDROID-BUILD-T1: minSdk satisfies the Mobile Ads SDK v24 floor of API 23", () => {
    const minSdk = gradleInt("minSdkVersion");
    expect(minSdk).toBeGreaterThanOrEqual(23);
    // compileSdk must also be recent enough for the pinned SDK, and target
    // must not exceed what we compile against.
    const compileSdk = gradleInt("compileSdkVersion");
    const targetSdk = gradleInt("targetSdkVersion");
    expect(compileSdk).toBeGreaterThanOrEqual(34);
    expect(targetSdk).toBeGreaterThanOrEqual(34);
    expect(targetSdk).toBeLessThanOrEqual(compileSdk);
    expect(minSdk).toBeLessThanOrEqual(targetSdk);
    // The module must consume the shared values, not fork its own.
    expect(appGradle).toContain("rootProject.ext.minSdkVersion");
    expect(appGradle).toContain("rootProject.ext.compileSdkVersion");
    expect(appGradle).toContain("rootProject.ext.targetSdkVersion");
  });

  it("ANDROID-BUILD-T2: the Mobile Ads dependency is declared exactly once and pinned", () => {
    const declarations = appGradle.match(/play-services-ads[^"']*/g) ?? [];
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toBe("play-services-ads:$playServicesAdsVersion");
    const version = /playServicesAdsVersion\s*=\s*'([^']+)'/.exec(variables)?.[1];
    // Pinned to the Phase 14 major line: a silent jump to v25 would change
    // API and policy requirements and must be its own migration.
    expect(version).toBe("24.4.0");
    // No -lite variant and no mediation adapters were introduced.
    expect(appGradle).not.toContain("play-services-ads-lite");
    expect(appGradle).not.toMatch(/com\.google\.ads\.mediation:/);
  });

  it("ANDROID-BUILD-T3: the UMP dependency is declared exactly once and pinned", () => {
    const declarations = appGradle.match(/user-messaging-platform[^"']*/g) ?? [];
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toBe("user-messaging-platform:$userMessagingPlatformVersion");
    const version = /userMessagingPlatformVersion\s*=\s*'([^']+)'/.exec(variables)?.[1];
    expect(version).toBe("3.2.0");
    // UMP is used through its own artifact, never assumed to be transitive.
    expect(read("app/src/main/java/com/synctogether/com/ads/ConsentController.java")).toContain(
      "import com.google.android.ump.UserMessagingPlatform;",
    );
  });

  it("ANDROID-BUILD-T4: every native ad source sits in the app's own package", () => {
    const sources = adsSources();
    expect(sources.length).toBeGreaterThan(0);
    for (const { file, source } of sources) {
      expect(source, file).toContain(`package ${APP_PACKAGE}.ads;`);
    }
    expect(mainActivity).toContain(`package ${APP_PACKAGE};`);
    // namespace / applicationId / package / manifest activity must agree, or
    // the class is simply not found at runtime.
    expect(appGradle).toContain(`namespace = "${APP_PACKAGE}"`);
    expect(appGradle).toContain(`applicationId "${APP_PACKAGE}"`);
    expect(manifest).toContain('android:name=".MainActivity"');
    expect(strings).toContain(`<string name="package_name">${APP_PACKAGE}</string>`);
  });

  it("ANDROID-BUILD-T5: the plugin is annotated with the name the web layer resolves", () => {
    const plugin = readFileSync(resolve(ADS_DIR, "AdsPlugin.java"), "utf8");
    expect(plugin).toContain('@CapacitorPlugin(name = "SyncTogetherAds")');
    expect(plugin).toContain("import com.getcapacitor.annotation.CapacitorPlugin;");
    expect(plugin).toMatch(/class AdsPlugin extends Plugin\b/);
    // Every method the TypeScript adapter calls must exist natively as a
    // @PluginMethod, otherwise the call rejects at runtime.
    const bridgeSurface = readFileSync(
      resolve(process.cwd(), "src/lib/ads/capacitor-ads-bridge.ts"),
      "utf8",
    );
    expect(bridgeSurface).toContain('registerPlugin<SyncTogetherAdsPlugin>("SyncTogetherAds")');
    for (const method of [
      "isAvailable",
      "initialize",
      "showBanner",
      "hideBanner",
      "preloadInterstitial",
      "showInterstitial",
      "requestConsentInfoUpdate",
      "showConsentFormIfRequired",
      "showPrivacyOptionsForm",
    ]) {
      expect(plugin, method).toMatch(
        new RegExp(`@PluginMethod\\s+public void ${method}\\(PluginCall`),
      );
      expect(bridgeSurface, method).toContain(`${method}(`);
    }
  });

  it("ANDROID-BUILD-T6: MainActivity registers the plugin exactly once, before super", () => {
    expect(mainActivity).toContain("import com.synctogether.com.ads.AdsPlugin;");
    const registrations = mainActivity.match(/registerPlugin\(AdsPlugin\.class\)/g) ?? [];
    expect(registrations).toHaveLength(1);
    expect(mainActivity).toMatch(
      /registerPlugin\(AdsPlugin\.class\);\s*\n\s*super\.onCreate\(savedInstanceState\);/,
    );
    expect(mainActivity).toMatch(/class MainActivity extends BridgeActivity/);
  });

  it("ANDROID-BUILD-T7: the manifest declares the AdMob app id via a resource", () => {
    expect(manifest).toContain('android:name="com.google.android.gms.ads.APPLICATION_ID"');
    expect(manifest).toContain('android:value="@string/admob_app_id"');
    // A literal id in the manifest would drift from the audited constant.
    expect(manifest).not.toContain("ca-app-pub-");
  });

  it("ANDROID-BUILD-T8: the referenced string resource exists with a valid app-id shape", () => {
    const value = /<string name="admob_app_id"[^>]*>([^<]+)<\/string>/.exec(strings)?.[1];
    expect(value).toBeDefined();
    expect(value).toMatch(/^ca-app-pub-\d{16}~\d{10}$/);
    expect(value).toBe(PRODUCTION_ADMOB_APP_ID);
    // "~" must stay verbatim; an escaped entity yields an invalid id at runtime.
    expect(strings).not.toContain("&#126;");
  });

  it("ANDROID-BUILD-T9: exactly one MobileAds.initialize path exists", () => {
    const initCalls = adsSources().flatMap(({ file, source }) =>
      (source.match(/MobileAds\.initialize\(/g) ?? []).map(() => file),
    );
    expect(initCalls).toEqual(["AdsPlugin.java"]);
    const plugin = readFileSync(resolve(ADS_DIR, "AdsPlugin.java"), "utf8");
    // Guarded natively as well as in JS.
    expect(plugin).toContain("if (initialized)");
    expect(plugin).toContain("if (initializing)");
    // And nothing auto-initializes from the manifest.
    expect(manifest).not.toContain("com.google.android.gms.ads.AUTO_INIT");
  });

  it("ANDROID-BUILD-T10: native imports stay inside the pinned SDK surface", () => {
    const allowedPrefixes = [
      "android.",
      "androidx.annotation.",
      "java.",
      "com.getcapacitor.",
      "com.google.android.gms.ads.",
      "com.google.android.ump.",
      "com.google.ads.mediation.admob.",
      "com.synctogether.com.",
    ];
    // APIs that do not exist in the 24.x / UMP 3.x line — a leftover from an
    // older or newer SDK would be a hard compile failure.
    const forbidden = [
      "com.google.android.gms.ads.MobileAdsInitProvider",
      "com.google.android.gms.ads.reward",
      "com.google.android.gms.ads.appopen",
      "com.google.android.gms.ads.rewarded",
      "com.google.android.gms.ads.doubleclick",
      "com.google.android.gms.ads.formats",
      "com.google.android.gms.ads.search",
    ];
    for (const { file, source } of adsSources()) {
      for (const line of source.split("\n")) {
        const match = /^import\s+(?:static\s+)?([\w.]+);/.exec(line.trim());
        if (!match) continue;
        const imported = match[1] ?? "";
        expect(
          allowedPrefixes.some((prefix) => imported.startsWith(prefix)),
          `${file}: unexpected import ${imported}`,
        ).toBe(true);
        expect(
          forbidden.some((bad) => imported.startsWith(bad)),
          `${file}: ${imported}`,
        ).toBe(false);
      }
    }
  });

  it("ANDROID-BUILD-T11: release shrinking preserves the plugin without blanket keeps", () => {
    expect(appGradle).toMatch(/minifyEnabled true/);
    expect(appGradle).toContain("'proguard-rules.pro'");
    // The reflective entry points are kept…
    expect(proguard).toContain(
      "-keep @com.getcapacitor.annotation.CapacitorPlugin class com.synctogether.com.ads.** { *; }",
    );
    expect(proguard).toContain("@com.getcapacitor.PluginMethod <methods>;");
    expect(proguard).toContain("-keepattributes *Annotation*");
    // …and the SDKs are NOT blanket-kept: they ship their own consumer rules,
    // so a wildcard keep would only disable shrinking (Phase 14.1 removed it).
    expect(proguard).not.toContain("-keep class com.google.android.gms.ads.** { *; }");
    expect(proguard).not.toContain("-keep class com.google.android.ump.** { *; }");
    // Debug must stay unminified so a shrink problem is never masked locally.
    expect(appGradle).toMatch(/debug\s*\{[\s\S]*?minifyEnabled false/);
  });

  it("ANDROID-BUILD-T12: debug/release application ids stay a valid configuration", () => {
    expect(appGradle).toContain('applicationIdSuffix ".debug"');
    // The AdMob app id is NOT namespaced by applicationId, so the suffix
    // cannot invalidate it — both variants resolve the same valid id.
    expect(manifest).toContain("@string/admob_app_id");
    // Anything that IS namespaced must use the placeholder, not a literal.
    expect(manifest).toContain('android:authorities="${applicationId}.fileprovider"');
    // Release signing is environment-supplied only; no credential is committed.
    expect(appGradle).toContain('System.getenv("ANDROID_KEYSTORE_PATH")');
    expect(appGradle).not.toMatch(/storePassword\s+["']/);
    expect(appGradle).not.toMatch(/keyPassword\s+["']/);
  });

  it("ANDROID-BUILD-T13: the native rewarded path exists only as an opt-in surface", () => {
    expect(REWARDED_ADS_ENABLED).toBe(true);
    const sources = adsSources();
    const controller = sources.find((entry) => entry.file.endsWith("RewardedAdController.java"));
    expect(controller).toBeDefined();
    // Rewarded is a plain rewarded ad: never a rewarded interstitial, which
    // can show without an explicit opt-in.
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("RewardedInterstitialAd");
      expect(source, file).not.toContain("AppOpenAd");
    }
    // The reward is only ever granted through the SDK listener.
    expect(controller!.source).toContain("OnUserEarnedRewardListener");
  });

  it("ANDROID-BUILD-T14: no app-open ad implementation exists anywhere", () => {
    for (const { file, source } of adsSources()) {
      expect(source, file).not.toContain("AppOpenAd");
    }
    expect(mainActivity).not.toContain("AppOpenAd");
    // No Application subclass exists to host an app-open lifecycle observer.
    expect(manifest).not.toContain('android:name=".SyncTogetherApplication"');
    expect(manifest).not.toMatch(/<application[^>]*android:name="\.[A-Za-z]*Application"/);
  });

  it("ANDROID-BUILD-T15: no native path can fake a successful initialization", () => {
    const plugin = readFileSync(resolve(ADS_DIR, "AdsPlugin.java"), "utf8");
    // initialized is only ever set true inside the SDK's completion callback.
    const assignments = plugin.match(/initialized = (true|false)/g) ?? [];
    expect(assignments.filter((line) => line.endsWith("true"))).toHaveLength(1);
    expect(plugin).toMatch(
      /MobileAds\.initialize\(activity, status -> \{\s*\n\s*initialized = true;/,
    );
    // Ad calls refuse to run before that happened.
    expect(
      (plugin.match(/if \(!initialized\) \{\s*\n\s*call\.reject\("sdk_init_failed"\);/g) ?? [])
        .length,
    ).toBeGreaterThanOrEqual(3);
    // And the JS side never invents a bridge: no plugin means null, and a
    // rejected initialize resolves to false rather than "ready".
    const jsBridge = readFileSync(resolve(process.cwd(), "src/lib/ads/admob-bridge.ts"), "utf8");
    expect(jsBridge).toContain('initState = "idle"');
    // A rejected initialize resets the guard and returns false; it never
    // latches "ready", and no branch returns true without the bridge resolving.
    expect(jsBridge).toMatch(/\.catch\([\s\S]*?initState = "idle";[\s\S]*?return false;/);
    expect(jsBridge).toContain("if (!bridge) return null;");
  });
});
