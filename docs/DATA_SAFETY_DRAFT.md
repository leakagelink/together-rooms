# SyncTogether — Google Play DATA SAFETY DRAFT

**Audit date:** 2026-08-27 (UTC). Draft answers derived from code evidence only. Owner must confirm before submitting.

Definitions used: **Collected** = transmitted off the device. **Shared** = transferred to a third party that is not a processor acting on our instructions. Supabase and Firebase are treated as **processors** (collected, not shared). Google Mobile Ads is treated as a **third party** (collected **and** shared).

---

## 1. Data types

| Data type | Collected | Shared | Optional/Required | Purposes | Ephemeral | Evidence |
|---|---|---|---|---|---|---|
| **Name** (display name, username) | Yes | No | Optional | App functionality, Account management | No | `profiles`, `profile.tsx` |
| **Email address** | Yes | No | **Required** | Account management, App functionality | No | Supabase Auth, `auth.signup.tsx` |
| **User IDs** | Yes | No | Required | App functionality, Account management, Fraud prevention | No | `auth.users.id` used as FK across all tables |
| **Other personal info** (bio, avatar URL) | Yes | No | Optional | App functionality | No | `profiles.bio`, `profiles.avatar_url` |
| **Purchase history** | **No** | No | — | — | — | App is free: no subscriptions, no in-app purchases, no Google Play Billing integration. Dormant billing tables/migrations exist in the database but no client, server function or UI writes or reads them |
| **In-app messages** (room chat, reactions, notes, tasks, resource links, playlist names) | Yes | No | Optional | App functionality | No | `room_messages`, `room_notes`, `room_tasks`, `room_resources` |
| **Photos** | **No** | No | — | — | — | Device-to-device WebRTC data channel only; **never uploaded to our servers**. No storage bucket exists |
| **Videos** | **No** | No | — | — | — | same as above (`useLocalMediaTransfer.ts`) |
| **Audio files / voice** | **No** | No | — | — | — | same as above; no microphone permission, no recording |
| **Files & docs** | No | No | — | — | — | only local file names/sizes stay on device or move P2P |
| **App interactions** (screens opened, room actions) | Yes | No | Optional (consent-gated) | Analytics, App functionality | No | `analytics_events`, gated by `privacy_settings` |
| **Crash logs** | **No** | No | — | — | — | no crash SDK integrated |
| **Diagnostics / other app performance data** | Yes | No | Optional | App functionality, Diagnostics | No | server-side structured logs with redaction (`observability/`) |
| **Device or other IDs** (Advertising ID, FCM token, Firebase installation ID) | **Yes** | **Yes** (Advertising ID → Google Mobile Ads) | Required (AAID for ad serving); FCM token optional | Advertising/marketing, App functionality (push) | No | `play-services-ads` 24.4.0; `push_tokens`, `register_push_token` |
| **Approximate location** | Collected **by the ads SDK** (IP-derived) | Yes | Required for ad serving | Advertising/marketing | — | Declare per Google Mobile Ads guidance; the app itself has no location permission or code |
| **Precise location** | No | No | — | — | — | no location permission |
| **Contacts / Calendar / SMS / Call logs / Health / Financial info / Web browsing history / Installed apps** | No | No | — | — | — | no code path exists |

## 2. Security practices

| Question | Answer | Evidence |
|---|---|---|
| Is data encrypted in transit? | **Yes** | HTTPS-only; `usesCleartextTraffic="false"`, `network_security_config.xml` system CAs only; WebRTC DTLS/SRTP for P2P |
| Can users request data deletion? | **Yes** | In-app `settings` → delete account (`account.functions.ts`), plus the public page `https://together-rooms.lovable.app/delete-account` |
| Do you follow the Play Families policy? | **No** — app is not targeted at children | Content rating is 18 and over; MFK YouTube videos are playable but tracking-restricted (`media-policy.ts`) |
| Independent security review | **No** | none conducted |
| Committed to Play's Data Safety accuracy | Yes | — |

## 3. Account deletion URL (required field)

`https://together-rooms.lovable.app/delete-account`

The page is reachable without signing in (linked from the app footer, `app-shell.tsx`). It must state clearly:
- what is deleted immediately (profile, memberships, messages, notes, tasks, playlists, push tokens, settings),
- what is retained and for how long (moderation records and audit logs retained for legal/safety purposes — **owner must set an explicit retention period; none is currently documented**).

## 4. Declarations the owner must also complete

- **Advertising ID declaration**: Yes — the app uses the Advertising ID for advertising/marketing. `com.google.android.gms.permission.AD_ID` is merged in by the ads SDK.
- **Ads presence**: Yes — the app contains ads. Banner and interstitial are enabled; rewarded ads are configured but disabled; there are no app-open ads.
- **Target audience**: 18 and over. Not "Designed for Families".
- **Content rating questionnaire**: must declare **user-generated content with user-to-user communication** (chat, notes, resource links, shared media).
- **Data Safety "shared" section**: name Google (advertising) as the recipient.

## 5. Current product state (verified in source)

- Target audience: 18 and over (matches `src/routes/privacy.tsx`).
- No subscriptions, no in-app purchases, no Google Play Billing.
- AdMob banner and interstitial enabled; rewarded configured but disabled; no app-open ads.
- Account deletion, reporting, blocking, moderation and Child Safety Standards are all available in-app.
- Research browser and local (device-to-device) media sharing exist.

**Owner verification still required** for: exact retention periods for moderation/audit records, the
Advertising ID / approximate-location declarations required by the Google Mobile Ads SDK, and the
independent security review answer. These cannot be established from source code.
