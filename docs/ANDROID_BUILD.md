# SyncTogether — Android Build & Compilation Audit (Phase 14.1)

Phase 14 wrote the native ad bridge but never compiled it. Phase 14.1 audits
that native project for build blockers, fixes what it found, and states plainly
what is still unverified.

**Source inspection is not compilation.** Nothing in this document claims a
successful Gradle build.

## 1. Toolchain availability in this environment

| Prerequisite | Status |
| --- | --- |
| JDK (any) | **absent** (`java` not on PATH) |
| Android SDK / `sdkmanager` | **absent** (`ANDROID_HOME` unset, no SDK root) |
| Gradle / wrapper distribution | wrapper script present, distribution not downloadable without a JVM |

Therefore `./gradlew assembleDebug` was **NOT RUN**. It was not attempted with
a fabricated result. Compilation is verified in CI instead (section 8).

## 2. Version matrix (audited, all internally consistent)

| Component | Version | Requirement it satisfies |
| --- | --- | --- |
| Gradle wrapper | 8.14.3 | AGP 8.13 requires Gradle 8.13+ |
| Android Gradle Plugin | 8.13.0 | requires JDK 17+; we compile at 21 |
| Java source/target | 21 | matches Capacitor's generated `capacitor.build.gradle` |
| compileSdk | 36 | ≥ 34 required by Mobile Ads v24 |
| targetSdk | 36 | ≤ compileSdk |
| minSdk | **24** | ≥ **23** required by Mobile Ads v24 — **PASS** |
| Capacitor Android | 7.x (`node_modules/@capacitor/android`) | plugin API used (`Plugin`, `@CapacitorPlugin`, `handleOnDestroy`) |
| play-services-ads | 24.4.0 (pinned) | not upgraded; a v25 move would be its own migration |
| user-messaging-platform | 3.2.0 (pinned) | provides `canRequestAds()`, `loadAndShowConsentFormIfRequired`, `showPrivacyOptionsForm` |

No major SDK version was changed in this phase.

## 3. Package consistency

`namespace` = `applicationId` = Java package = manifest activity = string
resource = `com.synctogether.com`; the bridge lives in
`com.synctogether.com.ads`. Debug adds `applicationIdSuffix ".debug"`,
which changes only the installed package — the AdMob app id is not namespaced
by `applicationId`, and the FileProvider authority uses `${applicationId}`, so
both variants stay valid. Machine-checked by ANDROID-BUILD-T4 and T12.

## 4. Plugin registration chain

```
AdsPlugin.java  package com.synctogether.com.ads
  @CapacitorPlugin(name = "SyncTogetherAds")  extends com.getcapacitor.Plugin
MainActivity.onCreate → registerPlugin(AdsPlugin.class) → super.onCreate(...)
Capacitor bridge exposes it as plugin "SyncTogetherAds"
capacitor-ads-bridge.ts → Capacitor.isPluginAvailable("SyncTogetherAds")
                        → registerPlugin<SyncTogetherAdsPlugin>("SyncTogetherAds")
```

`registerPlugin` before `super.onCreate` is the documented Capacitor order —
the bridge is created inside `super.onCreate`, so a later registration would be
ignored. Every method the TypeScript adapter calls is verified to exist as a
`@PluginMethod` (ANDROID-BUILD-T5, T6). Creating the class alone would not have
been enough; the registration line is what exposes it.

## 5. Google Mobile Ads / UMP API audit (by inspection, against 24.4.0 / 3.2.0)

| API used | Verdict |
| --- | --- |
| `MobileAds.getRequestConfiguration().toBuilder()` / `setRequestConfiguration` | present |
| `RequestConfiguration.Builder.setTestDeviceIds(List<String>)` | present |
| `MobileAds.initialize(Context, OnInitializationCompleteListener)` | present |
| `AdRequest.Builder().addNetworkExtrasBundle(AdMobAdapter.class, extras)` | present; `com.google.ads.mediation.admob.AdMobAdapter` ships in `play-services-ads` (not in `-lite`) — the full artifact is what we depend on |
| `AdView` + `setAdUnitId` / `setAdSize` / `loadAd` / `pause` / `resume` / `destroy` | present |
| `AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(Context,int)` | present; `AdSize.BANNER` fallback |
| `AdListener.onAdLoaded` / `onAdFailedToLoad(LoadAdError)` | present |
| `InterstitialAd.load(Context,String,AdRequest,InterstitialAdLoadCallback)` | present |
| `InterstitialAd.show(Activity)` / `setFullScreenContentCallback` | present; `show` requires an Activity, which the plugin passes |
| `FullScreenContentCallback` dismissed/failed/showed | present |
| `AdError.getCode()` + `AdRequest.ERROR_CODE_*` | present |
| `UserMessagingPlatform.getConsentInformation(Activity)` | present |
| `ConsentRequestParameters.Builder` + `ConsentDebugSettings.Builder` | present |
| `ConsentInformation.requestConsentInfoUpdate(Activity, params, success, failure)` | present |
| `UserMessagingPlatform.loadAndShowConsentFormIfRequired(Activity, listener)` | UMP ≥ 2.1 — satisfied by 3.2.0 |
| `UserMessagingPlatform.showPrivacyOptionsForm(Activity, listener)` | UMP ≥ 2.1 — satisfied |
| `ConsentInformation.canRequestAds()` / `getPrivacyOptionsRequirementStatus()` | UMP ≥ 2.1 — satisfied |

No removed, renamed or future API is referenced. ANDROID-BUILD-T10 fails the
suite if an import ever strays outside this surface (and specifically bans the
legacy `ads.reward`, `ads.doubleclick`, `ads.formats` and `ads.appopen`
packages).

## 6. Lifecycle safety

- `handleOnDestroy` destroys the banner and clears any warm interstitial, so a
  destroyed Activity can never be used to present one.
- `BannerAdController` holds no Activity field: the Activity is a method
  parameter only, and `destroy()` nulls the AdView and detaches the container,
  so no dead Activity is retained.
- `InterstitialAdController` clears its ad reference **before** `show()` and on
  `clear()`, so a stale ad cannot survive an Activity recreation.
- `showing`/`loading`/`initialized`/`initializing` flags prevent overlap and
  double initialization; the WebView-side guard in `admob-bridge.ts` prevents
  it again after a bridge reload.
- Every SDK call is dispatched with `runOnUiThread`, as the SDK requires.

Residual risk: these are the correctness arguments for the code as written.
Real Activity-recreation behaviour is only provable on a device.

## 7. R8 / ProGuard

Phase 14.1 **removed** the blanket `-keep class com.google.android.gms.ads.**`
and `-keep class com.google.android.ump.**` rules. Both SDKs ship consumer
rules inside their AARs; blanket keeps only defeat shrinking. What remains, and
why:

| Rule | Reason |
| --- | --- |
| `-keep @com.getcapacitor.annotation.CapacitorPlugin class com.synctogether.com.ads.** { *; }` | Capacitor resolves the plugin by class and reads its annotation; R8 sees no call site |
| `-keepclassmembers ... @com.getcapacitor.PluginMethod <methods>; public <init>(...);` | bridge methods and the no-arg constructor are invoked reflectively |
| `-keepattributes *Annotation*` | the plugin name lives in the annotation and must survive |

Debug keeps `minifyEnabled false` so a shrink regression is never masked
locally; the release variant is the only place R8 runs, and CI compiles it.

## 8. CI compilation gate

`.github/workflows/android-build.yml` runs on any change under `android/`:
JDK 21 → Android SDK (`platforms;android-36`, `build-tools;36.0.0`) → bun
install → `bun run build` → `cap sync android` → static build-blocker tests →
`./gradlew assembleDebug` → `./gradlew assembleRelease` (unsigned, to exercise
R8 and the keep rules). It uses no secrets, needs no keystore, and publishes
nothing.

## 9. Local build procedure (PowerShell)

```powershell
# Prerequisites: JDK 21, Android SDK with platform 36 + build-tools 36.0.0,
# ANDROID_HOME set.
bun install
bun run build
bunx cap sync android
cd android
./gradlew assembleDebug          # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # unsigned unless the keystore env vars are set
```

Release AAB (owner only, real keystore required):

```powershell
$env:ANDROID_KEYSTORE_PATH="C:\keys\synctogether.jks"
$env:ANDROID_KEYSTORE_PASSWORD="..."
$env:ANDROID_KEY_ALIAS="..."
$env:ANDROID_KEY_PASSWORD="..."
$env:VERSION_CODE="1"
./gradlew bundleRelease          # -> app/build/outputs/bundle/release/app-release.aab
```

Without those variables the bundle is unsigned and Play rejects it. No keystore
exists in this repository and none was invented.

## 10. Changes made in Phase 14.1

1. `android/app/proguard-rules.pro` — removed two blanket SDK keeps; replaced
   the plugin keep with annotation-scoped rules plus `-keepattributes`.
2. `android/gradle.properties` — raised the Gradle daemon heap from 1536m to
   4096m (with 1024m metaspace); R8 full mode with the Mobile Ads + UMP SDKs
   commonly exhausts the Capacitor default and fails the release build.
3. `src/lib/ads/android-build.test.ts` — 15 static build-blocker checks.
4. `.github/workflows/android-build.yml` — the compilation gate.

No dependency version, native API, ad placement, consent path or Premium rule
was changed.
