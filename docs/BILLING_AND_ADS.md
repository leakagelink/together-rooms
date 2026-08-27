# SyncTogether — Play Billing, RTDN, AdMob & UMP (Phase 11)

This document covers the production monetization path: how a purchase becomes
an entitlement, how Google tells us it changed, and how ads are gated by
consent.

## 1. Entitlement is server-authoritative

The device can only ever produce a **claim** (a product id plus a purchase
token). Nothing on the client decides plan, status, or expiry.

```
Play Billing (device)
  → claim { product_id, purchase_token }
  → verifyPurchase server function (authenticated, rate-limited)
      → Google Play Developer API verification
      → apply_billing_event RPC (idempotent, ordered)
      → server-side acknowledgement
  → entitlement snapshot
```

## 2. Product configuration

`src/lib/billing/products.ts` is the only source of product ids.

| Environment | Variable |
| --- | --- |
| Client | `VITE_PLAY_PREMIUM_PRODUCT_ID` |
| Server | `GOOGLE_PLAY_PREMIUM_PRODUCT_ID`, `GOOGLE_PLAY_ADDITIONAL_PRODUCT_IDS` |
| Both | `GOOGLE_PLAY_PACKAGE_NAME` (must equal `com.synctogether.com`) |

Rules enforced in code: no hard-coded ids anywhere, test-shaped ids are refused
in production builds, a package mismatch invalidates the whole configuration,
and an invalid configuration allows **no** product to be verified.

## 3. Verification and acknowledgement

`src/lib/billing/verification.server.ts`:

- authenticates to Google with the service account in
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (JWT → OAuth token, server-only),
- rejects any product not in the configured allow-list, before and after the
  Play call,
- maps Play's subscription state to a billing event,
- **acknowledges server-side, after the entitlement is granted.** Play
  auto-refunds unacknowledged purchases after three days; doing it on the
  server means acknowledgement can never be lost with the device. Pending
  purchases are never acknowledged, and acknowledgement failures never
  affect the entitlement — the next verification or RTDN retries.

Verification is fail-closed: an unverifiable claim records a
`verification_failed` audit event and grants nothing.

## 4. Real-time Developer Notifications

Endpoint: `POST /api/public/billing/rtdn` (`src/routes/api.public.billing.rtdn.ts`).

Security:

| Concern | Handling |
| --- | --- |
| Caller identity | Google-signed OIDC token: RS256 against Google JWKS, issuer, audience, verified service-account email, expiry |
| Payload trust | Notification is a trigger only; state always comes from a fresh Play verification |
| Replay | Pub/Sub `messageId` claimed in `play_rtdn_messages` before any work |
| Ordering | Play's `eventTimeMillis` becomes the event sequence; `apply_billing_event` refuses older sequences |
| Revocation | Applied only when Google's voided-purchases list confirms the void |
| Unknown tokens | Recorded and dropped; an owner is never guessed |
| Response body | Opaque; no account or entitlement data |

Retry contract: 2xx acknowledges (including permanently undecodable messages,
so they do not loop), 5xx asks Pub/Sub to redeliver.

Required server configuration: `PLAY_RTDN_AUDIENCE`,
`PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PLAY_PACKAGE_NAME`,
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. If the first two are missing the endpoint
rejects every request — it never opens up.

Pub/Sub push URL (stable):
`https://together-rooms.lovable.app/api/public/billing/rtdn`.

## 5. Ads: consent before anything

`src/lib/ads/consent.ts` implements the UMP state machine, and
`src/hooks/useAds.tsx` runs it at startup **before** the Mobile Ads SDK is
initialized.

- Ad consent and analytics consent are independent decisions.
- A failed consent gather is `unresolved`, never consent.
- The in-app "show ads" switch can only make the platform decision stricter.
- Personalization refused → non-personalized ads, not "no ads".
- The privacy options entry point (`AdPrivacyOptions`) stays reachable from
  Privacy settings whenever Google requires it.
- Premium accounts never initialize the ad SDK at all.

Placement policy (Phase 9, unchanged) still applies on top: no ads during
calls, playback, local media, typing, or sensitive flows, plus frequency caps
on full-screen formats.

Production identifiers were wired in Phase 13.1 — see **docs/ADMOB_PRODUCTION.md**
for the app id, the banner/interstitial units, the disabled rewarded unit and the
approved placement map.

Unit ids come from `VITE_ADMOB_BANNER_UNIT`, `VITE_ADMOB_INTERSTITIAL_UNIT`,
`VITE_ADMOB_APP_OPEN_UNIT`. Development builds may only use Google's official
test units; production builds with no configured units disable ads rather than
silently serving test ads.

## 6. Native bridges

The web build contains no billing or ad SDK. The Android shell injects:

- `window.SyncTogetherBilling` — `PlayBillingBridge` (purchase, queryPurchases,
  openManageSubscriptions),
- `window.SyncTogetherAds` — `NativeAdsBridge` (initialize, banner,
  interstitial, app-open) plus the UMP bridge.

Both are treated as untrusted: they can produce claims and show or fail to show
ads; they can never grant entitlement or assert consent state that the policy
depends on.

## 7. Test coverage

| Suite | Ids |
| --- | --- |
| `src/lib/billing/play-billing.test.ts` | PLAY-BILLING-T1 … T15 |
| `src/lib/billing/rtdn.test.ts` | RTDN-T1 … T8 |
| `src/lib/ads/admob.test.ts` | ADMOB-T1 … T12 |
| `src/lib/ads/ump.test.ts` | UMP-T1 … T6 |

## 8. Operational checklist before going live

1. Create the subscription product in Play Console; set
   `GOOGLE_PLAY_PREMIUM_PRODUCT_ID` and `VITE_PLAY_PREMIUM_PRODUCT_ID`.
2. Create a service account with Play Developer API access; store the JSON as
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
3. Create the Pub/Sub topic, set it as the RTDN topic in Play Console, and add
   a push subscription to the endpoint above with an OIDC service account;
   store its email and the audience.
4. Create AdMob units; set the three `VITE_ADMOB_*` variables.
5. Publish a UMP consent message in the AdMob privacy & messaging console.
6. Verify with a licence tester: purchase, renew, cancel, refund.
