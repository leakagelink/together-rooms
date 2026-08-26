# SyncTogether — Android AdMob Bridge & Validation (Phase 14)

Phase 13.1 configured the real AdMob identifiers but explicitly left the native
Android bridge outside the verified boundary. **At the start of Phase 14 there
was no native ad implementation at all**: `MainActivity` was an empty
`BridgeActivity`, no Google Mobile Ads dependency existed, and
`window.SyncTogetherAds` was never provided by anything. Phase 14 implements
that missing layer and documents exactly what is and is not verified.

## 1. Native bridge architecture

```
android/app/src/main/java/app/lovable/synctogether/
  MainActivity.java              registers the plugin (single entry point)
  ads/AdsPlugin.java             Capacitor plugin "SyncTogetherAds"
  ads/BannerAdController.java    one AdView, adaptive size, strict teardown
  ads/InterstitialAdController.java  preload/show/dismiss, single-use
  ads/ConsentController.java     UMP: raw state only, no decisions
  ads/AdErrorMapper.java         AdError -> short token (no vendor text)
  ads/AdUnitIds.java             native-side id validation
```

The plugin is deliberately "dumb". It owns SDK mechanics only: it never selects
an ad unit, never decides eligibility, never retries by itself, and never
reports an impression that did not happen. Every policy decision (Premium, UMP
consent, placement allow-list, frequency caps, 90 s warm-up) is made in the web
layer before a plugin method is called.

## 2. Complete call path

```
Component (AdSlot / room-leave handler)
  → useAds()                       src/hooks/useAds.tsx
      premium (server entitlement), UMP consent, activity flags
  → AdProvider.evaluate/request    src/lib/ads/provider.ts
      placement allow-list          src/lib/ads/placement-map.ts
      policy                        src/lib/ads/placement.ts
      frequency caps                src/lib/ads/frequency.ts
      unit selection                src/lib/ads/config.ts + admob-production.ts
  → AdSdk (createNativeAdSdk)      src/lib/ads/admob-bridge.ts
      unit-id validation, banner single-instance, no fullscreen stacking
  → NativeAdsBridge                window.SyncTogetherAds  OR
                                   Capacitor plugin adapter
                                   src/lib/ads/capacitor-ads-bridge.ts
  → AdsPlugin.java (Capacitor)
  → Banner/Interstitial/Consent controllers
  → Google Mobile Ads SDK / UMP SDK
```

Failure at any boundary means **no ad**, never a fake success. A partial bridge
(any required method missing) is treated as no bridge.

## 3. SDK dependencies

`android/variables.gradle`

```
playServicesAdsVersion = '24.4.0'
userMessagingPlatformVersion = '3.2.0'
```

`android/app/build.gradle`

```
implementation "com.google.android.gms:play-services-ads:$playServicesAdsVersion"
implementation "com.google.android.ump:user-messaging-platform:$userMessagingPlatformVersion"
```

The Mobile Ads SDK contributes the `com.google.android.gms.permission.AD_ID`
permission from its own manifest; this is expected and is declared in the Play
Data Safety form. R8 is enabled for release; `proguard-rules.pro` keeps the ad
bridge classes reachable through Capacitor's reflective plugin loading.

`MobileAds.initialize` is called from exactly one place (`AdsPlugin.initialize`),
guarded natively (`initialized` / `initializing`) **and** in JS
(`initializeNativeAds` in `admob-bridge.ts`), so a remount, route change or
activity recreation cannot initialize twice.

## 4. App ID location

`ca-app-pub-1475323931624357~5237247287` exists in exactly two places:

| Where | Purpose |
| --- | --- |
| `android/app/src/main/res/values/strings.xml` → `admob_app_id` | the authoritative native value, `translatable="false"`, `~` unescaped |
| `src/lib/ads/admob-production.ts` → `PRODUCTION_ADMOB_APP_ID` | the value the release auditor checks against |

`AndroidManifest.xml` references `@string/admob_app_id` for
`com.google.android.gms.ads.APPLICATION_ID`. Debug builds do not override it
(`applicationIdSuffix .debug` changes the package, not the AdMob id), so debug
and release resolve the same, valid app id.

## 5. Banner lifecycle

1. `AdSlot` (rooms list only) asks the provider to evaluate `rooms_list_footer`.
2. If eligible, `createNativeAdSdk.showBanner(unitId, nonPersonalized)`.
3. `BannerAdController.show` destroys any existing AdView, creates exactly one,
   uses `getCurrentOrientationAnchoredAdaptiveBannerAdSize` (falling back to
   `AdSize.BANNER`), attaches it at the bottom of the content frame, and loads.
4. Load failure → the view is removed entirely; no reserved blank space, no
   layout shift, error reduced to a token.
5. Leaving the rooms list, going Premium, or losing consent → `hideBanner`
   → `destroy()` (idempotent).
6. `handleOnPause` / `handleOnResume` pause and resume the AdView;
   `handleOnDestroy` destroys it, so activity recreation cannot leak a view or
   leave two banners.

## 6. Interstitial lifecycle

Only trigger: `room_session_ended`, after `navigate({ to: "/rooms" })` has
already run.

- `preloadInterstitial` loads but **never** shows.
- `showInterstitial` uses a warm ad if one exists, otherwise loads once and
  shows if it arrives; either way the promise resolves and navigation is never
  awaited on it.
- The ad reference is cleared *before* `show()`, so a dismissal cannot re-show.
- `showing` prevents overlapping presentations; the JS side additionally
  prevents stacked `showFullscreen` calls.
- `onAdDismissedFullScreenContent` performs **no navigation** — the app already
  moved on, so dismissal cannot cause a duplicate transition.
- `clear()` on destroy discards stale ads after activity recreation.
- Warm-up (90 s), spacing (180 s) and the 2-per-session cap remain enforced in
  `frequency.ts`; the native layer cannot bypass them because it is never
  called unless the provider approved the request.

## 7. Test modes

Exactly two supported modes, both explicit:

| Mode | How | Units used |
| --- | --- | --- |
| **A. Demo units** | any development/preview build | Google's official demo units only; production ids are ignored, never merged |
| **B. Registered test device** | set `VITE_ADMOB_TEST_DEVICE_IDS` to the hashed device id(s) | the **real** production units, served as test ads |

`resolveAdTestMode` (`src/lib/ads/test-devices.ts`) enforces that a production
build is never globally forced into test mode: registering a device sets
`RequestConfiguration.setTestDeviceIds` and nothing else. An ordinary
production device with no configured id resolves to `live`. Malformed ids are
dropped rather than passed to the SDK, so a tester can never believe they are
protected when they are not.

## 8. Test-device registration procedure (manual)

1. Install the build on the device and open a screen that requests an ad
   (the rooms list).
2. In `adb logcat`, find:
   `Use RequestConfiguration.Builder().setTestDeviceIds(Arrays.asList("33BE2250B43518CCDA7DE426D04EE231"))`.
3. Put that 32-char id in `VITE_ADMOB_TEST_DEVICE_IDS` (comma-separate several).
4. Rebuild and reinstall.
5. Confirm every ad shows the **"Test Ad"** label before clicking anything.

Never click an ad on an unregistered device. Unlabelled ad = do not touch.

## 9. Ad Inspector procedure (manual)

Ad Inspector ships inside `play-services-ads` 24.x; no custom tooling exists or
should be built.

1. Register the device (section 8) — Ad Inspector only opens on a test device.
2. Launch the app and let UMP consent resolve (accept, to make requests
   eligible).
3. Generate a request: open the rooms list (banner), then leave a room after
   the 90 s warm-up (interstitial).
4. Invoke Ad Inspector: shake the device, or call
   `MobileAds.openAdInspector(context, listener)` from a debug-only build.
5. Inspect the request list; open the most recent banner/interstitial request.
6. Verify the ad unit id matches `.../9884842805` (banner) or `.../3102038535`
   (interstitial), and that the app id is `...~5237247287`.
7. Inspect the load/failure state and the request/response details for that
   unit.

**Ad Inspector has not been run.** This is a documented procedure only.

## 10. Demo ad procedure (manual)

1. Build with `bun run build:dev` (development environment).
2. Confirm requests use `ca-app-pub-3940256099942544/...` units — the code
   makes this the only possible outcome for a development build.
3. Exercise banner and interstitial; demo units always fill, which is the right
   way to validate layout, lifecycle and pacing without touching real
   inventory.

## 11. Production ad safety

| Control | Where |
| --- | --- |
| No production clicks while testing | demo units in dev; registered test devices for real units; "Test Ad" label check |
| Test mode is explicit | `resolveAdTestMode`; no runtime or remote toggle |
| Invalid-traffic protection | never click unlabelled ads; no self-clicking; no incentivized clicks; no ads adjacent to controls |
| Premium never requests | SDK not initialized; `NO_AD_PREMIUM` short-circuits; live banner torn down on upgrade |
| Unresolved consent = no request | `mayInitializeAds` blocks init; policy denies; native consent failure resolves to unresolved |
| Forbidden surfaces cannot call the bridge | placement allow-list runs first in `AdProvider.evaluate` |
| Malformed unit id = no request | validated in `config.ts`, again in `admob-bridge.ts`, again in `AdUnitIds.java` |
| Unknown placement = no request | `NO_AD_PLACEMENT_NOT_APPROVED` / `NO_AD_TRANSITION_NOT_APPROVED` |
| No rapid retry loops | no retry logic anywhere in the bridge; a failure is a non-event; banners are single-instance and interstitials single-use |
| Ad failure cannot block the app | all bridge promises are caught and discarded; navigation never awaits an ad |

## 12. Release build procedure

```powershell
# 1. Build the web app
bun install
bun run build

# 2. Sync the Android project
bunx cap sync android

# 3. Debug APK (unsigned by Play, debug-keystore signed)
cd android
./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk

# 4. Release AAB (requires the owner's keystore, see section 13)
$env:ANDROID_KEYSTORE_PATH="C:\keys\synctogether.jks"
$env:ANDROID_KEYSTORE_PASSWORD="..."
$env:ANDROID_KEY_ALIAS="..."
$env:ANDROID_KEY_PASSWORD="..."
$env:VERSION_CODE="1"
./gradlew bundleRelease
# -> android/app/build/outputs/bundle/release/app-release.aab
```

Without those environment variables `bundleRelease` produces an **unsigned**
bundle that Play will reject. No keystore exists in this repository and none
was invented.

## 13. Signed AAB owner requirements

**RELEASE SIGNING OWNER ACTION REQUIRED.**

The owner must: create the upload keystore, store it outside the repository,
enrol in Play App Signing, and supply `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` and
`VERSION_CODE` to the build environment. A lost upload key can be reset through
Play support only if App Signing is enabled — do that first.

## 14. Manual real-device matrix

### A. Banner

| # | Case | Expected |
| --- | --- | --- |
| A1 | Eligible free user, rooms list | One labelled banner at the bottom, below content |
| A2 | Premium user | No banner, no SDK initialization |
| A3 | Consent accepted (personalized) | Personalized request, ad renders |
| A4 | Consent denied / limited | Denied → no request; limited → non-personalized ad |
| A5 | Unresolved consent (form dismissed/failed) | No request at all |
| A6 | Network offline | No ad, no error UI, app fully usable |
| A7 | Forced load failure | No blank space, no layout shift |
| A8 | Background → foreground | Banner pauses/resumes, no duplicate |
| A9 | Rotation / "Don't keep activities" | Exactly one banner, no leaked view |
| A10 | Navigate away from rooms list | Banner destroyed |

### B. Interstitial

| # | Case | Expected |
| --- | --- | --- |
| B1 | Leave room before 90 s session warm-up | No ad |
| B2 | Leave room after warm-up | Interstitial may show, after navigation |
| B3 | Second room end within 180 s | No ad |
| B4 | Spacing elapsed | Ad may show |
| B5 | Third eligible transition in a session | No ad (cap = 2) |
| B6 | No ad available (no fill) | Silent skip, user already on rooms list |
| B7 | Ad dismissed | Returns to rooms list; no extra navigation |
| B8 | Rotation during/around the ad | No stale or duplicate show |
| B9 | Android back during the transition | Navigation wins; ad never blocks |

### C. Test safety

| # | Case | Expected |
| --- | --- | --- |
| C1 | Development build | Google demo units only |
| C2 | Registered test device on a production build | Real units, "Test Ad" label |
| C3 | Ad Inspector | Opens; unit ids match section 4/9 |
| C4 | Before any click | "Test Ad"/test-mode indicator confirmed |

### D. Core regression on device

YouTube room sync · music room queue · study board · research resources ·
local media share · voice call · video call · Play Billing purchase ·
Premium restore (ads disappear) · Privacy options form reachable.

## 15. Known limitations

- No Gradle build, no APK and no AAB were produced in this environment; the
  Android toolchain and SDK are not installed here. The Java code is verified
  by inspection against the documented SDK APIs, not by compilation.
- No real device test, no Ad Inspector session and no live ad request has been
  performed. Nothing about fill, revenue or rendering is verified.
- The UMP debug geography is not forced; testers outside the EEA may not see a
  consent form unless they add a debug geography setting in a debug build.
- Ad Inspector is invoked by device shake or from a debug-only build; there is
  intentionally no in-app entry point in release.
