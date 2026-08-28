# SyncTogether — COMPLETE FEATURE INVENTORY

**Audit date:** 2026-08-27 (UTC). Source of truth: current codebase + live database. Nothing was modified.

Legend for STATUS: `IMPLEMENTED` / `PARTIAL` / `DISABLED` / `REMOVED` / `NOT FOUND` / `NOT VERIFIED`.
"Reachable" = a user can arrive at it from app navigation or a link in the shipped UI.

---

## A. Authentication & Account

| Feature | Status | User-facing | Reachable | Tier | User data | Sensitive perm | 3rd party | Ads | Entitlement | Stores data | Persistence | Server authoritative | Moderation | Play disclosure | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Email/password signup | IMPLEMENTED | Yes | Yes | Both | Email, password | No | Supabase Auth | No | No | Yes | Persistent | Yes | No | Yes (email, credentials) | `src/routes/auth.signup.tsx` |
| Terms + Privacy acceptance gate | IMPLEMENTED | Yes | Yes | Both | Consent | No | No | No | No | No (client gate) | — | No | No | No | `auth.signup.tsx:39,50-51,140-145` |
| Login | IMPLEMENTED | Yes | Yes | Both | Email, password | No | Supabase Auth | No | No | Session | Persistent | Yes | No | Yes | `src/routes/auth.login.tsx`, `src/hooks/useAuth.tsx` |
| Logout | IMPLEMENTED | Yes | Yes | Both | — | No | Supabase | No | No | No | — | Yes | No | No | `useAuth.tsx`, `app-shell.tsx` |
| Password reset (request + set) | IMPLEMENTED | Yes | Yes | Both | Email | No | Supabase Auth email | No | No | Yes | Persistent | Yes | No | Yes | `auth.forgot-password.tsx`, `auth.reset-password.tsx` |
| Social / Google login | **NOT FOUND** | — | — | — | — | — | — | — | — | — | — | — | — | — | no `signInWithOAuth`; `google-services.json` has `"oauth": []` |
| Anonymous / guest access | **NOT FOUND** | — | — | — | — | — | — | — | — | — | — | — | — | — | no `signInAnonymously`; `_authenticated/route.tsx:5-17` gates everything |
| Route auth gate | IMPLEMENTED | Yes | Yes | Both | — | No | No | No | No | No | — | Yes | No | No | `src/routes/_authenticated/route.tsx:5-17` |
| Profile edit (name, username, bio, avatar URL) | IMPLEMENTED | Yes | Yes | Both | Profile data | No | No | No | No | Yes | Persistent | Yes (column-scoped UPDATE grant) | Indirect | Yes | `src/routes/_authenticated/profile.tsx`, `profiles` |
| Account deletion (in-app) | IMPLEMENTED | Yes | Yes | Both | All | No | Supabase Admin API | No | No | Request row retained | Persistent audit | Yes | No | **Yes (required)** | `src/lib/account.functions.ts:41-95`, `account_deletion_requests`, `purge_user_data` |
| Account deletion (public web page, no login) | IMPLEMENTED | Yes | Yes (footer) | Both | Email | No | No | No | No | Yes | Persistent | Yes | No | **Yes (Play URL required)** | `src/routes/delete-account.tsx`, `app-shell.tsx:192` |
| Data export (JSON) | IMPLEMENTED | Yes | Yes | Both | All own data | No | No | No | No | No (generated) | — | Yes (rate-limited RPC) | No | No | `account.functions.ts:9-34`, `export_user_data()` |
| Privacy settings (analytics / personalization / ads consent) | IMPLEMENTED | Yes | Yes | Both | Consent | No | No | Affects ads | No | Yes | Persistent | Yes | No | Yes | `settings.privacy.tsx`, `privacy_settings` |

## B. Rooms

| Feature | Status | User-facing | Reachable | Tier | Stores data | Server authoritative | Notes / Evidence |
|---|---|---|---|---|---|---|---|
| Create room | IMPLEMENTED | Yes | Yes | Both (limits differ) | Yes | Yes | `rooms.new.tsx`, `rooms`, `handle_new_room()`, `trg_enforce_room_entitlement_limits` |
| Rooms list | IMPLEMENTED | Yes | Yes | Both | Yes | Yes | `rooms.index.tsx` (also the only banner-ad surface) |
| Join by code | IMPLEMENTED | Yes | Yes | Both | Yes | Yes | `rooms.join.tsx`, `join_room_by_code` |
| Invite links (tokenised) | IMPLEMENTED | Yes | Yes | Both | Hashed token | Yes | `room-invite-panel.tsx`, `create_room_invite`/`revoke_room_invite`/`redeem_room_invite`, `room_invites.token_hash` |
| Invite landing page | IMPLEMENTED | Yes | Yes (deep link) | Both | Yes | Yes | `src/routes/invite.$token.tsx`; App Link `/invite/*` |
| Room code chip in player | IMPLEMENTED | Yes | Yes | Both | No | — | `watch-together.tsx` room chip |
| Private rooms only | IMPLEMENTED | Yes | Yes | Both | Yes | Yes | No public directory or discovery exists |
| Host controls | IMPLEMENTED | Yes | Yes | Both | Yes | Yes | `room-members-panel.tsx`, `can_moderate_room` |
| Host transfer / succession | IMPLEMENTED | Yes | Yes | Both | Yes | Yes | `transfer_room_host`, `pick_room_successor` |
| Leave / rejoin room | IMPLEMENTED | Yes | Yes | Both | Yes | Yes | `leave_room`; Rejoin button in room detail |
| End room | IMPLEMENTED | Yes | Yes | Both | Yes | Yes | `end_room`, `room_sessions` |
| Capacity limits | IMPLEMENTED | Partly | Yes | Both | Yes | Yes | `set_room_capacity`, `trg_guard_room_capacity`; free 10 / premium 50 |
| Presence & realtime state | IMPLEMENTED | Yes | Yes | Both | Yes | Yes | `useRoomRealtime.ts`, `authorize_room_channel`, `room_events` |
| Membership write guard | IMPLEMENTED | No (internal) | — | — | — | Yes | `guard_room_members` trigger; direct DML blocked |

## C. Watch Together (YouTube)

| Feature | Status | Reachable | 3rd party | Notes / Evidence |
|---|---|---|---|---|
| Provider support | **YouTube only** | Yes | YouTube | `src/lib/providers/youtube.ts`; `registry.ts` wires nothing else |
| YouTube search (server-side) | IMPLEMENTED | Yes | YouTube Data API v3 | `media-search.functions.ts:33-47`; `videoEmbeddable=true`, `safeSearch=strict`; key read inside handler |
| Paste link | IMPLEMENTED | Yes | YouTube | `media-search-panel.tsx` paste tab. **Note: `safeSearch` does not apply to pasted IDs** |
| oEmbed / metadata resolution | IMPLEMENTED | Yes | YouTube | `media-metadata.functions.ts`, `media_metadata_cache` (24 h TTL) |
| Embedded IFrame player | IMPLEMENTED | Yes | YouTube | `watch-together.tsx`; `COMPLIANT_PLAYER_VARS` gate |
| Synchronized playback | IMPLEMENTED | Yes | — | `room_playback_state`, `playback-sync.ts`, versioned optimistic concurrency |
| Drift correction / device reconciliation | IMPLEMENTED | Yes | — | `playback-device.ts` |
| Playback controls + permission model | IMPLEMENTED | Yes | — | `can_control_playback` |
| Made for Kids handling | IMPLEMENTED | Yes | YouTube | `media-policy.ts:16-60` — playable, `tracking_restricted` |
| Embeddability / private / unavailable handling | IMPLEMENTED | Yes | YouTube | fail-closed; `PLAYABLE_STATUSES = ["ok","made_for_kids"]` |
| Analytics suppression for restricted media | IMPLEMENTED | No (internal) | — | `src/lib/ads/analytics-safety.ts`, `local-media/analytics-safety.ts` |
| Background behaviour (compliance pause) | IMPLEMENTED | Yes | — | `youtube-compliance.ts` + `visibilitychange`; **REAL DEVICE TEST REQUIRED** |
| Fullscreen / theatre mode | IMPLEMENTED | Yes | — | `MainActivity.java` `FullscreenWebChromeClient`; web fallback |
| Audio-only extraction | **BLOCKED BY DESIGN** | — | — | `verifyPlayerVisibility` minimum-size enforcement |
| Download / rehost | **NOT FOUND** | — | — | no extraction or storage path exists |

## D. Music

| Feature | Status | Reachable | Notes / Evidence |
|---|---|---|---|
| Music room mode | IMPLEMENTED | Yes | `music-room.tsx`; provider is **YouTube**, rendered as a minimised but visible player |
| Shared authoritative queue | IMPLEMENTED | Yes | `room_media_queue`, `room_queue_settings`, `add_to_queue`, `advance_queue`, `clear_queue`, `bump_queue_version` |
| Queue approval / permission modes | IMPLEMENTED | Yes | `approve_queue_item`, `can_manage_queue` |
| Mini-player transport (prev / play-pause / next + track status) | IMPLEMENTED | Yes | `watch-together.tsx` compact mode; wired to `advance`/`previous` RPCs |
| Search-to-queue | IMPLEMENTED | Yes | `media-search-panel.tsx` inside `music-room.tsx` |
| Playlists | IMPLEMENTED | Yes | `playlists.tsx`, `playlists`, `playlist_items`, `create_playlist`, `add_playlist_item` |
| Local music files | IMPLEMENTED (via Local Media) | Yes | audio is one of the local-media types |
| Independent music API (Jamendo / Audius / Spotify) | **NOT FOUND** | — | evaluated in chat history; never integrated |
| Copyright posture | — | — | Embedded YouTube only; nothing rehosted |

## E. Local Media (private device sharing)

| Feature | Status | Reachable | Sensitive perm | Stores data | Persistence | Notes / Evidence |
|---|---|---|---|---|---|---|
| Share photos / videos / audio from device | IMPLEMENTED | Yes | **No Android permission** — SAF file picker | Metadata only | Ephemeral | `local-media-room.tsx`, `useLocalMedia.ts` |
| Pre-flight permission/capability check | IMPLEMENTED | Yes | No | No | — | `local-media-preflight.tsx`, `local-media/permissions.ts`, `capability.ts` |
| Device-to-device transport | IMPLEMENTED | Yes | No | No | Ephemeral | `useLocalMediaTransfer.ts:190,309,383,397` — `RTCPeerConnection` + `RTCDataChannel`, **file bytes only, no media tracks** |
| Chunking / backpressure | IMPLEMENTED | No (internal) | — | — | — | `chunking.ts`; `CHUNK_BYTES=16KiB`, high/low water 4MiB/1MiB |
| Resume / chunk re-request | IMPLEMENTED | Yes | — | — | — | `resume.ts`, `useLocalMediaTransfer.ts` |
| Multi-item queue (browse without reconnect) | IMPLEMENTED | Yes | — | Metadata | Ephemeral | `local-media-queue.tsx`; `MAX_IMAGE_ITEMS=50`, `MAX_QUEUE_ITEMS=20` |
| Synchronized playback / photo navigation | IMPLEMENTED | Yes | — | Yes | Session | `control_local_media_playback`, `local-media/sync.ts` |
| Per-viewer diagnostics | IMPLEMENTED | Yes | — | No | Session | `local-media-diagnostics.ts`, `local-media-diagnostics.tsx` |
| Transport tokens | IMPLEMENTED | No (internal) | — | Yes | 300 s TTL | `local_media_transport_grants`; **no `authenticated` grants** |
| Signalling | IMPLEMENTED | No (internal) | — | Yes | Ephemeral | `local_media_signals`; RPC-only, not in realtime publication |
| Host disconnect behaviour | IMPLEMENTED | Yes | — | Yes | 20 s heartbeat / 90 s grace | `limits.ts:38-40` |
| Server-side hosting of media | **NOT FOUND (by design)** | — | — | **No** | — | no storage bucket exists in the project |
| Application-layer encryption | **NOT FOUND** | — | — | — | — | relies on WebRTC DTLS only; no E2EE |
| TURN / ICE relay | **NOT FOUND** | — | — | — | — | **functional risk**: P2P will fail behind symmetric NAT |

## F. Study & Research

| Feature | Status | Reachable | Moderation applicable | Notes / Evidence |
|---|---|---|---|---|
| Study room mode | IMPLEMENTED | Yes | — | `study-room.tsx`, `room_study_settings` |
| Shared resources / links | IMPLEMENTED | Yes | **Yes — no report control exists** | `room_resources`, `add_room_resource` |
| URL normalisation & safety screening | IMPLEMENTED | No (internal) | — | `src/lib/url-safety.ts` (+ tests) |
| Collaborative notes + revisions | IMPLEMENTED | Yes | **Yes — no report control** | `room_notes`, `room_note_revisions` |
| Tasks | IMPLEMENTED | Yes | **Yes — no report control** | `room_tasks` |
| Authoritative focus timer | IMPLEMENTED | Yes | No | `room_focus_timer`, `control_focus_timer`, `study-timer.ts` |
| Permission modes (who can edit) | IMPLEMENTED | Yes | — | `can_control_study` |
| Embedded arbitrary web content | **NOT FOUND** | — | — | links render as links; `allowNavigation` restricts the WebView to the app origin |

## G. Communication

| Feature | Status | Reachable | Moderation | Notes / Evidence |
|---|---|---|---|---|
| Room chat | IMPLEMENTED | Yes | Yes | `room-chat.tsx`, `room_messages`, `send_room_message` (rate-limited) |
| Reactions | IMPLEMENTED | Yes | via parent message | `message_reactions`, `toggle_message_reaction` |
| Edit message | IMPLEMENTED | Yes | Yes | `edit_room_message` |
| Delete message | IMPLEMENTED | Yes | Yes | `delete_room_message`; original content moved to `message_moderation_archive` (service_role only) |
| Reply / threading | **NOT FOUND** | — | — | no thread/parent-message field in the chat UI |
| Mute member | IMPLEMENTED | Yes | Yes | `set_member_mute`, `room-members-panel.tsx:80-96` |
| Realtime chat sync | IMPLEMENTED | Yes | — | `useRoomChat.ts`, `postgres_changes` on `room_messages`/`message_reactions` |
| Voice calls | **REMOVED** | No | — | zero `getUserMedia`; no call UI; no `RECORD_AUDIO` |
| Video calls | **REMOVED** | No | — | zero camera code; no `CAMERA` permission |
| WebRTC (media) | **REMOVED** | No | — | WebRTC survives only as a **data channel** for local media |
| Recording | **NOT FOUND** | — | — | no recording code anywhere |
| Call residue (tables, types, key names) | **DEAD CODE** | — | — | see `MASTER_RELEASE_AUDIT.md` Part 14 |

## H. Safety & Moderation

| Feature | Status | Reachable | Server authoritative | Notes / Evidence |
|---|---|---|---|---|
| Report message | IMPLEMENTED | Yes | Yes | `report_message`, `user_reports`, `report-dialog.tsx` |
| Report user / room | IMPLEMENTED | Yes | Yes | `report-dialog.tsx` in `room-members-panel.tsx`, `rooms.$roomId.tsx` |
| Report profile / notes / tasks / resources / queue items / local-media session | **NOT FOUND** | — | — | **coverage gap** |
| Block user | IMPLEMENTED | Yes | Yes | `block-user-button.tsx`, `user_blocks`, enforced in `profiles` RLS via `is_blocked_between` |
| Host mute / remove / ban | IMPLEMENTED | Yes | Yes | `can_moderate_room`, `create_moderation_action` |
| Staff moderation console | IMPLEMENTED | Yes (staff only) | Yes | `admin.index.tsx`, `admin.reports.$reportId.tsx`, `staff-gate.tsx:19-56` + server `is_staff()` |
| Role management | IMPLEMENTED | Yes (admin only) | Yes | `admin.roles.tsx`, `user_roles` (separate table), `assign_app_role`, `has_role()`, `bootstrap_first_admin` |
| Content removal + archive | IMPLEMENTED | Yes | Yes | `message_moderation_archive` (no `authenticated` grants) |
| Audit trail | IMPLEMENTED | Staff read-only | Yes | `audit_logs` (`SELECT` only), `moderation_actions` |
| Rate limiting / anti-spam | IMPLEMENTED | No (internal) | Yes | `consume_rate_limit`, `rate_limits` (no `authenticated` grants) |
| Repeat-offender / enforcement escalation | **NOT FOUND** | — | — | no strike or auto-suspension logic |
| Appeals surface | **NOT FOUND** | — | — | — |
| Automated content classification (NSFW/CSAM/profanity) | **NOT FOUND** | — | — | no classifier or provider integrated |

## I. Monetization

| Feature | Status | Reachable | Notes / Evidence |
|---|---|---|---|
| Free / Premium tiers | IMPLEMENTED (server) | Yes | `plan_limits` (free/premium rows), `entitlements`, `my_entitlement` |
| Subscription products | IMPLEMENTED (data) | — | `synctogether.premium.monthly`, `synctogether.premium.yearly` (live rows) |
| Subscription UI | IMPLEMENTED | Yes | `settings.subscription.tsx` |
| **Purchase flow (Play Billing client)** | **NOT FOUND** | **No** | no `com.android.billingclient` dependency, no billing Java class, no billing Capacitor plugin — **users cannot buy Premium** |
| Restore purchases | PARTIAL / NOT VERIFIED | — | `play-billing.ts` + sensitive-flow constant exist; no client to restore from |
| Server-side purchase verification | IMPLEMENTED | — | `verification.server.ts:188-242` (Play `subscriptionsv2`, fail-closed) |
| Acknowledgement + recovery | IMPLEMENTED | — | `acknowledgement.ts`, `billing_ack_state`, AES-256-GCM token envelope |
| RTDN (Pub/Sub) | IMPLEMENTED | — | `api.public.billing.rtdn.ts:42-57`, Google-signed OIDC, exactly-once |
| Reconciliation | IMPLEMENTED | — | `reconciliation.server.ts:259-405`; `/api/public/billing/reconcile` 404s without its secret |
| Revocation / voided purchases | IMPLEMENTED | — | `rtdn.server.ts:139-148`, `verification.server.ts:319-346` |
| Feature gating by entitlement | IMPLEMENTED | Yes | `useEntitlement.ts`, `entitlements.ts`, `trg_enforce_room_entitlement_limits` |
| Banner ads | IMPLEMENTED | Yes | `rooms.index.tsx:121`, unit `…/9884842805` |
| Interstitial ads | IMPLEMENTED | Yes | `rooms.$roomId.tsx:195` (`room_session_ended`), unit `…/3102038535` |
| Rewarded ads | **DISABLED (dead)** | No | `REWARDED_ADS_ENABLED=false`; no native controller; unit id still ships |
| App-open ads | **DISABLED (dead)** | No | `app_open_enabled:false`; no native controller; no call site |
| Native ads | **NOT FOUND** | — | — |
| Ad-free for Premium | IMPLEMENTED | Yes | `placement.ts:105` premium checked first; banner torn down at `useAds.tsx:247-251` |

## J. Privacy, Consent & Observability

| Feature | Status | Reachable | Notes / Evidence |
|---|---|---|---|
| UMP consent flow | IMPLEMENTED | Yes | `consent.ts`, `ConsentController.java`; fail-closed on any error |
| Privacy Options (re-open consent) | IMPLEMENTED | Yes | `AdPrivacyOptions.tsx`, `shouldOfferPrivacyOptions` |
| App-level analytics consent | IMPLEMENTED | Yes | `privacy_settings`, `analytics_events` insert policy `user_id = auth.uid()` |
| Personalization / ads consent switches | IMPLEMENTED | Yes | `settings.privacy.tsx`; can only tighten platform consent (`consent.ts:93-98`) |
| Structured logging + correlation IDs | IMPLEMENTED | No (internal) | `observability/{logger,correlation,taxonomy}.ts` |
| Log redaction | IMPLEMENTED | No (internal) | `observability/redaction.ts` |
| Monitoring abstraction | IMPLEMENTED | No (internal) | `observability/monitor.ts` (vendor-neutral, no backend wired) |
| Crash reporting SDK (Crashlytics / Sentry) | **NOT FOUND** | — | only `src/lib/android/crash-reporting.ts` app-side helper |
| Encryption in transit | IMPLEMENTED | — | HTTPS only, `usesCleartextTraffic="false"`, system CAs only |
| Encryption at rest (purchase tokens) | IMPLEMENTED | — | AES-256-GCM, `token-crypto.server.ts` |
| Retention schedule | **NOT DOCUMENTED** | — | audit/moderation/billing rows retained indefinitely after deletion |

## K. Notifications

| Feature | Status | Reachable | Notes / Evidence |
|---|---|---|---|
| In-app notification bell + list | IMPLEMENTED | Yes | `notification-bell.tsx`, `useNotifications.ts`, `notifications` (realtime) |
| Push registration (FCM) | IMPLEMENTED | Yes | `@capacitor/push-notifications`, `push-registrar.tsx`, `push_tokens`, `register_push_token` |
| Runtime permission request | IMPLEMENTED | Yes | requested only when the user enables push (`settings.notifications.tsx:100-103`) |
| Per-category toggles (invites / activity / chat / push / email) | IMPLEMENTED | Yes | `settings.notifications.tsx`, `user_settings`, respected by `emit_notification` |
| Server dispatch pipeline | IMPLEMENTED | No (internal) | DB trigger `tg_dispatch_push` → `/api/public/push/dispatch` (constant-time bearer) → `push-send.server.ts` (`FIREBASE_SERVICE_ACCOUNT`) |
| Deep-link tap routing | IMPLEMENTED | Yes | `notifications/routing.ts`; **REAL DEVICE TEST REQUIRED** |
| Notification triggers | IMPLEMENTED | — | `notify_room_message`, `notify_membership`, `notify_playback`, `notify_queue`, `notify_task`, `notify_moderation`, `notify_entitlement` |

## L. Android Shell

| Feature | Status | Notes / Evidence |
|---|---|---|
| Capacitor WebView shell loading the live origin | IMPLEMENTED | `capacitor.config.ts` `server.url = https://together-rooms.lovable.app`; **not a bundled web build** |
| Navigation allow-list | IMPLEMENTED | `allowNavigation: ["together-rooms.lovable.app"]` |
| Splash screen | IMPLEMENTED | `@capacitor/splash-screen`, `launchAutoHide:false`, dismissed by the web app |
| Last-route restore after cold start | IMPLEMENTED | `src/lib/android/last-route.ts` |
| Back navigation | IMPLEMENTED | `src/lib/android/navigation.ts`, `MainActivity.onBackPressed` |
| App lifecycle recovery | IMPLEMENTED | `src/hooks/useAppLifecycle.ts` (note: `inCall` param hard-coded `false` — dead) |
| Background WebView (local media audio) | IMPLEMENTED | `MainActivity.onPause()` re-resumes WebView + timers; **no foreground service** — REAL DEVICE TEST REQUIRED |
| HTML5 fullscreen | IMPLEMENTED | `FullscreenWebChromeClient` |
| App Links (`/invite/*`, `/auth/*`) | PARTIAL | manifest `autoVerify="true"`; **`assetlinks.json` NOT FOUND** |
| Native ads plugin | IMPLEMENTED | `AdsPlugin.java` + banner/interstitial controllers + `ConsentController` |
| Backup / device transfer | DISABLED (intentionally) | `data_extraction_rules.xml`, `allowBackup="false"` |

---

## Counts

- **Features audited: 108** rows across A–L.
- **IMPLEMENTED & reachable: 82**
- **PARTIAL: 4** (restore purchases, App Links, capacity limits UI, repeat-offender handling absent)
- **DISABLED / dead: 3** (rewarded ads, app-open ads, `premium-gate.tsx`)
- **REMOVED: 4** (voice calls, video calls, WebRTC media tracks, camera/mic permissions)
- **NOT FOUND: 15** (social login, anonymous access, replies, TURN, storage bucket, E2EE, native ads, crash SDK, AI features, random matching, public discovery, in-app browser, automated content classification, appeals, repeat-offender automation)
