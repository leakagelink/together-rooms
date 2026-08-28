# SyncTogether — PLAY CONSOLE CONFIGURATION CHECKLIST

**Audit date:** 2026-08-27 (UTC). Everything below is an **owner action in a console or dashboard** — none of it can be done from the codebase. Verified app facts are quoted so the values can be copied directly.

---

## 0. Verified app identity

| Field | Value | Source |
|---|---|---|
| Application ID | `com.synctogether.com` | `android/app/build.gradle` |
| App name | SyncTogether | `capacitor.config.ts` |
| minSdkVersion | 24 (Android 7.0) | `variables.gradle` |
| targetSdkVersion | 36 | `variables.gradle` |
| Production origin | `https://together-rooms.lovable.app` | `capacitor.config.ts` |
| Declared permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS` (+ `AD_ID` merged in by the ads SDK) | `AndroidManifest.xml` |

## 1. Play Console — App content

- [ ] **Privacy policy URL**: `https://together-rooms.lovable.app/privacy` — **do not submit until the policy is rewritten** (see `RELEASE_BLOCKERS.md` C1).
- [ ] **App access**: choose "All or some functionality is restricted" and enter both reviewer accounts from `REVIEWER_ACCESS_PLAN.md`.
- [ ] **Ads**: **Yes, my app contains ads.**
- [ ] **Content rating questionnaire**: declare user-generated content **and** user-to-user communication (chat, notes, shared links, shared media). Expected outcome: Teen / PEGI 12+.
- [ ] **Target audience and content**: 13+. **Do not** opt into Designed for Families.
- [ ] **News app**: No.
- [ ] **COVID-19 apps**: No.
- [ ] **Data safety**: transcribe `docs/DATA_SAFETY_DRAFT.md` field by field.
- [ ] **Advertising ID declaration**: Yes — used for advertising/marketing.
- [ ] **Government apps**: No.
- [ ] **Financial features**: No.
- [ ] **Health**: No.
- [ ] **Account deletion URL**: `https://together-rooms.lovable.app/delete-account`.

## 2. AdMob console

- [ ] Confirm the app is linked to the AdMob account and the app ID in `AndroidManifest.xml` matches the AdMob app.
- [ ] Confirm the **banner** and **interstitial** ad units are active and match `src/lib/ads/admob-production.ts`.
- [ ] **Delete or leave inactive** the rewarded and app-open units — they ship in config but have no native controller (`RELEASE_BLOCKERS.md` M3).
- [ ] **Privacy & messaging → GDPR message**: publish a UMP/TCF message covering EEA + UK. Without a published message the consent form never appears and ads fail closed.
- [ ] **Privacy & messaging → US states message**: publish if serving US traffic.
- [ ] Register test devices so review/QA traffic does not count as invalid.
- [ ] Confirm ad content rating in AdMob is set to match a Teen-rated app.

## 3. Google Cloud Console — YouTube Data API

- [ ] The project's API key must remain restricted to **YouTube Data API v3** (API restrictions) with **Application restrictions = None**, since the key is used from a server function, not a browser or an Android package.
- [ ] Confirm the daily quota is adequate; search costs 100 units per call, so 10,000 units/day allows only ~100 searches. Request a quota increase before any real user volume.
- [ ] Keep the key stored as the `YOUTUBE_DATA_API_KEY` backend secret — never in client code.
- [ ] YouTube API Services ToS: the app must display links to Google's Privacy Policy and the YouTube Terms of Service. **Currently missing** — add them to the privacy page.

## 4. Firebase console (FCM)

- [ ] Confirm the Android app `com.synctogether.com` exists in the Firebase project and that `google-services.json` in the repo matches it.
- [ ] Confirm the service account behind the `FIREBASE_SERVICE_ACCOUNT` secret still has the Cloud Messaging role.
- [ ] Upload a notification icon/colour if the default is unsatisfactory.

## 5. Google Play billing (only if Premium ships)

- [ ] Create the subscriptions `synctogether.premium.monthly` and `synctogether.premium.yearly` with base plans and prices, and **activate** them.
- [ ] Link the Play developer account to a Google Cloud project and create a service account with the **Android Publisher** role; store its JSON as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
- [ ] Grant the service account "View financial data" and "Manage orders and subscriptions" in Play Console → Users and permissions.
- [ ] **Real-time developer notifications**: create the Pub/Sub topic, grant `google-play-developer-notifications@system.gserviceaccount.com` the Publisher role, and point the push subscription at `https://together-rooms.lovable.app/api/public/billing/rtdn` with OIDC authentication enabled.
- [ ] Add licence testers so purchases can be made without charges.
- [ ] Remember: none of this works until the **billing client library is integrated in the app** (`RELEASE_BLOCKERS.md` C3).

## 6. Domain / hosting

- [ ] Publish `https://together-rooms.lovable.app/.well-known/assetlinks.json` containing the package name and the **release signing key** SHA-256 fingerprint (take it from Play App Signing, not the local debug key). Required for the `autoVerify` App Links on `/invite/*` and `/auth/*`.
- [ ] Verify with `https://developers.google.com/digital-asset-links/tools/generator` after publishing.
- [ ] Confirm the production origin serves the app reliably — the Android shell loads it remotely, so an outage bricks the installed app (`RELEASE_BLOCKERS.md` M2).

## 7. Signing & release

- [ ] Enrol in Play App Signing and store the upload keystore securely (it is not in the repo, by design).
- [ ] Build a **release AAB** with ProGuard/R8 enabled and verify the ad, push, and WebView flows still work after minification — the rules exist but have never been validated on a shipped build.
- [ ] Set the version code/name for the first release.
- [ ] Roll out to **Internal testing** first and complete the on-device checks in `docs/PHASE14_2_RELEASE_GATE.md`.

## 8. Store listing assets (not in the repo)

- [ ] App icon 512×512, feature graphic 1024×500, at least 2 phone screenshots (4–8 recommended), short description (≤80 chars), full description.
- [ ] Screenshots must show the real app; do not show a Premium purchase screen if purchases are disabled for v1.
- [ ] Category: Entertainment or Social. Contact email required.

## 9. Order of operations

1. Fix the critical code/legal blockers (C1, C2, C4; decide C3).
2. Configure AdMob messaging + Cloud/YouTube + Firebase.
3. Publish `assetlinks.json`.
4. Complete App content and Data Safety.
5. Internal testing release + on-device gate.
6. Production rollout.
