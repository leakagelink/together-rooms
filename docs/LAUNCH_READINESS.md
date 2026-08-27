# SyncTogether — Phase 13 launch readiness

Status legend used throughout:

- **CODE VERIFIED** — asserted by automated tests / inspected source.
- **REAL DEVICE REQUIRED** — needs a physical Android device.
- **EXTERNAL SERVICE REQUIRED** — needs Play Console / Google Cloud / AdMob.
- **MANUAL CONFIGURATION REQUIRED** — a human must set a value we cannot set.

No item in this document is marked as passed. Nothing here has been executed on
a real device or against a real Google service.

---

## 1. Device test matrix

| Axis | Cases |
| --- | --- |
| Android version | minSdk 23 (Android 6), Android 10, Android 13 (notification permission), Android 14/15 (targetSdk 34+) |
| Device size | small phone (≤5.5"), standard phone, large phone (≥6.7"), 10" tablet |
| Network | stable Wi-Fi, mobile data, throttled 3G, airplane mode, Wi-Fi↔mobile switch mid-session, loss + reconnect |
| Lifecycle | foreground, background 30s / 10min, process death (Don't keep activities), force close, cold reopen, rotation |

For every combination record: app launch, room join, realtime propagation, call
audio, playback sync drift after resume.

## 2. Room manual tests

Create room · join by code · join by invite link · expired invite · replayed
(already used) invite · host transfer · host leaves · host ends room · member
removal while active · blocked user attempts join · capacity limit at plan
boundary · reconnect after network loss · two simultaneous joins on the last
free seat.

Expected in every case: the server decides, the UI follows; a revoked member
loses realtime rows immediately.

## 3. YouTube playback validation (REAL DEVICE REQUIRED)

Embedded load · first-play user gesture requirement in Android WebView · play ·
pause · seek · two-device sync · resync after reconnect · background behaviour
(playback suspended) · foreground resync · unavailable video · non-embeddable
video · Made-for-Kids video (plays, analytics suppressed — it is **not**
blocked) · player controls reachable · no overlay covering the player.

Compliance claims beyond this list are not made.

## 4. Music room validation

Queue add/reorder/remove · playlist load · two members mutating concurrently ·
join and leave during playback · sync · reconnect · background · entitlement
limits at the free/premium boundary.

## 5. Study/research validation

Shared notes · simultaneous edits (revision conflict) · tasks · focus timer
across devices · realtime propagation · reconnect · revoked member loses access
· offline then reconnect recovery.

## 6. Local media validation (REAL DEVICE REQUIRED)

System picker permission behaviour · photo · video · transport establishment ·
unauthorised access attempt (non-member) · member removed mid-session · owner
disconnect · session expiry · reconnect · cleanup on end.

## 7. Voice/video validation (REAL DEVICE REQUIRED)

Microphone permission grant/deny/permanently-deny · camera the same ·
permission revoked from Settings while in a call · start · join · leave ·
reconnect · background/foreground · Wi-Fi↔mobile switch · member removed during
call · room ended during call · stale signalling after expiry.

No call quality metrics are claimed; none have been measured.

## 8. Google Play Billing real test plan (EXTERNAL SERVICE REQUIRED)

Setup: Play Console app → internal testing track → upload signed AAB → add
license testers → create subscription + base plan matching
`GOOGLE_PLAY_PREMIUM_PRODUCT_ID` → link Play Developer API service account.

| ID | Scenario | Expected |
| --- | --- | --- |
| BILLING-REAL-T1 | New purchase | Server verifies, entitlement premium, purchase acknowledged |
| BILLING-REAL-T2 | Cancellation | Entitlement flagged cancel-at-period-end, access until expiry |
| BILLING-REAL-T3 | Restore / reopen app | Entitlement restored from server, no re-purchase |
| BILLING-REAL-T4 | Duplicate verification | Idempotent, single entitlement, no duplicate event |
| BILLING-REAL-T5 | Pending purchase | No entitlement until settled |
| BILLING-REAL-T6 | Acknowledgement | `billing_ack_state` reaches `acknowledged`, envelope purged |
| BILLING-REAL-T7 | Ack failure + retry | Row stays pending with backoff; reconcile worker settles it |
| BILLING-REAL-T8 | Entitlement refresh | Client reflects server state after app restart |
| BILLING-REAL-T9 | Expiry lifecycle | Entitlement expires, ads resume |

None of these have been run.

## 9. RTDN / Pub/Sub validation (EXTERNAL SERVICE REQUIRED)

Setup: Google Cloud project → Pub/Sub topic → grant
`google-play-developer-notifications@system.gserviceaccount.com` publisher →
Play Console Monetization setup → topic name → push subscription to
`https://together-rooms.lovable.app/api/public/billing/rtdn` with an OIDC
service account and audience matching the endpoint URL; that service account
email must equal `RTDN_SERVICE_ACCOUNT_EMAIL`.

| ID | Scenario | Expected |
| --- | --- | --- |
| RTDN-REAL-T1 | Valid notification | 200, event applied |
| RTDN-REAL-T2 | Missing/invalid OIDC token | 401, nothing applied |
| RTDN-REAL-T3 | Duplicate message id | Idempotent, single application |
| RTDN-REAL-T4 | Delayed/out-of-order | Lower sequence ignored, state uncorrupted |
| RTDN-REAL-T5 | Temporary 5xx | Pub/Sub retries, eventual success |
| RTDN-REAL-T6 | Payload contradicts Play | Play Developer API verification wins |

## 10. AdMob validation (EXTERNAL SERVICE REQUIRED)

Requires an AdMob account, app id and three production unit ids
(banner/interstitial/app-open). Until then production ads stay disabled by
design. Validate with Google's official test units in a debug build: SDK init ·
consent gating · test banner · test interstitial · premium suppression ·
frequency caps · load failure handling · activity recreation · and the
suppression rules — **no ad during an active room, playback, call, local media
session or any sensitive flow**.

Missing today: AdMob app id, three production ad unit ids.

## 11. UMP validation (REAL DEVICE REQUIRED)

Consent required (EEA/UK geography) · consent not required · accepted ·
personalisation refused · consent refreshed · privacy options entry point in
Settings → Privacy · consent changed after the fact · error/unresolved state
(ads stay off). Advertising consent is tracked separately from analytics
consent and neither implies the other.

## 12. App Links validation

Manifest declares verified links for `together-rooms.lovable.app` on `/invite/`
and `/auth/` only. Requires `/.well-known/assetlinks.json` on the deployed
domain containing the **release** signing certificate SHA-256 fingerprint (Play
App Signing gives the correct one after the first upload). Debug builds will not
auto-verify unless their fingerprint is also listed.

Validate: invite link opens the app · auth redirect returns to the app ·
pending destination restored after sign-in · expired invite shows the expiry
state · malformed/foreign links are rejected (CODE VERIFIED, `PHASE13-T6`).

## 13. Android permission audit

| Permission | Why | When requested | Runtime? | If denied | Removable? |
| --- | --- | --- | --- | --- | --- |
| INTERNET | All app traffic | Install time | No | App cannot function | No |
| ACCESS_NETWORK_STATE | Reconnect/offline handling | Install time | No | Degraded recovery UX | No |
| CAMERA | Video calls | On "enable camera" | Yes | Voice-only call; everything else works | Only if video calls are dropped |
| RECORD_AUDIO | Voice/video calls | On joining a call with mic | Yes | Cannot speak; can still watch/chat | Only if calls are dropped |
| MODIFY_AUDIO_SETTINGS | Call audio routing | Install time | No | Poor routing during calls | With calls |

No storage permission is declared: local media uses the system picker (SAF),
which grants per-file access. No location, contacts, SMS, or background
permissions. Camera and microphone hardware are declared `required="false"` so
tablets without them can still install.

## 14. Release artifact checklist (MANUAL)

- [ ] `./gradlew bundleRelease` produces an AAB
- [ ] Signed with the release keystore (not debug)
- [ ] `applicationId = com.synctogether.com`
- [ ] `versionCode` strictly greater than the previous track upload
- [ ] `versionName` semantic `MAJOR.MINOR.PATCH`
- [ ] `debuggable=false`, WebView debugging off, cleartext off
- [ ] minSdk 23 / targetSdk ≥ 34
- [ ] No test ad units, no test product ids, no development backend URL
- [ ] No development secrets in the bundle
- [ ] Install the release artifact on a device and launch it

The configuration half of this list is machine-checked by
`auditReleaseCandidate` (`PHASE13-T7`, `PHASE13-T10`). Artifact generation and
inspection remain manual.

## 15. Play Store policy readiness

- **UGC**: in-app reporting, blocking, moderation actions, admin RBAC queue,
  message removal with an admin-only archive. Requires a published contact for
  abuse reports.
- **Chat/social**: report + block + moderator tooling present.
- **Camera/mic**: requested only from the action that needs them, with in-app
  rationale.
- **Local media**: transported peer-to-peer for the session, never stored.
- **Billing**: subscriptions via Play Billing only; entitlement is
  server-authoritative; restore is automatic.
- **Ads**: suppressed for premium users and in every sensitive flow; UMP gated.
- **Privacy**: account deletion request pipeline, data export, consent controls,
  ad privacy options.

## 16. Information required from the product owner

1. Published Privacy Policy URL and Terms of Service URL.
2. Legal entity name, jurisdiction, and support/abuse contact email.
3. Data retention decisions beyond what the code enforces.
4. AdMob app id + three production ad unit ids.
5. Play subscription product id, base plan, prices, free-trial policy.
6. Refund and cancellation statement for the store listing.
7. Age rating questionnaire answers and target audience declaration.
8. Whether an external crash-monitoring vendor will be connected (and its DPA).
9. Confirmation of the two owner-review Data Safety answers (advertising id,
   diagnostics).

## 17. Crash monitoring

The vendor-neutral adapter (`src/lib/observability/monitor.ts`) with redaction
and a crash boundary is **READY TO CONNECT**. No SDK is installed and nothing is
**ACTIVELY MONITORED IN PRODUCTION**. Connecting one requires a vendor DSN/key
and a Data Safety update for diagnostics.

## 18. Low-end device / performance plan

Low-memory device (2GB, Go edition) · CPU throttled · 3G profile · room with the
maximum plan member count · 1000+ message chat history scroll · 200-item
playlist · 20 background/foreground cycles · 10 forced reconnects. Record
cold-start time, memory, dropped realtime events, sync drift. No capacity
numbers are claimed until measured.

## 19. Final manual QA checklist

Each row: action → expected → pass/fail.

| Area | Action | Expected | Pass |
| --- | --- | --- | --- |
| AUTH | Sign up, verify, sign in, sign out, reset password | Session persists across restart | ☐ |
| PROFILE | Edit display name, avatar, bio; set visibility | Changes visible per privacy setting | ☐ |
| ROOMS | Create, join by code, leave, end | Server-authoritative state everywhere | ☐ |
| INVITES | Create, redeem, expire, replay | Replay and expiry rejected | ☐ |
| CHAT | Send, edit within 15 min, delete, react, paginate | Realtime to all members | ☐ |
| MODERATION | Report, block, remove message, mute, kick | Enforced immediately | ☐ |
| YOUTUBE | Load, play, pause, seek, resync | Two devices stay in sync | ☐ |
| MUSIC | Queue, reorder, advance, repeat, shuffle | Order authoritative | ☐ |
| STUDY | Notes, tasks, timer | Propagate in realtime | ☐ |
| LOCAL MEDIA | Share photo/video, end session | Nothing persisted afterwards | ☐ |
| VOICE | Join, mute, leave | Audio both ways | ☐ |
| VIDEO | Enable camera, toggle, leave | Video both ways | ☐ |
| BILLING | Purchase, restore, cancel | Entitlement matches Play | ☐ |
| ADS | Free user sees ads; premium never does | Suppression correct | ☐ |
| CONSENT | UMP flow and privacy options | Choice honoured | ☐ |
| PRIVACY | Export data, request deletion | Both complete | ☐ |
| ADMIN | Staff queue, actions, audit log | Non-staff denied | ☐ |
| APP LINKS | Invite link from another app | Opens in app | ☐ |
| LIFECYCLE | Background, kill, reopen | State recovered | ☐ |
| ERROR STATES | Force server error | Friendly message, no raw error | ☐ |
| NETWORK | Airplane mode then restore | Automatic reconnect | ☐ |
