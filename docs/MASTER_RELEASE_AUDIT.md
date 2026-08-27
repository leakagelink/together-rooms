# SyncTogether — MASTER A-TO-Z RELEASE & GOOGLE PLAY COMPLIANCE AUDIT

**Audit date:** 2026-08-27 (UTC)
**Method:** static inspection of the current repository + live queries against the production database + full test/lint execution. No production code was modified during this audit.
**Source of truth:** the current codebase and the live database only. Previous phase reports were NOT used as evidence.

Evidence notation used throughout:
`STATUS` / `EVIDENCE` / `RISK` / `ACTION`, plus the markers
`NOT VERIFIED`, `OWNER ACTION REQUIRED`, `EXTERNAL CONFIG REQUIRED`,
`REAL DEVICE TEST REQUIRED`, `REAL GOOGLE SERVICE TEST REQUIRED`,
`POTENTIAL POLICY RISK`, `CODE REMOVAL RECOMMENDED`.

---

## PART 0 — AUDIT BASELINE (what was actually inspected)

| Area | Inspected artefact | Result |
|---|---|---|
| Web app | 258 files under `src/` | inspected |
| Migrations | 46 files under `supabase/migrations/` | inspected |
| Live database | 52 public tables, 174 public functions, 63 triggers | queried live |
| Android | `android/app/build.gradle`, `variables.gradle`, `AndroidManifest.xml`, 6 Java files, `proguard-rules.pro`, `strings.xml`, `network_security_config.xml`, `data_extraction_rules.xml`, `google-services.json` | inspected |
| Capacitor | `capacitor.config.ts` | inspected |
| Tests | `bunx vitest run` — **47 files, 11 FAILED, 36 passed; 397 passed / 194 skipped** | executed |
| Lint | `bunx eslint .` — **108 problems (98 errors, 10 warnings)** | executed |
| Secrets | 6 configured: `BILLING_TOKEN_RECOVERY_KEY_V1`, `FIREBASE_SERVICE_ACCOUNT`, `LOVABLE_API_KEY`, `LOVABLE_CRON_SECRET`, `PUSH_DISPATCH_SECRET`, `YOUTUBE_DATA_API_KEY` | enumerated |

### Immediate baseline findings

**B1 — The automated test suite does NOT currently pass.**
STATUS: PARTIAL
EVIDENCE: `bunx vitest run` → `Test Files 11 failed | 36 passed (47)`, `Tests 397 passed | 194 skipped (591)`. Failing files are all live-database security suites: `scripts/security/{chat-security,entitlement-security,local-media-realtime,local-media-security,moderation-rbac,playback-security,provider-security,queue-concurrency,queue-security,research-realtime,research-security,security-integration}.test.ts`. Root cause observed in output: `AuthApiError: Request rate limit reached` at `scripts/security/security-integration.test.ts:36` (`signInWithPassword` while provisioning test users). 194 tests are skipped, not run.
RISK: HIGH — every database-behaviour assertion (RLS, RPC authorization, moderation RBAC, entitlement enforcement) is currently **unverified in this run**. Prior claims of "596 tests pass" are not reproducible today.
ACTION: FIX REQUIRED (throttle/stagger user provisioning or use pre-seeded fixture users) before any release gate is declared.

**B2 — Lint is failing.**
STATUS: PARTIAL
EVIDENCE: `bunx eslint .` → 98 errors / 10 warnings; e.g. `src/routes/_authenticated/rooms.$roomId.tsx:534`, `src/routes/_authenticated/settings.notifications.tsx:94,117,118`, `src/routes/delete-account.tsx:53`. 97 auto-fixable (`prettier/prettier`).
RISK: LOW (formatting only, no behaviour)
ACTION: FIX REQUIRED (`bunx eslint . --fix`) — cosmetic, but it means the repo is not in a clean release state.

---

## PART 1 — COMPLETE FEATURE INVENTORY

Full table: see **`docs/FEATURE_INVENTORY.md`**. Summary of the audited groups follows, with the findings that matter.

### A. Authentication
STATUS: IMPLEMENTED
EVIDENCE: `src/routes/auth.login.tsx`, `auth.signup.tsx`, `auth.forgot-password.tsx`, `auth.reset-password.tsx`; `src/hooks/useAuth.tsx`; route gate `src/routes/_authenticated/route.tsx:5-17` redirects to `/auth/login`. Terms/Privacy acceptance is enforced at signup: `src/routes/auth.signup.tsx:39,50-51,140-145` (`"Please accept the Terms and Privacy Policy to continue."`).
- **No social login is implemented.** Grep of `signInWithOAuth` / provider config: none. `android/app/google-services.json` contains **zero OAuth clients** (`"oauth": []`).
- **No anonymous sign-in.** No `signInAnonymously` call site.
- Account deletion: `src/lib/account.functions.ts:41-95` → `request_account_deletion` RPC → `account_deletion_requests` table → `purge_user_data` (service_role only) → `supabaseAdmin.auth.admin.deleteUser`. Public self-serve page exists at `src/routes/delete-account.tsx`, linked from the footer (`src/components/app-shell.tsx:192`).
- Data export: `src/lib/account.functions.ts:9-34` → `export_user_data()` RPC (SECURITY DEFINER, rate-limited).
RISK: LOW
ACTION: NO ACTION (code). Note for Play: the platform-recommended default of adding Google sign-in was **not** implemented — this is fine, but reviewers will need an email/password test account (Part 12).

### B. Rooms
STATUS: IMPLEMENTED
EVIDENCE: `src/routes/_authenticated/rooms.{index,new,join,$roomId}.tsx`; `src/lib/rooms.functions.ts`, `src/lib/invites.functions.ts`; tables `rooms`, `room_members`, `room_invites`, `room_sessions`, `room_events`; RPCs `join_room_by_code`, `create_room_invite`, `revoke_room_invite`, `redeem_room_invite`, `leave_room`, `transfer_room_host`, `end_room`, `set_room_capacity`, `admit_member`, `pick_room_successor`. Live DB: 7 rooms, 269 profiles.
Realtime: `authorize_room_channel(_room_id)` RPC gates channel access; `supabase_realtime` publication contains `rooms, room_members, room_events, room_messages, message_reactions, room_playback_state, room_media_queue, room_queue_settings, room_resources, room_notes, room_tasks, room_focus_timer, room_study_settings, room_local_media_sessions, notifications, room_call_sessions, room_call_participants`.
RISK: MEDIUM — `room_call_sessions` and `room_call_participants` are still in the realtime publication for a **removed** feature (see Part 14).
ACTION: REMOVE (dead call tables from publication + grants).

### C. Watch Together (YouTube)
STATUS: IMPLEMENTED
EVIDENCE: `src/components/room/watch-together.tsx`, `src/components/room/media-search-panel.tsx`, `src/lib/providers/youtube.ts`, `src/lib/media-policy.ts`, `src/lib/media-metadata.functions.ts`, `src/lib/media-search.functions.ts`, `src/lib/playback-sync.ts`, `src/lib/playback-device.ts`, `src/lib/youtube-compliance.ts`; tables `room_playback_state`, `media_metadata_cache`; RPCs `set_room_media`, `clear_room_media`, `can_control_playback`.
- **Provider: YouTube only.** `src/lib/providers/registry.ts:2-4` states no providers are pre-wired; only the YouTube provider module exists.
- **Data API v3** used server-side only: `src/lib/media-search.functions.ts:33-47` (`videoEmbeddable=true`, `safeSearch=strict`) and `src/lib/media-metadata.functions.ts`. Key read inside `.handler()` from `process.env["YOUTUBE_DATA_API_KEY"]` — **never reaches the browser**. Secret is configured.
- **Made for Kids:** `src/lib/media-policy.ts:16-60` — MFK videos stay playable but are marked `tracking_restricted`; `not_embeddable`, `privacy_blocked`, `unavailable`, `invalid`, and `provider_verification_failed` are all distinct and **fail closed** (`PLAYABLE_STATUSES = ["ok","made_for_kids"]`).
- **Background behaviour:** `src/lib/youtube-compliance.ts` + a `visibilitychange` handler pause the embedded player locally when the app is hidden; server state is untouched. `android/.../MainActivity.java:57-66` deliberately keeps the WebView alive on `onPause()` for **local media** audio, with an in-file comment stating the web layer pauses YouTube first.
RISK: MEDIUM — the "web layer pauses YouTube before the native `onPause` override runs" guarantee is an **ordering assumption that has never been verified on a real device**. If `visibilitychange` does not fire before/at `onPause` on some OEM builds, YouTube audio continues in the background → direct YouTube API ToS breach.
ACTION: REAL DEVICE TEST REQUIRED.

### D. Music
STATUS: IMPLEMENTED
EVIDENCE: `src/components/room/music-room.tsx`, `src/hooks/useRoomQueue.ts`, `src/lib/queue.functions.ts`, `src/lib/playlists.functions.ts`, `src/lib/queue-rules.ts`; tables `room_media_queue`, `room_queue_settings`, `playlists`, `playlist_items`; RPCs `add_to_queue`, `advance_queue`, `clear_queue`, `approve_queue_item`, `apply_queue_item`, `bump_queue_version`, `create_playlist`, `add_playlist_item`.
**The music provider is YouTube.** There is no Jamendo/Audius/Spotify integration. Audio-only mode renders a compact but still-visible player (`watch-together.tsx` `audioMode`), enforced by `verifyPlayerVisibility` in `src/lib/youtube-compliance.ts`.
RISK: MEDIUM — POTENTIAL POLICY RISK: an app whose "Music" mode is a minimised YouTube embed is close to the line YouTube draws around background/audio-only consumption. Code-level guards exist; the *product framing* is what a reviewer judges.
ACTION: OWNER DECISION REQUIRED (store listing must not describe this as a music/audio player — see Part 16).

### E. Local Media
STATUS: IMPLEMENTED
EVIDENCE: `src/components/room/local-media-room.tsx`, `local-media-queue.tsx`, `local-media-preflight.tsx`, `local-media-diagnostics.tsx`; `src/hooks/useLocalMedia.ts`, `useLocalMediaTransfer.ts`; `src/lib/local-media/{transport,chunking,resume,sync,limits,permissions,capability,diagnostics,analytics-safety}.ts`; `src/lib/local-media.functions.ts`; tables `room_local_media_sessions`, `room_local_media_settings`, `local_media_transport_grants`, `local_media_signals`.
- **Transport:** browser `RTCPeerConnection` + `RTCDataChannel` **for file bytes only** (`useLocalMediaTransfer.ts:190,309,383,397`). No `addTrack`, no `getUserMedia` anywhere.
- **No permanent hosting.** No Supabase Storage bucket exists in the project; media never leaves the peers. Limits: `MAX_SESSION_BYTES = 4 GiB`, `CHUNK_BYTES = 16 KiB`, `MAX_IMAGE_ITEMS = 50`, `MAX_QUEUE_ITEMS = 20`, `SESSION_MAX_MINUTES = 120` (`src/lib/local-media/limits.ts`).
- **Transport tokens:** `local_media_transport_grants`, TTL 300 s, refresh margin 60 s; owner heartbeat 20 s with a 90 s server grace (`limits.ts:31-41`). Grant + signal tables have **no** `authenticated` grants at all (verified live) — RPC-only.
- **Gallery access:** none. `AndroidManifest.xml` declares no media/storage permission; files come from the SAF picker.
RISK: MEDIUM — `POTENTIAL POLICY RISK`: media is transferred peer-to-peer over an **unencrypted-at-application-layer** data channel (DTLS from WebRTC provides transport encryption; there is no application-layer E2EE and no key management). This is acceptable but must be described honestly in the privacy policy, which currently does not mention it at all.
ACTION: FIX REQUIRED (privacy policy), REAL DEVICE TEST REQUIRED (multi-device P2P over mobile NAT — no TURN server is configured anywhere in the codebase; STUN-only P2P fails on symmetric NAT).

**E-critical — No TURN server configured.**
STATUS: NOT FOUND
EVIDENCE: grep for `turn:`/`iceServers` across `src/` finds no TURN credentials or configuration; `local_media_transport_grants` carries a session grant, not ICE relay credentials.
RISK: HIGH (functional, not policy) — a large share of mobile-to-mobile connections will never establish. This matches the user-reported symptom history ("connected users can't see the media").
ACTION: EXTERNAL CONFIG REQUIRED.

### F. Study & Research
STATUS: IMPLEMENTED
EVIDENCE: `src/components/room/study-room.tsx`, `src/hooks/useRoomStudy.ts`, `src/lib/study.functions.ts`, `src/lib/study-timer.ts`, `src/lib/url-safety.ts`; tables `room_resources`, `room_notes`, `room_note_revisions`, `room_tasks`, `room_focus_timer`, `room_study_settings`; RPCs `add_room_resource`, `control_focus_timer`, `can_control_study`, note/task RPCs.
- **URL handling:** `src/lib/url-safety.ts` normalises and screens URLs (SSRF/scheme/host screening) before a resource is stored. Links are stored and rendered as links — **the app does not embed arbitrary web pages and is not a browser** (no in-app WebView browser component exists; `capacitor.config.ts` `allowNavigation: ["together-rooms.lovable.app"]` restricts the shell WebView to the app's own origin).
RISK: LOW
ACTION: NO ACTION

### G. Communication
STATUS: chat IMPLEMENTED / voice & video REMOVED
EVIDENCE (chat): `src/components/room/room-chat.tsx`, `chat-message.tsx`; `src/lib/chat.functions.ts:16,36,49,63,85,109` (`sendRoomMessage`, `editRoomMessage`, `deleteRoomMessage`, `toggleMessageReaction`, `reportRoomMessage`, `setMemberMute`); tables `room_messages`, `message_reactions`, `message_moderation_archive`.
EVIDENCE (calls removed): **zero** occurrences of `getUserMedia`, `navigator.mediaDevices`, or `MediaStream` in `src/` or `android/`. `AndroidManifest.xml` declares **no** `CAMERA` and **no** `RECORD_AUDIO`. No `useRoomCall`, no `CallMeshTransport`, no call UI component.
**BUT — call residue remains** (see Part 14): live tables `room_call_sessions`, `room_call_participants`, `room_call_settings`, `call_signals`, `call_transport_grants` still exist; the first three still carry `INSERT/UPDATE/DELETE` grants to `authenticated`; two are in the realtime publication; `plan_limits` still contains `max_call_minutes`; `src/lib/android/permissions.ts:17,25,33-37` still models `camera`/`microphone`/`voice_call`/`video_call`; `src/lib/query-keys.ts:32` has a `"call"` key segment; `src/routes/privacy.tsx` mentions calls.
RISK: MEDIUM
ACTION: REMOVE

### H. Safety
STATUS: IMPLEMENTED
EVIDENCE: report — `src/components/report-dialog.tsx` (used in `chat-message.tsx`, `room-members-panel.tsx`, `rooms.$roomId.tsx`), table `user_reports`; block — `src/components/block-user-button.tsx`, table `user_blocks`, enforced inside the `profiles` RLS policy (`is_blocked_between(auth.uid(), id)`); mute — `setMemberMute` + `room-members-panel.tsx:80-96`; moderation — `create_moderation_action`, `can_moderate_room`, tables `moderation_actions`, `audit_logs`; staff console — `src/routes/_authenticated/admin.{index,roles,reports.$reportId}.tsx` behind `src/components/admin/staff-gate.tsx:19-56` (UI gate) with server-side `is_staff()`/`has_role('admin')` re-checks in `src/lib/admin.functions.ts`; roles in a **separate** `user_roles` table (never on `profiles`).
Rate limiting: `consume_rate_limit(_action,_limit,_window_seconds)` with `rate_limits` having **no** grants to `authenticated` (RPC-only).
RISK: LOW
ACTION: NO ACTION (code). See Part 5 for the policy-level gaps (no in-app enforcement/appeal surface, no repeat-offender automation).

### I. Monetization
STATUS: PARTIAL — code ready, no Play Console configuration verified, no real Google test performed.
See **PART 7** (ads) and **PART 8** (billing).

### J. Privacy
STATUS: PARTIAL
EVIDENCE: `src/routes/_authenticated/settings.privacy.tsx`, table `privacy_settings` (analytics / personalization / ads consent), `src/components/ads/AdPrivacyOptions.tsx` (UMP privacy options), `src/lib/ads/consent.ts`, `src/lib/observability/redaction.ts`, `src/lib/android/crash-reporting.ts`, `src/routes/delete-account.tsx`, `src/components/account-data-panel.tsx`.
**Blocking defect:** `src/routes/privacy.tsx` is a self-declared **draft placeholder** and is now factually wrong:
- line ~66: *"No advertising SDK is integrated in this release"* — **false**; `play-services-ads:24.4.0` and `user-messaging-platform:3.2.0` are compiled in (`android/variables.gradle`) and a live banner renders on the rooms list.
- line ~45: *"We do not request contacts, location, microphone, camera, photos or files in this release"* — **misleading**; users select local photos/videos/audio via SAF and those bytes are transmitted to other users.
- `src/routes/terms.tsx:57` — *"Paid plans are not available yet"* — **false**; two Play subscription products are active in `subscription_products`.
RISK: **CRITICAL** — Play requires the privacy policy to accurately reflect the Data Safety form. A policy that denies advertising while an AdMob banner serves is a rejection-grade and enforcement-grade mismatch.
ACTION: FIX REQUIRED before any upload.

---

## PART 2 — COMPLETE DATA INVENTORY

Full per-item table: **`docs/DATA_SAFETY_DRAFT.md` §1**. Summary of the 24 identified data categories and the classification rules applied:

| # | Category | Class | Stored where | Linked to identity | Shared | User-deletable |
|---|---|---|---|---|---|---|
| 1 | Email address | COLLECTED, STORED | Supabase `auth.users` | Yes | No | Yes (`purge_user_data` + `auth.admin.deleteUser`) |
| 2 | Password (hash) | COLLECTED, STORED | Supabase Auth | Yes | No | Yes |
| 3 | User ID (UUID) | COLLECTED, STORED | `profiles.id` | Yes | Visible to co-members | Soft-deleted (`status='deleted'`, PII nulled) |
| 4 | Display name / username / bio | COLLECTED, STORED | `profiles` | Yes | Visible per `privacy_settings.profile_visibility` | Yes |
| 5 | Avatar URL | COLLECTED, STORED | `profiles.avatar_url` (URL only; no image bucket exists) | Yes | Same as #4 | Yes |
| 6 | Room IDs / membership / roles | COLLECTED, STORED | `rooms`, `room_members` | Yes | Co-members | Membership set to `left` on purge |
| 7 | Invite tokens (hashed) | COLLECTED, STORED | `room_invites.token_hash` | Yes (creator) | No | With room |
| 8 | Chat messages | COLLECTED, STORED | `room_messages` | Yes | Room members | Own messages deletable |
| 9 | Reactions | COLLECTED, STORED | `message_reactions` | Yes | Room members | Yes |
| 10 | Moderation archive of deleted content | COLLECTED, STORED | `message_moderation_archive` — **service_role only, no `authenticated` grant** | Yes | Staff only | **No** (retained after user deletion) |
| 11 | Reports & blocks | COLLECTED, STORED | `user_reports`, `user_blocks` | Yes | Staff | Blocks purged; reports retained |
| 12 | Moderation actions / audit log | COLLECTED, STORED | `moderation_actions`, `audit_logs` (`SELECT` only to `authenticated`) | Yes | Staff | **No** (retained) |
| 13 | Playback state & queue | COLLECTED, STORED | `room_playback_state`, `room_media_queue` | Yes | Room members | With room |
| 14 | Playlists | COLLECTED, STORED | `playlists`, `playlist_items` | Yes | Owner/room | Yes |
| 15 | Study notes / tasks / resources / timer | COLLECTED, STORED | `room_notes` (+ `room_note_revisions`), `room_tasks`, `room_resources`, `room_focus_timer` | Yes | Room members | With room |
| 16 | YouTube video metadata | COLLECTED, STORED (cache) | `media_metadata_cache` (24 h TTL, `src/lib/media-policy.ts:55`) | No | No | n/a |
| 17 | Local media file bytes | **TEMPORARILY PROCESSED ONLY — NOT STORED** | never persisted server-side; peer-to-peer over WebRTC data channel | Transiently, to session peers | Peers in the room | Session ends → gone |
| 18 | Local media session/signalling metadata | COLLECTED, STORED (ephemeral) | `room_local_media_sessions`, `local_media_signals`, `local_media_transport_grants` (300 s TTL) | Yes | No | Session-scoped |
| 19 | Push token (FCM) | COLLECTED, STORED | `push_tokens` | Yes | Shared with Google FCM | Yes (purge) |
| 20 | Notifications | COLLECTED, STORED | `notifications` | Yes | No | Yes (`clear_notifications`, purge) |
| 21 | Product analytics events | COLLECTED **only with consent**, STORED | `analytics_events` (INSERT policy `user_id = auth.uid()`) | Yes | No | Yes (hard-deleted by `purge_user_data`) |
| 22 | Device session records | COLLECTED, STORED | `device_sessions` | Yes | No | Yes (hard-deleted by purge) |
| 23 | Purchase tokens (Google Play) | COLLECTED, STORED **encrypted** | `billing_ack_state` — AES-256-GCM envelope, key `BILLING_TOKEN_RECOVERY_KEY_V1` (`src/lib/billing/token-crypto.server.ts`) | Yes | Sent to Google Play Developer API | **No** (financial record; retained) |
| 24 | Subscription/entitlement state | COLLECTED, STORED | `entitlements`, `subscription_events`, `play_rtdn_messages` | Yes | Google | **No** (retained) |
| 25 | Advertising ID (AAID) | **COLLECTED BY SDK, NOT BY APP CODE** | inside Google Mobile Ads SDK | Yes, by Google | Shared with Google | Via device settings / UMP |
| 26 | IP address / device & network info | TEMPORARILY PROCESSED (infrastructure + SDKs) | Supabase, Cloudflare edge, AdMob, FCM logs — **no app-side table stores IP** | By processors | With processors | No app-side control |
| 27 | Crash/diagnostic data | COLLECTED (app-side, redacted) | `src/lib/observability/{logger,redaction,monitor}.ts`, `src/lib/android/crash-reporting.ts` — **no Crashlytics/Sentry SDK is installed** | Correlation ID only | No | n/a |
| 28 | Consent records | COLLECTED, STORED | `privacy_settings` (app consents) + UMP state (device-local, Google) | Yes | No | Yes |

**Not collected at all (verified):** contacts, precise/coarse location, calendar, SMS, call logs, health/fitness, camera capture, microphone capture, files outside user-picked SAF selections, biometrics, installed-app inventory.

---

## PART 3 — GOOGLE PLAY DATA SAFETY DRAFT

Delivered in full in **`docs/DATA_SAFETY_DRAFT.md`**.

SDK-driven impacts you cannot avoid declaring:
- **Google Mobile Ads (`play-services-ads:24.4.0`)** — collects Advertising ID, device/network info, approximate location derived from IP, and ad-interaction data. Forces "Device or other IDs — collected — shared — advertising/marketing" even though no app code touches the AAID.
- **UMP (`user-messaging-platform:3.2.0`)** — stores consent state on-device.
- **Firebase Cloud Messaging (`@capacitor/push-notifications` + `google-services.json`, project `sync-b99e0`)** — FCM registration token, device instance ID.
- **Supabase (`@supabase/supabase-js:2.112.x`)** — all first-party data; processor, not third-party sharing.

---

## PART 4 — PERMISSIONS & ANDROID MANIFEST AUDIT

Declared in `android/app/src/main/AndroidManifest.xml:78-80`:

| Permission | Declared | Why present | Feature | Runtime prompt | Works if denied | Sensitive | Still necessary | Recommendation |
|---|---|---|---|---|---|---|---|---|
| `INTERNET` | YES | Whole product is networked | everything | N/A (install-time) | No | No | Yes | KEEP |
| `ACCESS_NETWORK_STATE` | YES | `@capacitor/network` reconnect logic (`src/hooks/useOnlineStatus.ts`) | offline banner / rejoin | N/A | Degrades | No | Yes | KEEP |
| `POST_NOTIFICATIONS` | YES | activity/chat/invite pushes | notifications | YES — requested only when user enables push (`settings.notifications.tsx:100-103` dynamically imports `@/lib/android/push`) | Yes, fully | Yes (Android 13+) | Yes | KEEP — correct gesture-gated pattern |
| `com.google.android.gms.permission.AD_ID` | **NOT declared in source — MERGED IN by `play-services-ads`** | AdMob | banner/interstitial | N/A | n/a | **Yes — triggers Play Advertising ID declaration** | Yes | **OWNER ACTION REQUIRED**: declare Advertising ID usage in Data Safety. NOT VERIFIED at merged-manifest level — see below |
| `ACCESS_ADSERVICES_*` / `AD_SERVICES_CONFIG` | Possibly merged by ads SDK 24.x (Privacy Sandbox) | AdMob | ads | N/A | n/a | No | Yes | NOT VERIFIED |
| `CAMERA` | **NOT declared** | — | removed calls | — | — | — | No | Correctly absent |
| `RECORD_AUDIO` | **NOT declared** | — | removed calls | — | — | — | No | Correctly absent |
| `MODIFY_AUDIO_SETTINGS` | NOT declared | — | — | — | — | — | No | Correctly absent |
| `READ_MEDIA_IMAGES/VIDEO/AUDIO`, `READ_EXTERNAL_STORAGE`, `MANAGE_EXTERNAL_STORAGE` | **NOT declared** | Local media uses SAF picker (per-file grant, no permission) | local media | — | — | — | No | Correctly absent — this is the right design |
| `FOREGROUND_SERVICE` | NOT declared | — | — | — | — | — | No | **Consequence:** background audio for local media relies solely on keeping the WebView resumed in `MainActivity.onPause()`; with no foreground service Android may kill/throttle it. REAL DEVICE TEST REQUIRED |
| contacts / location / Bluetooth / SMS / call log | NOT declared | — | — | — | — | — | No | Correctly absent |

**DECLARED BUT UNUSED:** none.
**USED BUT NOT DECLARED:** none functionally; but `AD_ID` is *used* (by the SDK) and only *implicitly* declared via manifest merge.
**HIGH-RISK:** `AD_ID` — because it must be reflected in the Data Safety form and the privacy policy, and today the privacy policy denies advertising entirely.

**P4-CRITICAL — the merged manifest has never been produced.**
STATUS: NOT VERIFIED
EVIDENCE: no `android/app/build/` output exists in the repo; no Gradle build has been executed in this environment. Everything above about `AD_ID`/Privacy-Sandbox permissions is inferred from the SDK version, not read from a merged manifest.
ACTION: REAL DEVICE TEST REQUIRED / owner must run `./gradlew :app:processReleaseManifest` and inspect `app/build/intermediates/merged_manifests/release/AndroidManifest.xml`.

---

## PART 5 — UGC, CHAT & SOCIAL SAFETY AUDIT

### Discovery / anonymity posture — explicit confirmations
- **NO RANDOM MATCHING FOUND.** No matchmaking, "next stranger", or pairing code exists. Rooms are entered only by explicit join code (`join_room_by_code`) or invite token (`redeem_room_invite`).
- **NO ANONYMOUS CHAT FOUND.** Every write path requires `auth.uid()`; there is no anonymous sign-in.
- **NO PUBLIC STRANGER DISCOVERY FOUND.** There is no public room directory, search-for-people, or nearby feature. The only cross-user visibility is `profiles_select_visible`, which requires *either* sharing a room *or* the other user having explicitly set `profile_visibility='public'`.

### UGC forms and their moderation coverage

| UGC form | Where | Reportable | Blockable | Host mute/remove | Staff removal | Audit trail | Gap |
|---|---|---|---|---|---|---|---|
| Chat messages | `room_messages` | YES (`report_message`) | YES | YES | YES (`create_moderation_action`, archived to `message_moderation_archive`) | YES | none |
| Reactions | `message_reactions` | via parent message | YES | n/a | via message | YES | no direct reaction report — acceptable |
| Profile content (name/username/bio/avatar URL) | `profiles` | **NO dedicated profile report path found** | YES | n/a | staff can act on user | YES | **GAP** |
| Shared research links | `room_resources` | **NO report control found on a resource** | n/a | host can delete | staff via user action | partial | **GAP** |
| Study notes | `room_notes` | **NO report control** | n/a | host can delete | — | revisions kept | **GAP** |
| Tasks | `room_tasks` | **NO report control** | n/a | host can delete | — | — | **GAP** |
| Playlist / queue entries (YouTube IDs) | `room_media_queue`, `playlist_items` | **NO report control** | n/a | controller can remove; `approve_queue_item` exists | — | — | **GAP** (mitigated: content is YouTube's, moderated by YouTube) |
| Local media (photos/videos/audio) | peer-to-peer, never stored | **NOT REPORTABLE — content never reaches the server, so a report cannot carry evidence** | YES (block user) | host ends session | — | session record only | **GAP — highest severity** |
| Room names/descriptions | `rooms` | **NO report control found** | n/a | — | — | — | **GAP** |
| Voice/video | REMOVED | n/a | n/a | n/a | n/a | n/a | n/a |

**U1 — Reporting is chat-and-user-only; five other UGC surfaces have no in-product report control.**
RISK: HIGH — Google Play's UGC policy expects an in-app reporting mechanism for *user-generated content*, not just messages.
ACTION: FIX REQUIRED (add report affordance to resources, notes, tasks, queue items, room metadata, and a "report this share" for local-media sessions).

**U2 — Ephemeral P2P media is unmoderatable by construction.**
EVIDENCE: bytes never touch the server (`useLocalMediaTransfer.ts`); only session metadata exists.
RISK: HIGH — POTENTIAL POLICY RISK. Play reviewers treat "share any photo/video from your device to other users" as UGC. You can report the *user* and end the *session*, but you cannot remove or evidence the *content*.
ACTION: OWNER DECISION REQUIRED — minimum viable mitigation is (a) an explicit pre-share content warning tied to the Community Guidelines, (b) a "report this session" that captures session id + participants + timestamp, (c) documented enforcement.

**U3 — No repeat-offender / enforcement escalation automation.**
EVIDENCE: `moderation_actions` records actions; no code computes strikes, suspensions, or bans from history. `profiles.status` supports `'active'`/`'deleted'` states used in RLS, and `account_status` enum exists, but no automated enforcement path was found.
RISK: MEDIUM
ACTION: FIX REQUIRED before production launch.

**U4 — Terms acceptance IS enforced before UGC.** `auth.signup.tsx:39,50-51`. RISK: NONE.

**U5 — Spam / rate limiting IS implemented.** `consume_rate_limit` used for messages, invites, joins, deletion requests (limit 3/hour), etc.; `rate_limits` is RPC-only. RISK: LOW.

**U6 — Realtime revocation.** `authorize_room_channel()` verifies membership at subscribe time; `guard_room_members` trigger forces membership changes through RPCs. **However** the failing test suite (B1) means this is currently unverified at runtime. RISK: MEDIUM.

---

## PART 6 — THIRD-PARTY CONTENT & COPYRIGHT AUDIT

| Provider | Official API? | Auth model | Key exposure | Embedded or rehosted | Metadata source | Copyright risk | Safeguards | Policy risk |
|---|---|---|---|---|---|---|---|---|
| **YouTube Data API v3** | Official | Server-side API key (`YOUTUBE_DATA_API_KEY`, read inside `.handler()`) | **None client-side** — verified: no `VITE_YOUTUBE*` var exists | n/a (metadata only) | `videos.list` + `search.list` | Low | `videoEmbeddable=true`, `safeSearch=strict`, `media_metadata_cache` 24 h TTL | LOW |
| **YouTube IFrame Player** | Official | none | **Embedded only** | Embedded | YouTube | Low | `COMPLIANT_PLAYER_VARS` gate, `verifyPlayerVisibility` minimum size, background pause | MEDIUM (see below) |
| **User local media** | n/a | transport grant | Neither — P2P only, never rehosted | n/a | filename/mime from device | **User-supplied — the app cannot know rights status** | Guidelines forbid pirated media; session limits; no persistence | MEDIUM |
| **User research links** | n/a | n/a | Links only, rendered as links | Not embedded | user-typed + `url-safety.ts` normalisation | Low | scheme/host screening | LOW |
| **Google Mobile Ads / UMP** | Official SDK | app id + unit ids (public) | Public identifiers, correctly not secret | n/a | n/a | n/a | consent-gated init | see Part 7 |
| **Firebase FCM** | Official | `google-services.json` + server `FIREBASE_SERVICE_ACCOUNT` | Server key is a secret, correctly stored | n/a | n/a | n/a | bearer-guarded dispatch endpoint | LOW |

### Direct answers to the specific questions

| Question | Answer | Evidence |
|---|---|---|
| Hosts copyrighted movies? | **NO** | No storage bucket exists; no server-side media hosting anywhere |
| Downloads YouTube videos? | **NO** | No `ytdl`, no stream extraction, no download path |
| Extracts audio from YouTube? | **NO — actively blocked** | `src/lib/youtube-compliance.ts` `verifyPlayerVisibility` enforces a minimum visible player size; `isCompliantPlayerVars` gate blocks non-compliant init |
| Bypasses provider restrictions? | **NO** | `media-policy.ts` refuses `not_embeddable`, `privacy_blocked`, `unavailable`, and fails closed on `provider_verification_failed` |
| Removes provider branding? | **NO** | Standard IFrame embed; no chrome removal found |
| Blocks embedded player controls? | **NO** | Controls remain; sync is applied via the IFrame API |
| Plays MFK content in a prohibited way? | **NO — handled explicitly** | `made_for_kids` stays playable but sets `tracking_restricted`; `src/lib/ads/analytics-safety.ts` + `src/lib/local-media/analytics-safety.ts` suppress tracking |
| Permanently stores user local media? | **NO** | No bucket, no server write path; peer-to-peer only |
| Redistributes user media? | **Only to the room members the sharer chose** | `local_media_transport_grants` scoped per session/member |
| Exposes arbitrary web browsing? | **NO** | `capacitor.config.ts` `allowNavigation: ["together-rooms.lovable.app"]`; no in-app browser component |
| Acts as a browser? | **NO** | see above |

**T1 — The Android app is a WebView shell pointing at a remote origin.**
STATUS: IMPLEMENTED (by design)
EVIDENCE: `capacitor.config.ts` — `server.url = "https://together-rooms.lovable.app"`, `webDir: "android-shell"` described as "Only used as an offline fallback shell". No web assets are bundled into the APK.
RISK: **HIGH — POTENTIAL POLICY RISK.** Google Play's *Spam and Minimum Functionality* policy explicitly targets apps that are "solely a webview of an existing website" with no meaningful native value. SyncTogether does add native value (AdMob, FCM push, App Links, native fullscreen, lifecycle handling), which is a defensible position — but it is a judgement call by the reviewer, and it also means **the app has no offline behaviour whatsoever** and every release ships from the web origin without Play review.
ACTION: OWNER DECISION REQUIRED. Mitigations to consider: bundle the web build into the APK (`webDir` → real build output, drop `server.url`), or be prepared to justify native functionality in the review notes.

---

## PART 7 — ADS & ADMOB AUDIT

### Identifiers (all public, correctly not secret)
- App ID: `ca-app-pub-1475323931624357~5237247287` — `src/lib/ads/admob-production.ts:20`, `android/.../strings.xml:10`, `AndroidManifest.xml:50-52`.
- Banner unit: `ca-app-pub-1475323931624357/9884842805`; Interstitial: `/3102038535`; Rewarded: `/5045675599` — `src/lib/ads/admob-production.ts:29-31`. **These are real production units, not Google test units.**
- Test inventory (dev builds only): publisher `3940256099942544` — `src/lib/ads/config.ts:42-50`. `resolveAdUnits` **rejects** a test unit configured in a production build (`config.ts:93-100`), and `resolveAdTestMode` forces `demoUnits=false` outside development (`test-devices.ts:76-84`).
- Environment switch: `import.meta.env.PROD` only (`useAds.tsx:92-94`). Optional overrides `VITE_ADMOB_{BANNER,INTERSTITIAL,APP_OPEN,REWARDED}_UNIT`, `VITE_ADMOB_APP_ID`, `VITE_ADMOB_TEST_DEVICE_IDS` — **none are set in `.env`**.

### Format table

| Ad format | Configured | Reachable in UI | Native Java implemented | Production enabled | Placement | Frequency | Premium suppression | Consent required | Accidental-click risk | Policy risk |
|---|---|---|---|---|---|---|---|---|---|---|
| Banner | YES | **YES** | YES (`BannerAdController.java`) | YES | `rooms_list_footer` only (`rooms.index.tsx:121`) | n/a (persistent) | YES (`placement.ts:105`, torn down at `useAds.tsx:247-251`) | YES | LOW — below list content, no media/controls nearby | LOW |
| Interstitial | YES | **YES** | YES (`InterstitialAdController.java`) | YES | `room_session_ended` only (`rooms.$roomId.tsx:195`) | ≥180 s apart, max 2/session, ≥90 s into session | YES | YES | LOW — fires after a room ends | LOW |
| App-open | Partially (type + test unit) | **NO** — no call site | **NO controller class exists**; `AdsPlugin.java` has no `showAppOpen` | NO (`app_open_enabled:false` in `config.ts:151` and in the live `ad_config` row) | — | — | n/a | n/a | n/a | **DEAD CODE** |
| Rewarded | YES (real unit id exists) | **NO** — hard-disabled | **NO controller class** | NO — `REWARDED_ADS_ENABLED = false` (`config.ts:141`), refused unconditionally at `placement.ts:113-117` | — | — | n/a | n/a | n/a | **DEAD CODE** (a real production unit id ships in the bundle for a format that can never render) |
| Native ads | NO | NO | NO | NO | — | — | — | — | — | none |

### UMP consent
- Tri-state (`unresolved | granted_personalized | granted_limited | denied`) — `src/lib/ads/placement.ts:16`, `consent.ts:79-85`.
- **Fail-closed:** any exception during `requestConsentInfoUpdate`/`showConsentFormIfRequired` yields `{...UNRESOLVED_UMP, error:"gathering_failed"}` (`useAds.tsx:139-141`; native `ConsentController.java:52-54,62-67,80-83` returns `unresolved()` on any `Throwable`). `mayInitializeAds` refuses SDK init unless `canRequestAds` and no error (`consent.ts:114-118`).
- Non-personalised ads: `npa` bundle via `AdMobAdapter` extras (`BannerAdController.java:132-147`).
- The app-level `privacy_settings.ads_consent` toggle can only make consent **stricter** (`consent.ts:93-98`).
- `AndroidManifest.xml:56-58` sets `DELAY_APP_MEASUREMENT_INIT=true` so the SDK does not auto-initialise before consent.
- Privacy Options entry point: `AdPrivacyOptions.tsx` renders only when `shouldOfferPrivacyOptions` (`consent.ts:105-107`).

### Placement safety
Two independent gates must both pass: the surface allow-list (`placement-map.ts` — 1 banner surface, 1 interstitial transition, 22 explicitly forbidden surfaces including `chat`, `room_active`, `youtube_room`, `music_room`, `local_media`, `billing`, `subscription`, `app_launch`, `app_exit`) and the dynamic context check (`placement.ts:84-136` — blocks during account deletion, privacy settings, consent, payment, restore purchases, report, block, auth, active media/local-media, chat typing, form entry, critical navigation).
Verified against the specific hazards asked for: **ads over media controls — NO; ads during calls — n/a (no calls); ads during chat typing — explicitly blocked; ads near sensitive actions — explicitly blocked; ads before permission prompts — not reachable (banner is on the rooms list only); ads during billing — explicitly blocked; deceptive placement — none found; unexpected navigation — none found.**

### Ad findings
**A1 — Rewarded production ad unit id ships in a build that can never show a rewarded ad.**
RISK: LOW. ACTION: CODE REMOVAL RECOMMENDED.
**A2 — `ConsentDebugSettings.Builder(activity).build()` is constructed unconditionally in every build** (`ConsentController.java:44`), not gated behind `BuildConfig.DEBUG`. With no debug geography configured it appears inert.
RISK: LOW / NOT VERIFIED. ACTION: FIX REQUIRED (gate it) + REAL DEVICE TEST REQUIRED.
**A3 — Ads have never rendered against the real AdMob account.** No AdMob account, app, or unit has been confirmed to exist on Google's side.
RISK: HIGH (revenue + policy). ACTION: REAL GOOGLE SERVICE TEST REQUIRED.
**A4 — Live `ad_config` row is present and permissive**: `{ads_enabled:true, banner_enabled:true, interstitial_enabled:true, app_open_enabled:false, max_fullscreen_per_session:2, min_seconds_between_fullscreen:180}`. Remote config can widen frequency but cannot enable rewarded (`mergeAdFrequency` ANDs with the build flag). RISK: LOW.

---

## PART 8 — SUBSCRIPTIONS & GOOGLE PLAY BILLING AUDIT

### Products (live database, `subscription_products`)
| id | platform | base_plan_id | period | entitlement | active |
|---|---|---|---|---|---|
| `synctogether.premium.monthly` | google_play | `premium-monthly` | monthly | `premium` | true |
| `synctogether.premium.yearly` | google_play | `premium-yearly` | yearly | `premium` | true |

### Plan limits (live database, `plan_limits`)
| plan | max_active_rooms | max_room_members | max_playlists | max_local_media_minutes | ads_enabled | max_call_minutes |
|---|---|---|---|---|---|---|
| free | 25 | 10 | 5 | 30 | true | 45 ← **dead field, calls removed** |
| premium | 100 | 50 | 100 | 120 | false | 240 ← **dead field** |

### Implementation status

| Item | Status | Evidence |
|---|---|---|
| Entitlement store | CODE READY | `entitlements` table, `my_entitlement` RPC, `src/hooks/useEntitlement.ts`, `src/lib/entitlements.ts` |
| Feature gates | CODE READY | `trg_enforce_room_entitlement_limits`, `trg_guard_room_capacity`, `guard_entitlement_tables` |
| Purchase verification | CODE READY | `src/lib/billing/verification.server.ts:188-242` — Play `subscriptionsv2`, service-account JWT minted with WebCrypto (`:61-102`); **fails closed** if package/product/service-account missing (`:196-206,235-237`) |
| Acknowledgement | CODE READY | `verification.server.ts:248-312`; intent row written *before* acknowledging (`reconciliation.server.ts:94-128`) |
| Ack recovery | CODE READY | AES-256-GCM envelope of the purchase token (`token-crypto.server.ts`), key `BILLING_TOKEN_RECOVERY_KEY_V1` (**configured**); bounded retry `MAX_ACK_ATTEMPTS=6`, 1 min → 6 h backoff; `claim_billing_ack_work` / `complete_billing_ack` leasing |
| RTDN endpoint | CODE READY | `src/routes/api.public.billing.rtdn.ts:42-57` — Google-signed OIDC (RS256 vs live JWKS, issuer/aud/email/exp) via `google-oidc.server.ts`; fails closed to 401/503 when env missing; exactly-once by Pub/Sub message id (`rtdn.server.ts:67-81`) |
| Reconciliation | CODE READY | `runBillingReconciliation` (`reconciliation.server.ts:259-405`); `/api/public/billing/reconcile` returns **404** when `BILLING_RECONCILE_SECRET` is unset |
| Ordering / duplicates | CODE READY | `apply_billing_event` monotonic on `event_seq` (`rtdn.ts:221-241`) |
| Revocation | CODE READY | applied only when Google's voided-purchases list confirms (`rtdn.server.ts:139-148`, `verification.server.ts:319-346`) |
| Grace / hold | CODE READY | `grace_until`, `cancel_at_period_end` parameters on `apply_billing_event` |
| **Restore purchases** | **PARTIAL / NOT VERIFIED** | `src/lib/billing/play-billing.ts` exists and a `restore_purchases` sensitive-flow constant exists in `placement.ts:22-30`, **but there is no Google Play Billing native plugin in `package.json` and no billing Java class under `android/app/src/main/java/`** — only `ads/` exists |
| **Play Console configuration** | **NOT CONFIGURED / NOT VERIFIED** | no evidence available from code |
| **Real Google test** | **NOT PERFORMED** | no evidence available from code |

**BL1 — CRITICAL: there is no native Google Play Billing client.**
STATUS: NOT FOUND
EVIDENCE: `android/app/build.gradle` `dependencies` block contains `play-services-ads` and `user-messaging-platform` **only** — no `com.android.billingclient:billing`. `android/app/src/main/java/com/synctogether/com/` contains `MainActivity.java` and the `ads/` package only. `package.json` contains no billing plugin (`@capacitor-community/…`, `cordova-plugin-purchase`, `RevenueCat`, etc.).
Consequence: the **server side** of billing (verification, acknowledgement, RTDN, reconciliation, entitlement application) is complete and high quality, but **a user cannot actually initiate a purchase** — nothing can launch the Play billing flow, and nothing can call `acknowledgePurchase` client-side or hand a purchase token to the server.
RISK: **CRITICAL** for any release that advertises Premium.
ACTION: FIX REQUIRED, or ship v1 with Premium hidden.

**BL2 — Required billing env vars are not configured.**
STATUS: NOT VERIFIED / EXTERNAL CONFIG REQUIRED
EVIDENCE: configured secrets are `BILLING_TOKEN_RECOVERY_KEY_V1`, `FIREBASE_SERVICE_ACCOUNT`, `LOVABLE_API_KEY`, `LOVABLE_CRON_SECRET`, `PUSH_DISPATCH_SECRET`, `YOUTUBE_DATA_API_KEY`. **Missing:** `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_PREMIUM_PRODUCT_ID`, `PLAY_RTDN_AUDIENCE`, `PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`, `BILLING_RECONCILE_SECRET`, `BILLING_TOKEN_RECOVERY_KEY_VERSION`.
Effect (verified by reading the code, not by running it): verification fails closed, RTDN returns 401/503, `/api/public/billing/reconcile` returns 404. Nothing is insecure — but **billing is inert**.
ACTION: EXTERNAL CONFIG REQUIRED.

### Exact Play Console items the owner must create
See **`docs/PLAY_CONSOLE_CONFIGURATION.md` §Billing**. Summary: one subscription `synctogether.premium` with base plans `premium-monthly` and `premium-yearly` (IDs must match `subscription_products` exactly), a Google Cloud service account with "View financial data / Manage orders" granted in Play Console, a Pub/Sub topic + push subscription to `https://together-rooms.lovable.app/api/public/billing/rtdn` with OIDC auth, licence testers, and a closed-testing track.

---

## PART 9 — PRIVACY, LEGAL & USER RIGHTS AUDIT

| Document / right | Required? | Exists in code? | Public URL? | Referenced in app? | Play Console? | Needs update? |
|---|---|---|---|---|---|---|
| Privacy Policy | YES (mandatory) | YES — `src/routes/privacy.tsx` | `https://together-rooms.lovable.app/privacy` | YES (footer + signup) | OWNER ACTION | **YES — CRITICAL.** Self-labelled draft; states no ad SDK is integrated (false), no files are used (misleading), omits FCM, AdMob, AAID, purchase tokens, P2P media transfer, retention periods, contact address |
| Terms of Service | YES (subscriptions present) | YES — `src/routes/terms.tsx` | `/terms` | YES | OWNER ACTION | **YES.** Says "Paid plans are not available yet" (false). No auto-renewal, price, cancellation or refund wording |
| Community Guidelines | YES (UGC app) | YES — `src/routes/guidelines.tsx` | `/guidelines` | YES (footer) | n/a | YES — must cover local media sharing and enforcement/appeals; still labelled draft |
| Account deletion (in-app) | YES | YES — `settings` + `src/components/account-data-panel.tsx` | — | YES | n/a | NO |
| Account deletion (web, no login) | YES (Play requirement) | YES — `src/routes/delete-account.tsx` | `/delete-account` | YES (footer) | OWNER ACTION — URL must be entered in Play Console | NO |
| Data export | Not Play-mandated | YES — `export_user_data()` | — | YES | n/a | NO |
| Ads privacy controls | YES | YES — `AdPrivacyOptions.tsx` + `settings/privacy` | — | YES | n/a | NO |
| Retention schedule | YES (must be in policy) | **NOT DOCUMENTED** — code retains `audit_logs`, `moderation_actions`, `message_moderation_archive`, `subscription_events`, `play_rtdn_messages`, `user_reports` **after account deletion** with no stated period | — | NO | n/a | **YES** |
| Third-party disclosures (Google/AdMob/Firebase/Supabase) | YES | **ABSENT from the policy** | — | NO | n/a | **YES** |
| YouTube disclosure | YES — YouTube API Services ToS requires linking Google's Privacy Policy and YouTube ToS | **ABSENT** | — | NO | n/a | **YES — POTENTIAL POLICY RISK** |
| Subscription terms / refunds | YES | ABSENT | — | NO | n/a | **YES** |
| Age requirement | YES | Terms say only "old enough under local law" — no explicit minimum | — | weak | OWNER ACTION | **YES** |
| Support / privacy contact | YES | **ABSENT** — `privacy.tsx` literally says an address "must be added before public release" | — | NO | OWNER ACTION | **YES** |

---

## PART 10 — TARGET AUDIENCE & CONTENT RATING

### Recommendation
**Target age group: 18 and over (single group).**
Reasons, from code:
1. Unmoderatable peer-to-peer sharing of arbitrary device photos/videos between users (Part 5, U2).
2. Free-text chat between users with no automated content classification (no profanity/CSAM/NSFW classifier exists anywhere in `src/`).
3. Arbitrary YouTube content playback in shared rooms (`safeSearch=strict` applies to *search results only*, not to pasted links — verified: `media-search.functions.ts:44` sets it on `search`, while `set_room_media` accepts any embeddable video id).
4. Subscriptions and advertising are present.

**Under-18 / Families programme: NOT SUITABLE.** If any under-13 audience is selected, the app enters Families policy, which would require removing AdMob personalised ads, adding a families-certified ad SDK configuration, and neutered social features. Nothing in the codebase supports that today.
**"18+ in the description" is NOT sufficient** — the target-audience declaration, content rating answers, and Data Safety must all agree, and an app that permits stranger-free but photo-sharing social interaction will still be rated on its interactive elements.

### Draft content-rating answer map (IARC)

| Question | Recommended answer | Reason | Evidence | Confidence | Owner review? |
|---|---|---|---|---|---|
| Violence / sexual content / drugs / gambling authored by the app | **No** | The app authors no content | no content assets | High | No |
| Users can interact / communicate | **Yes** | chat, rooms, invites | `room_messages`, `chat.functions.ts` | High | No |
| Users can share user-generated content | **Yes** | messages, notes, links, photos/videos | Part 5 table | High | No |
| Users can share photos/videos | **Yes** | local media rooms | `local-media-room.tsx` | High | No |
| Users can share their location | **No** | no location permission or code | manifest | High | No |
| Users can exchange personal information | **Yes** (conservatively) | free-text chat permits it | `room_messages` | High | Yes |
| Does the app allow purchases | **Yes** | subscriptions declared | `subscription_products` | High | Yes — depends on whether Premium ships |
| Does the app contain ads | **Yes** | AdMob banner + interstitial | Part 7 | High | No |
| Unrestricted internet access / browser | **No** | `allowNavigation` restricted to own origin | `capacitor.config.ts` | High | No |
| Content moderation in place | **Yes, partially** | chat/user moderation yes; other UGC surfaces no | Part 5 | Medium | **Yes** |
| Miscellaneous: is the app a social network? | **Yes, private/closed** | invite-only rooms, no discovery | Part 5 | High | Yes |

---

## PART 11 — PLAY CONSOLE APP CONTENT CHECKLIST

Delivered in full in **`docs/PLAY_CONSOLE_CONFIGURATION.md`**. Applicability summary:

| Section | Applies | Note |
|---|---|---|
| Privacy Policy | YES | must be rewritten first |
| Ads declaration | YES — "contains ads" | AdMob banner + interstitial |
| App access | YES | login required for everything except `/`, `/privacy`, `/terms`, `/guidelines`, `/delete-account` |
| Target audience & content | YES | 18+ recommended |
| Content rating | YES | questionnaire draft in Part 10 |
| Data safety | YES | draft in `docs/DATA_SAFETY_DRAFT.md` |
| Sensitive permissions (special declarations) | **NOT APPLICABLE** | no `MANAGE_EXTERNAL_STORAGE`, no `QUERY_ALL_PACKAGES`, no SMS/Call Log, no `ACCESS_BACKGROUND_LOCATION`, no accessibility, no `REQUEST_INSTALL_PACKAGES`, no full-screen intent |
| Account deletion | YES | `/delete-account` URL |
| News declaration | **NOT APPLICABLE** | not a news app; no editorial content |
| Financial features | **NOT APPLICABLE** | subscriptions are IAP, not a financial product; no lending, crypto, or payments |
| Health | **NOT APPLICABLE** | no health data |
| Government | **NOT APPLICABLE** | not a government app |
| AI-generated content | **NOT APPLICABLE** | `LOVABLE_API_KEY` exists as a platform secret but **no AI/LLM call site exists in `src/`** (verified by grep) — no generative feature ships |
| Advertising ID | YES | merged in by the ads SDK |
| Data safety: encryption in transit | YES | HTTPS-only, `usesCleartextTraffic="false"`, network security config trusts system CAs only |

---

## PART 12 — APP ACCESS FOR GOOGLE REVIEWERS

Delivered in full in **`docs/REVIEWER_ACCESS_PLAN.md`**.

Determination: **credentials ARE required.** `src/routes/_authenticated/route.tsx:5-17` gates every functional screen behind login, no social login exists, and there is no demo/guest mode. Furthermore the *interesting* features (rooms, sync, local media) require **two accounts** to be meaningful, and local media requires **two devices**.

Owner must provide: 2 pre-created email/password accounts, a standing room join code, a licence-tester account for Premium (if Premium ships), and step-by-step reviewer instructions. **Do not create fake credentials in code.**

---

## PART 13 — SECURITY AUDIT

### CRITICAL
None found in the security-boundary code itself. (Note: BL1 in Part 8 is a functional/release blocker, not a vulnerability.)

### HIGH
**S-H1 — Over-broad `anon` privileges on 13 public tables (live database).**
STATUS: IMPLEMENTED (mitigated by RLS, but the grant is wrong)
EVIDENCE: live query `has_table_privilege('anon', …)` returns `INSERT`/`UPDATE`/`DELETE` **true** for: `account_deletion_requests`, `analytics_events`, `billing_ack_state`, `billing_reconciliation_runs`, `device_sessions`, `notifications`, `privacy_settings`, `profiles`, `push_tokens`, `rate_limits`, `room_sessions`, `user_blocks`, `user_settings`. Note the migrations contain **zero** `GRANT … TO anon` statements — these come from Postgres/Supabase default privileges on the `public` schema that were never revoked.
Mitigation verified: every policy on these tables is `TO {authenticated}` only, so `anon` has no policy and every statement is denied by RLS. The mitigation is real but is a **single point of failure** — one future `TO public` or `USING (true)` policy turns this into an unauthenticated write.
RISK: HIGH (defence-in-depth failure)
ACTION: FIX REQUIRED — `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` then re-grant only what public reads genuinely need (currently only `media_metadata_cache` has an intentional `anon SELECT`).

**S-H2 — Dead voice/video tables retain write grants and realtime exposure.**
EVIDENCE: `room_call_sessions`, `room_call_participants`, `room_call_settings` all have `INSERT/UPDATE/DELETE` to `authenticated` (live check) and `room_call_sessions` + `room_call_participants` are members of `supabase_realtime`. `guard_room_call_*` triggers exist, which limits abuse, but the attack surface is entirely unnecessary for a removed feature.
RISK: HIGH (unnecessary attack surface)
ACTION: REMOVE

**S-H3 — Database security behaviour is currently unverified.** See B1. 194 tests skipped, 11 DB suites failing.
RISK: HIGH. ACTION: FIX REQUIRED.

### MEDIUM
**S-M1 — `push_tokens` has an `authenticated` INSERT grant but no INSERT policy**, so direct inserts fail; registration goes through `register_push_token`. Harmless but inconsistent. ACTION: tidy the grant.
**S-M2 — No TURN server / ICE relay credentials** — see Part 1 §E. Functional, but it also means connection failures are indistinguishable from network attacks in the diagnostics UI.
**S-M3 — WebView shell loads a remote origin** — any compromise of `together-rooms.lovable.app` is a full app compromise with no Play review gate. Mitigated by `allowNavigation` allow-list, `usesCleartextTraffic="false"`, system-CA-only trust anchors, `allowMixedContent:false`, `webContentsDebuggingEnabled:false`.
**S-M4 — `ConsentDebugSettings` constructed in release builds** (`ConsentController.java:44`).

### LOW
**S-L1 —** `debug` build type uses `applicationIdSuffix ".debug"` and `debuggable true`; release is `debuggable false`, `minifyEnabled true`, `shrinkResources true`. Correct.
**S-L2 —** Backup/device-transfer fully excluded (`data_extraction_rules.xml`, `allowBackup="false"`). Correct.
**S-L3 —** Exported components: only `MainActivity` (`exported="true"`, required for LAUNCHER + App Links). `FileProvider` is `exported="false"`. Correct.
**S-L4 —** 98 lint errors (B2).

### INFORMATIONAL (verified-good, listed as evidence)
- All 52 public tables have RLS enabled (live check: `relrowsecurity = true` for every row).
- All 174 public functions that are `SECURITY DEFINER` set an explicit `search_path` — live check `secdef_no_searchpath = 0`.
- 63 non-internal triggers, including ~20 `guard_*` triggers that force mutation through RPCs.
- Roles are in a **separate `user_roles` table** with a `has_role()` SECURITY DEFINER helper — no role column on `profiles`. Live: 269 role rows for 269 profiles.
- Secrets handling: `YOUTUBE_DATA_API_KEY` read inside `.handler()` only; no `VITE_`-prefixed secret exists; purchase tokens encrypted at rest with AES-256-GCM; `src/lib/observability/redaction.ts` enforces log redaction; RTDN/push/reconcile endpoints all use constant-time or cryptographic caller verification.
- `message_moderation_archive`, `play_rtdn_messages`, `push_dispatch_config`, `local_media_signals`, `local_media_transport_grants`, `call_signals`, `call_transport_grants` have **no** `authenticated` privileges at all.

---

## PART 14 — DEAD CODE / REMOVED FEATURE AUDIT

| Item | Why it exists | Reachable | Risk | Remove? | Migration risk |
|---|---|---|---|---|---|
| Tables `room_call_sessions`, `room_call_participants`, `room_call_settings`, `call_signals`, `call_transport_grants` | Phase 8 voice/video, later removed from the product | Writable by `authenticated` on 3 of 5; 2 in realtime publication | HIGH | **YES** | Drop migration; no client reads them (`grep .from("room_call` → only `types.ts`) |
| `plan_limits.max_call_minutes` (free 45 / premium 240) | same | Read into entitlement objects | LOW | YES | JSONB field; safe to drop |
| `src/lib/android/permissions.ts:17,25,33-37,74-75,94` — `camera`, `microphone`, `voice_call`, `video_call` types | same | Type/test-only; no `getUserMedia` anywhere | LOW | YES | tests reference them (`android-security.test.ts:208-213,269-275`, `release-readiness.test.ts:267-281`) |
| `src/lib/query-keys.ts:32` `"call"` key segment | same | Cosmetic | NONE | YES | none |
| `useAppLifecycle({inCall})` — hard-coded `false` at `rooms.$roomId.tsx:99` | same | Dead branch | LOW | YES | none |
| `src/routes/privacy.tsx` mentions of calls | same | User-visible | MEDIUM | YES | part of the policy rewrite |
| `FORBIDDEN_AD_SURFACES` entries `voice_call`, `video_call` | same | Harmless allow-list data | NONE | Optional | none |
| **Rewarded ad production unit id** `ca-app-pub-…/5045675599` | Phase 13 | Unreachable (`REWARDED_ADS_ENABLED=false`) | LOW | YES | none |
| App-open ad plumbing (`AdUnits.appOpen`, `admob-bridge.ts:39 showAppOpen`) | Phase 13 | No native impl, no call site | LOW | YES | none |
| `src/components/premium-gate.tsx` (`PremiumBadge`, `PremiumNotice`) | earlier phase | **Zero imports** | LOW | YES | none |
| 17 unused shadcn scaffold components (`accordion`, `aspect-ratio`, `breadcrumb`, `calendar`, `carousel`, `chart`, `context-menu`, `drawer`, `hover-card`, `input-otp`, `menubar`, `navigation-menu`, `radio-group`, `resizable`, `sidebar`, `slider`, `toggle-group`) | UI kit boilerplate | Not imported by app code | LOW | Optional | removing them also frees `embla-carousel-react`, `recharts`, `cmdk`, `vaul`, `input-otp`, `react-day-picker`, `react-resizable-panels` |
| `date-fns` dependency | — | **Zero references in `src/`** | LOW | YES | none |
| `src/lib/providers/types.ts:75` `AdSlot = "home_feed"\|"settings_footer"\|"room_list_footer"` | Phase 1 registry | **Contradicts** the real placement `rooms_list_footer` | LOW | YES | dead type, misleading |
| `src/lib/providers/registry.ts` | Phase 1 "no providers wired yet" | Effectively unused — YouTube is called directly | LOW | Optional | none |
| `src/lib/realtime/events.ts:17` "Reserved for future phases — declared, not implemented" | placeholder | Inert | NONE | Optional | none |
| `android/app/src/{test,androidTest}/java/com/getcapacitor/myapp/Example*Test.java` | Capacitor scaffold | Not run | NONE | Optional | none |
| Stale docs: `ADMOB_PRODUCTION.md`, `BILLING_AND_ADS.md`, `LAUNCH_READINESS.md`, `PHASE14_2_RELEASE_GATE.md`, `PLAY_CONSOLE_SUBMISSION.md` | previous phases | Claim "596 tests pass", describe voice/video, assert readiness | **MEDIUM — misleading to a reviewer** | Update or delete | none |
| Development flags | — | None found that bypass guards | NONE | — | — |
| Sample credentials / production test IDs | — | **None found.** Google test ad units exist but are dev-only and actively rejected in prod builds | NONE | — | — |

---

## PART 15 — BUILD, RELEASE & ANDROID ARTIFACT AUDIT

| Item | Value | Verification level |
|---|---|---|
| Package / applicationId | `com.synctogether.com` (`build.gradle`, `namespace` + `applicationId`) | CODE VERIFIED |
| versionName | `1.0.0` (`build.gradle`) | CODE VERIFIED |
| versionCode | `VERSION_CODE` env → `versionCode` property → fallback `1` | CODE VERIFIED |
| minSdk / targetSdk / compileSdk | 24 / **36** / 36 (`variables.gradle`) | CODE VERIFIED — meets the 2026 target-API requirement |
| Signing | Env-only (`ANDROID_KEYSTORE_PATH/PASSWORD/KEY_ALIAS/KEY_PASSWORD`); Gradle throws on partial config; `REQUIRE_SIGNED_RELEASE` gate. **No keystore in the repo** | CODE VERIFIED / **NEVER EXECUTED** |
| Release build type | `debuggable false`, `minifyEnabled true`, `shrinkResources true`, `proguard-android-optimize.txt` + `proguard-rules.pro` | CODE VERIFIED — **NEVER COMPILED** |
| Debug build type | `.debug` suffix, `-debug` versionName | CODE VERIFIED |
| Cleartext traffic | Disabled in both `AndroidManifest.xml` (`usesCleartextTraffic="false"`) and `network_security_config.xml` | CODE VERIFIED |
| Backup | `allowBackup="false"`, `fullBackupContent="false"`, all domains excluded from cloud-backup and device-transfer | CODE VERIFIED |
| Network security config | Release trusts **system CAs only**; user CAs only in `debug-overrides` | CODE VERIFIED |
| Exported components | `MainActivity` only; `FileProvider` not exported | CODE VERIFIED |
| Deep links / App Links | `autoVerify="true"` for `https://together-rooms.lovable.app/invite/*` and `/auth/*` | STATICALLY VERIFIED |
| **assetlinks.json** | **NOT FOUND** — no `public/.well-known/assetlinks.json` and no route serving it | **NOT VERIFIED — OWNER ACTION REQUIRED.** Without it, `autoVerify` fails and invite links open the browser, not the app |
| ProGuard/R8 | Keeps `@CapacitorPlugin` classes and `@PluginMethod` members in `com.synctogether.com.ads.**`, keeps `*Annotation*`; relies on SDK consumer rules for ads/UMP | CODE VERIFIED — **NEVER SHRUNK** |
| WebView config | `allowMixedContent:false`, `captureInput:true`, `webContentsDebuggingEnabled:false`, `androidScheme:"https"`, `allowNavigation:["together-rooms.lovable.app"]` | CODE VERIFIED |
| Native WebView overrides | `MainActivity.onPause()` re-resumes the WebView + timers; `FullscreenWebChromeClient` handles `onShowCustomView` | CODE VERIFIED — **REAL DEVICE TEST REQUIRED** |
| Capacitor plugins | `@capacitor/app`, `network`, `push-notifications`, `splash-screen`, `android`, `core` (all v8) + local `AdsPlugin` | CODE VERIFIED |
| Firebase | `google-services.json` present, project `sync-b99e0`, package matches, 1 API key, **0 OAuth clients** | CODE VERIFIED |
| **ACTUALLY COMPILED** | **NO** — no Gradle build has been run; no `android/app/build/` exists | — |
| **REAL DEVICE VERIFIED** | **NO** — nothing in this repository evidences a device run | — |

---

## PART 16 — ASO / STORE LISTING TRUTH AUDIT

Compared against the current landing page copy (`src/routes/index.tsx`) and `docs/PLAY_CONSOLE_SUBMISSION.md`.

| Claim | Verdict | Evidence |
|---|---|---|
| Title "SyncTogether — Watch. Listen. Study. Connect. Together." (`index.tsx:21`) | **ACCURATE** but too long for Play (30-char limit) — use `SyncTogether` | — |
| "Watch together" | ACCURATE | `watch-together.tsx` |
| "Listen together" (`index.tsx:45`) | **REQUIRES CLARIFICATION** | Music mode is a minimised **YouTube video** player, not an audio service. Must not be described as a music player or imply background audio |
| "Study & research" (`index.tsx:52`) | ACCURATE | `study-room.tsx` |
| "Chat in the room" (`index.tsx:59`) | ACCURATE | `room-chat.tsx` |
| "Couple, family & friends" (`index.tsx:66`) | ACCURATE | invite-only rooms |
| "Private by default" (`index.tsx:73`) | **PARTIALLY ACCURATE** | Rooms are invite-only and RLS-scoped, but there is **no end-to-end encryption**; messages and metadata are readable by the operator and by staff moderators. Do not imply E2EE |
| "Safety built in" (`index.tsx:80`) | **PARTIALLY ACCURATE** | Chat/user reporting yes; five other UGC surfaces have no report control (Part 5) |
| Share photos/videos from your device | ACCURATE | local media rooms |
| Voice / video calls | **REMOVED — must not appear anywhere** | no call code exists |
| Premium subscription | **NOT IMPLEMENTED (purchase flow)** — see BL1 | do not advertise until a billing client ships |
| "No ads" / ad-free claims | Ad-free-with-Premium is **code-ready** (`placement.ts:105`) but depends on Premium shipping | conditional |
| Privacy claims in listing | **MISLEADING if copied from `privacy.tsx`** | the policy denies advertising |
| Age claims | Must state 18+ consistently with Part 10 | — |
| Screenshots / feature graphic / icon | **NOT FOUND in the repository** — only `src/assets/brand-mark.png` and `splash-master.png` exist | OWNER ACTION REQUIRED |

---

## PART 17 — DEPENDENCY & SDK INVENTORY

Full table: **`docs/DEPENDENCY_SDK_INVENTORY.md`**.

---

## PART 18 — TEST & VERIFICATION TRUTH TABLE

| Area | Unit tested | Integration tested | Backend (live DB) tested | Native compiled | Real device tested | Real Google service tested | Production verified |
|---|---|---|---|---|---|---|---|
| Room engine / RLS | YES | YES (suite exists) | **FAILING TODAY** (B1) | n/a | NO | n/a | NO |
| Chat security | YES | YES | **FAILING TODAY** | n/a | NO | n/a | NO |
| Moderation RBAC | YES | YES | **FAILING TODAY** | n/a | NO | n/a | NO |
| Playback sync | YES (`playback-sync.test.ts`) | YES | **FAILING TODAY** | n/a | NO | n/a | NO |
| YouTube provider / policy | YES (`youtube.test.ts`, `media-policy.test.ts`, `youtube-compliance.test.ts`) | YES | **FAILING TODAY** | n/a | NO | **NO** (Data API quota/live search untested) | NO |
| Queue / playlists | YES | YES | **FAILING TODAY** | n/a | NO | n/a | NO |
| Study / research | YES | YES | **FAILING TODAY** | n/a | NO | n/a | NO |
| Local media transport | YES (chunking, resume, sync, diagnostics) | YES | **FAILING TODAY** | n/a | **NO — P2P has never been proven across two real devices/NATs** | n/a | NO |
| Entitlements | YES | YES | **FAILING TODAY** | n/a | NO | NO | NO |
| Ads placement / consent | YES (`placement.test.ts`, `ump.test.ts`, `admob.test.ts`, `admob-production.test.ts`, `native-bridge.test.ts`) | partial | n/a | **NO** | **NO** | **NO — no ad has ever been requested from AdMob** | NO |
| Billing verification / RTDN / recovery | YES (`verification.test.ts`, `rtdn.test.ts`, `reconciliation.test.ts`, `ack-recovery.test.ts`) | partial | n/a | **NO — no billing client exists** | NO | **NO** | NO |
| Push / FCM | YES (`routing.test.ts`) | NO | n/a | NO | **NO** | **NO** | NO |
| Android build / manifest / ProGuard | YES (static assertions in `android-build.test.ts`, `ci-build.test.ts`, `android-security.test.ts`) | n/a | n/a | **NO — Gradle never run** | **NO** | n/a | NO |
| Deep links / App Links | static only | NO | n/a | NO | **NO** | **NO — assetlinks.json missing** | NO |
| Observability / redaction | YES | n/a | n/a | n/a | NO | NO | NO |

**Never tested outside automated/static testing (complete list):** every Android native behaviour (fullscreen, background WebView, splash, back navigation, App Links), all AdMob rendering and UMP form presentation, all Google Play Billing, all FCM delivery and notification tap-routing, YouTube playback on a real device, P2P local media across real networks, subscription lifecycle, and the entire release build/signing pipeline.

---

## PART 19 — CRITICAL FINDINGS (prioritised)

### CRITICAL — must fix before Play upload
| # | Finding | Why it matters | Evidence | Exact fix | Scope | Regression risk |
|---|---|---|---|---|---|---|
| C1 | Privacy policy is a draft that **denies advertising** while AdMob serves, denies file use while P2P media sharing exists, and omits FCM/AAID/purchase tokens/retention/contact | Data Safety must match the policy; mismatch is a rejection and an enforcement trigger | `src/routes/privacy.tsx`; `android/variables.gradle` ads SDK; `rooms.index.tsx:121` | Rewrite the policy against `docs/DATA_SAFETY_DRAFT.md`; add controller/processor list, retention table, contact address | 1 page rewrite | None (content only) |
| C2 | Terms state "Paid plans are not available yet" | False; misleads on auto-renewal/refunds, which Play requires disclosing | `src/routes/terms.tsx:57` | Add subscription terms, auto-renewal, cancellation, refund routing to Play | 1 page | None |
| C3 | **No Google Play Billing client exists** | Premium cannot be purchased; advertising it in the listing would be a false claim | `android/app/build.gradle` deps; no billing Java/plugin | Either integrate a billing client + wire to `verifyPlayPurchase`, or hide Premium for v1 | Large, or trivial if hidden | High if integrating |
| C4 | `assetlinks.json` missing | `autoVerify` App Links silently fail; invite deep links break | no `.well-known` route or asset | Publish `/.well-known/assetlinks.json` with the release signing SHA-256 | Small | None |
| C5 | Test suite does not pass (11 DB suites failing, 194 skipped) | No current evidence that RLS/RBAC/entitlements behave as designed | `bunx vitest run` output | Fix test-user provisioning rate limiting; re-run green | Medium | None |

### HIGH — before closed testing
| # | Finding | Fix |
|---|---|---|
| H1 | `anon` holds INSERT/UPDATE/DELETE on 13 tables (RLS-mitigated only) | `REVOKE ALL … FROM anon` migration + targeted re-grants |
| H2 | Dead call tables retain write grants + realtime membership | Drop tables, drop from publication, remove `max_call_minutes` |
| H3 | Five UGC surfaces (resources, notes, tasks, queue items, room metadata) have **no report control**; local media is unmoderatable | Add report affordances + session-level report |
| H4 | No TURN server → P2P local media will fail on many mobile networks | Provision TURN; add ICE config to the transport grant |
| H5 | Ads never rendered against the real AdMob account | Real device test with test-device IDs, then production |
| H6 | YouTube background-pause ordering vs native `onPause()` unproven | Real device test on ≥3 OEMs |
| H7 | Release APK/AAB has never been compiled, shrunk, or signed | Run the full release pipeline; inspect merged manifest |

### MEDIUM — before production launch
M1 no repeat-offender/enforcement automation · M2 `ConsentDebugSettings` in release builds · M3 WebView-shell / minimum-functionality policy exposure · M4 stale docs asserting readiness and describing removed features · M5 no retention schedule documented · M6 no YouTube/Google privacy disclosures in the policy · M7 no age minimum stated · M8 no support/privacy contact published · M9 no store assets (screenshots, feature graphic) in the repo.

### LOW
L1 98 lint errors · L2 rewarded/app-open dead ad plumbing incl. a live rewarded unit id in the bundle · L3 `premium-gate.tsx` unused · L4 17 unused UI components + `date-fns` · L5 contradictory `AdSlot` type in `providers/types.ts` · L6 `push_tokens` grant/policy mismatch.

### OWNER DECISION REQUIRED
Ship Premium in v1 or hide it (C3) · accept the WebView-shell posture or bundle the web build (M3) · 18+ positioning (Part 10) · whether local-media sharing stays given U2.

### EXTERNAL CONFIG REQUIRED
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_PREMIUM_PRODUCT_ID`, `PLAY_RTDN_AUDIENCE`, `PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`, `BILLING_RECONCILE_SECRET`, `BILLING_TOKEN_RECOVERY_KEY_VERSION`; Pub/Sub topic + push subscription; AdMob account/app/units; TURN server; Android release keystore; `assetlinks.json` hosting.

### REAL DEVICE TEST REQUIRED
Splash → auth restore → last route · back navigation · App Links from a real invite URL · YouTube playback + fullscreen + background pause · local-media P2P across two devices on mobile data · FCM delivery and tap-routing for every notification type · AdMob banner + interstitial rendering and UMP form · release build install and R8 correctness.

### PLAY CONSOLE ACTION REQUIRED
See `docs/PLAY_CONSOLE_CONFIGURATION.md`.

---

## PART 20 — FINAL MASTER RELEASE REPORT

### A. CURRENT APP SNAPSHOT — what SyncTogether actually does today
Email/password accounts with terms acceptance, password reset, in-app and public account deletion, and JSON data export. Private, invite-only rooms created by code or verified invite link, with host controls, host transfer, capacity limits, membership guards and realtime presence. Four room modes: **Watch Together** (YouTube search via the server-side Data API, or pasted link, with authoritative versioned playback state, drift correction, device reconciliation, MFK/embeddability policy gating and a compliance layer that pauses the embedded player when the app is hidden); **Music** (the same YouTube player minimised into a Now Playing bar, driven by a shared authoritative queue with playlists); **Study & Research** (shared resources with URL safety screening, collaborative notes with revisions, tasks, and an authoritative focus timer); **Local Media** (ephemeral peer-to-peer sharing of device photos, videos and audio over a WebRTC data channel, with a pre-flight check, resumable chunked transfer, a browsable queue, per-viewer diagnostics and synchronized playback). Room chat with reactions, edit, delete, mute, reporting and staff moderation with an archive and audit trail. A staff/admin console for the report queue and role management, gated by a separate `user_roles` table. Push and in-app notifications with per-category toggles and deep-link routing. Privacy settings with separate analytics/personalization/ads consent. A consent-gated AdMob banner on the rooms list and one interstitial after a room session ends, both suppressed for Premium. A complete server-side entitlement, purchase-verification, acknowledgement-recovery and RTDN pipeline. Packaged for Android as a hardened Capacitor WebView shell that loads the live origin.

### B. WHAT IS NOT IN THE APP
Voice calls · video calls · camera capture · microphone capture · screen sharing · recording of anything · social/Google/Apple login · anonymous or guest access · random matching or stranger discovery · a public room directory · an in-app web browser · any music provider other than YouTube · server-side hosting or storage of any user media (no storage bucket exists) · YouTube download or audio extraction · end-to-end encryption · rewarded ads · app-open ads · native ads · a Google Play Billing client (server side only) · crash-reporting SDKs (Crashlytics/Sentry) · any AI/LLM feature · location, contacts, calendar, SMS, Bluetooth or health data.

### C. GOOGLE PLAY POLICY RISK SCORE (10 = lowest risk)

| Dimension | Score | Explanation |
|---|---|---|
| User Data & Privacy | **3/10** | The engineering is strong (RLS everywhere, encrypted purchase tokens, log redaction, consent switches, working deletion + export). The *disclosure* is broken: the published privacy policy is a self-labelled draft that denies advertising, understates file handling, omits every third party, and has no contact address or retention schedule. This alone is rejection-grade. |
| UGC & Moderation | **5/10** | Chat and users are properly reportable, blockable, muteable, moderatable and audited, with rate limits and a staff console. But five UGC surfaces have no report control, peer-to-peer media is unmoderatable by construction, and there is no repeat-offender enforcement. |
| Permissions | **9/10** | Best-in-class: only `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`; no storage/media permissions because SAF is used; no camera/mic. One point lost because the merged manifest (and the SDK-injected `AD_ID`) has never been produced or inspected. |
| Ads | **6/10** | Placement policy is exceptionally disciplined — one banner surface, one interstitial transition, a 22-entry forbidden list, dynamic sensitive-flow suppression, fail-closed UMP, premium suppression first. Lost points: nothing has ever rendered against the real AdMob account, a live rewarded unit id ships for a dead format, and debug consent settings are constructed in release builds. |
| Billing | **2/10** | The server half is excellent and genuinely production-grade. The client half **does not exist** — no billing library, no purchase flow, no acknowledgement call site. Required env/secrets are unset and no Play Console configuration is evidenced. Premium cannot be bought today. |
| Third-Party Content | **7/10** | Official APIs only, embed-only, fail-closed on non-embeddable/private/MFK-verification failures, no downloading or audio extraction, server-side keys, no rehosting. Risk remains in framing "Listen together" as music, and in unverifiable rights status of user-shared local media. |
| Security | **7/10** | RLS on all 52 tables, zero SECURITY DEFINER functions without a pinned `search_path`, 63 triggers including ~20 write guards, roles in a separate table, encrypted tokens, cryptographically authenticated webhooks. Deductions: over-broad `anon` grants on 13 tables, dead call tables still writable and in the realtime publication, and the entire database security suite failing today. |
| Store Listing Accuracy | **4/10** | "Private by default" implies encryption the app does not have; "Safety built in" overstates report coverage; "Listen together" invites a music-service reading; Premium is not purchasable; no store assets exist in the repository. |
| Release Readiness | **2/10** | Never compiled, never signed, never installed, never run on a device; no assetlinks; tests failing; lint failing; every external service unconfigured. |

**Composite: 45/90.**

### D. EXACT PLAY CONSOLE CONFIGURATION PLAN
See **`docs/PLAY_CONSOLE_CONFIGURATION.md`** — ordered, step-by-step, with the selection to make, the reason, the code evidence, and the owner input required at each step.

### E. DATA SAFETY DRAFT
See **`docs/DATA_SAFETY_DRAFT.md`**.

### F. FINAL LAUNCH BLOCKERS
1. Privacy policy rewrite (C1).
2. Terms rewrite including subscription terms (C2).
3. Google Play Billing client — integrate, or remove every Premium claim and hide the subscription UI (C3).
4. `assetlinks.json` published for `together-rooms.lovable.app` with the release signing certificate SHA-256 (C4).
5. A green test run (C5).
6. A release AAB actually built, shrunk, signed and installed (H7).
7. `anon` privileges revoked and the dead call tables dropped (H1, H2).
8. Store assets and a support/privacy contact address (M8, M9).

### G. CONDITIONAL GO / NO-GO VERDICT

## **NO-GO** for production submission.
## **CONDITIONAL GO FOR INTERNAL TESTING** — conditional on items 4, 6 and 7 above.

Reasoning, stated plainly: the *server and database* engineering is genuinely strong and, on the evidence, better than most apps at this stage — RLS on every table, no unpinned `SECURITY DEFINER`, write-guard triggers, separated roles, encrypted purchase tokens, cryptographically authenticated webhooks, a disciplined and reviewable ad-placement policy, and a correct minimal permission set. What blocks release is not architecture; it is that **nothing has ever left the repository**. The APK has never been compiled or signed, no Google service (AdMob, Play Billing, FCM, App Links) has ever been exercised, the purchase path does not exist on the client at all, and the two documents Google actually reads — the privacy policy and the terms — currently contradict what the code does. Internal testing is reachable in days; production submission is not, until the billing decision is made and the legal documents are made true.

---

*This audit reports current state only. No findings were fixed during it, and no production behaviour was changed.*
