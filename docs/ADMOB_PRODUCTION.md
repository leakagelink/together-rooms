# SyncTogether — AdMob Production Configuration (Phase 13.1)

Phase 11 built the ad architecture. Phase 13.1 wires the real AdMob account
into it **without weakening a single existing protection**.

## 1. AdMob App ID

| Item | Value |
| --- | --- |
| Application id | `ca-app-pub-1475323931624357~5237247287` |
| Native location | `android/app/src/main/res/values/strings.xml` → `admob_app_id`, referenced by `com.google.android.gms.ads.APPLICATION_ID` in `AndroidManifest.xml` |
| Web/TS location | `src/lib/ads/admob-production.ts` → `PRODUCTION_ADMOB_APP_ID` |

The `~` is part of the identifier. It is stored in a `translatable="false"`
string resource and is never XML-escaped. `isValidAdMobAppId` enforces the
`ca-app-pub-<16 digits>~<10 digits>` shape; anything else disables advertising.

Development builds resolve Google's sample app id
(`ca-app-pub-3940256099942544~3347511713`) and never the production one.

## 2. Ad unit configuration

| Format | Unit | Status |
| --- | --- | --- |
| Banner | `ca-app-pub-1475323931624357/9884842805` | **Enabled** |
| Interstitial | `ca-app-pub-1475323931624357/3102038535` | **Enabled** |
| Rewarded | `ca-app-pub-1475323931624357/5045675599` | **Configured, disabled** |
| App-open | — | Not configured, not used |

All ids live in exactly one module, `src/lib/ads/admob-production.ts`. No UI
component, hook or route contains an ad identifier. Build-time overrides
(`VITE_ADMOB_APP_ID`, `VITE_ADMOB_BANNER_UNIT`, `VITE_ADMOB_INTERSTITIAL_UNIT`,
`VITE_ADMOB_REWARDED_UNIT`, `VITE_ADMOB_APP_OPEN_UNIT`) exist for a secondary
AdMob account; when unset the constants above are used.

Ad unit ids are **public native identifiers**, not backend secrets: they ship
inside the APK. Server secrets (Play service account, billing recovery key,
scheduler secret) remain in environment secrets and are unrelated.

## 3. Rewarded ads — configured, not activated

`REWARDED_ADS_ENABLED = false` in `src/lib/ads/config.ts`.

There is no reward, no UI entry point, no request path and no remote-config
route to enable it: `mergeAdFrequency` ANDs the remote flag with the build
flag, and `evaluateAdPlacement` denies the format with
`NO_AD_REWARDED_DISABLED` before consent or frequency is even considered.
Activating it requires a deliberate product decision defining an explicit,
user-visible reward that is not Premium, not payment bypass, and not tied to
clicking an ad.

## 4. Production vs test separation (fail closed)

`resolveAdUnits(environment, configured)`:

- `development` → **only** Google's official test units, `testMode: true`.
  Production ids passed in are ignored, never merged.
- `production` → requires banner **and** interstitial, correctly shaped, and
  not test units. A missing, malformed, or test-shaped id returns
  `units: null` and a `configError`, and `units: null` means the placement
  policy denies with `NO_AD_NOT_CONFIGURED`.

There is no silent fallback in either direction. The release auditor
(`src/lib/release/artifact.ts`) reports the same problems as `ads:*` and blocks
a release candidate.

## 5. UMP / consent dependency

Unchanged from Phase 11 and still authoritative:

- consent is gathered **before** the Mobile Ads SDK is initialized;
- a failed gather is `unresolved`, never consent;
- advertising consent and analytics consent are independent;
- refusal of personalization serves non-personalized ads;
- the Privacy Options entry point stays reachable whenever UMP requires it;
- production ids do not bypass any of the above.

## 6. Premium suppression

Premium is server-authoritative (`useEntitlement`). For a Premium account the
Mobile Ads SDK is never initialized and `evaluateAdPlacement` denies every
format with `NO_AD_PREMIUM` before anything else is evaluated. If entitlement
is still loading, the snapshot is not premium-unknown-permissive — the policy
simply has no configured request path until the runtime settles, and no ad is
requested during a call/playback/sensitive flow regardless.

## 7. Placement map

| Screen | Ad allowed? | Format | Reason |
| --- | --- | --- | --- |
| Home / landing | No | — | Marketing + auth entry; launch surface |
| Auth (login/signup/reset) | No | — | Sensitive flow |
| Rooms list | **Yes** | Banner (footer) | Low-interaction browsing surface, ad sits below all content |
| Room create | No | — | Form entry |
| Room join | No | — | Form entry, code input |
| Room active | No | — | Live collaboration |
| Chat | No | — | Typing, message controls |
| YouTube room | No | — | Synchronized playback |
| Music room | No | — | Audio playback + queue controls |
| Playlist management | No | — | Interactive editing |
| Study / research board | No | — | Active task work |
| Notes | No | — | Text editing |
| Tasks | No | — | Active task work |
| Local media | No | — | Private media viewing/sharing |
| Voice call | No | — | Live call |
| Video call | No | — | Live call |
| Profile | No | — | Account surface |
| Settings | No | — | Controls and toggles; accidental-click risk |
| Privacy settings | No | — | Sensitive flow (consent) |
| Billing / subscription | No | — | Payment flow |
| Admin / moderation | No | — | Staff tooling, report handling |

Approved banner placements (allow-list in `src/lib/ads/placement-map.ts`):
`rooms_list_footer`.

Approved interstitial transitions: `room_session_ended` — after the user has
left a room and is back on the rooms list.

A placement string not on the allow-list is denied with
`NO_AD_PLACEMENT_NOT_APPROVED` / `NO_AD_TRANSITION_NOT_APPROVED`, so a new
screen can never inherit advertising by accident.

## 8. Forbidden ad flows

No ads on app launch, on app exit, while joining a room, during synchronized
playback, YouTube or music playback, voice/video calls, local media viewing or
sharing, typing, note editing, study/research task completion, permission
prompts, error handling, or immediately after a sensitive action. No app-open
ads, no native ads, no rewarded interstitials. Banners never float, never
overlay content and never sit adjacent to navigation, chat input or media
controls; the slot renders nothing at all when ineligible, so layout cannot
shift under a user's finger.

## 9. Frequency and session protections (unchanged)

`min_session_seconds_before_first_fullscreen: 90`,
`min_seconds_between_fullscreen: 180`, `max_fullscreen_per_session: 2`,
`min_seconds_after_app_open_ad: 120`, `app_open_enabled: false`. Remote config
may only be applied through `mergeAdFrequency`, which falls back to these
conservative defaults for any invalid value.

## 10. Automated coverage

`src/lib/ads/admob-production.test.ts` — ADMOB-PROD-T1 … T13 (app id
validation, unit boundary, rewarded disabled, dev/prod separation both ways,
invalid config fail-closed, Premium suppression, consent suppression,
sensitive-flow suppression, transition approval, banner placement approval,
rewarded load refusal).

## 11. What is NOT verified by code

| Level | Status |
| --- | --- |
| CODE VERIFIED | Configuration, policy, allow-lists, fail-closed behaviour, suppression logic — all covered by tests. |
| REAL DEVICE REQUIRED | SDK initialization, banner/interstitial rendering, UMP form display, activity recreation, background/foreground behaviour. |
| ADMOB NETWORK VERIFIED | Nothing. No live ad has been served or observed. |

### Required real-device test procedure

Run on a physical Android device with a release-configured build, using AdMob
**test devices** for anything that would otherwise touch production inventory.

1. Official test banner renders on the rooms list, below content, labelled.
2. Official test interstitial appears only after leaving a room, and only past
   the 90 s session warm-up.
3. Premium account: no SDK init, no banner, no interstitial anywhere.
4. Consent denied in the UMP form: no ad request at all.
5. Consent accepted (personalized): personalized request.
6. Personalization refused: non-personalized request, ads still serve.
7. Airplane mode: ad fails to load, app is unaffected, no error surfaced.
8. Forced ad load failure: no blank reserved space, no layout shift.
9. Activity recreation (rotate, "Don't keep activities"): no duplicate banner.
10. Background → foreground: no app-open ad, no interstitial on resume.
11. Frequency cap: third interstitial in a session is refused.
12. Sensitive flows: start a call, play a video, share local media, type in
    chat — no ad appears or persists in any of them.
13. Privacy Options entry point opens the UMP form from Privacy settings.

## 12. Production release checklist

1. AdMob app linked to `app.lovable.synctogether` in the AdMob console.
2. `admob_app_id` string resource matches the AdMob console value exactly.
3. Banner and interstitial units active in the AdMob console.
4. Rewarded unit exists but remains unused; `REWARDED_ADS_ENABLED` is `false`.
5. UMP consent message published and live.
6. `auditReleaseCandidate` reports no `ads:*` problems.
7. Test device ids registered for anyone doing pre-launch testing.
8. Full regression green; lint, typecheck and build clean.
