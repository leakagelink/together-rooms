# SyncTogether — Android production integration (Phase 10)

## 1. Actual architecture

SyncTogether is a **TanStack Start (React 19 + Vite) server-rendered web application**.
Every authoritative mutation is a server function or a `SECURITY DEFINER` RPC behind RLS.

Before Phase 10 there was **no Android packaging at all** — no Capacitor, no Cordova,
no TWA, no `android/` directory, no Gradle files.

Phase 10 adds **Capacitor 8** as a thin, hardened WebView shell:

- `capacitor.config.ts` — app id, WebView flags, navigation allow list.
- `android/` — generated native project, then hardened (manifest, Gradle, XML configs).
- The shell loads the deployed **https origin** (`https://together-rooms.lovable.app`).
  It does **not** ship a static export: server functions are the security boundary,
  so packaging a client-only bundle would move nothing and break everything.

## 2. Package ID and versioning

- Application ID: `com.synctogether.com` (debug builds: `com.synctogether.com.debug`).
- `versionName`: semantic `MAJOR.MINOR.PATCH`, currently `1.0.0`, set in `android/app/build.gradle`.
- `versionCode`: monotonic integer supplied by CI via the `VERSION_CODE` environment
  value (fallback `1` for local builds), so a code is never reused on Play.
- Signing: keystore path/passwords/alias come from environment values only
  (`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`). No credential is committed.

## 3. SDK compatibility

| Setting | Value | Reason |
| --- | --- | --- |
| `minSdkVersion` | 24 (Android 7.0) | Capacitor 8 floor; WebRTC + modern WebView available. |
| `targetSdkVersion` | 36 | Current Play requirement level. |
| `compileSdkVersion` | 36 | Matches target; required by AndroidX versions in use. |
| Java | 21 | Required by AGP/Capacitor 8. |

Versions were not raised beyond what the Capacitor 8 dependency set supports.

## 4. Permission audit

| Permission | Why | When requested | Runtime? | Avoidable? |
| --- | --- | --- | --- | --- |
| `INTERNET` | Entire product is networked | Install-time | No | No |
| `ACCESS_NETWORK_STATE` | Reconnect/offline handling | Install-time | No | Could be dropped if network state UX is removed |
| `CAMERA` | Video calls only | When the member enables video | Yes | Yes, if video calling is removed |
| `RECORD_AUDIO` | Voice/video calls only | When the member joins a call with mic | Yes | Yes, if calling is removed |
| `MODIFY_AUDIO_SETTINGS` | Call audio routing | Install-time | No | Yes, at the cost of routing quality |

Not requested: any storage/media permission (`READ_MEDIA_*`, `READ_EXTERNAL_STORAGE`) —
local media uses the **system picker (SAF)**, which grants per-file access with no
permission. `POST_NOTIFICATIONS` is not declared: the app sends no notifications yet.

Camera and microphone are declared `android:required="false"` so devices without
them still install and use every other feature.

Failure states live in `src/lib/android/permissions.ts`: `denied` (retry allowed),
`permanently_denied` (settings deep link, no re-prompt loop), `unavailable`
(hardware missing). Denial never blocks rooms, chat, watch, music, study,
playlists, moderation or subscription screens.

## 5. Deep links and invite security

- Verified App Links (`android:autoVerify="true"`) for `https://together-rooms.lovable.app/invite/*`
  and `/auth/*` only. No other host or scheme is claimed.
- `src/lib/android/deep-link.ts` re-validates every incoming link: https only,
  own host only, no embedded credentials, no `//` or backslash forms, and only an
  allow-listed path shape. Invite tokens must match the 48-hex server format.
- A pending destination is stored in **session storage** (not persistent), expires
  after 10 minutes, is single-use, and is **re-validated on read** — so a value
  injected by anything else on the device cannot produce an open redirect.
- Nothing about membership is decided on device: `/invite/:token` still calls the
  server function, which validates the token hash, expiry and one-shot consumption.

## 6. Back navigation model

`resolveBackAction()` in `src/lib/android/navigation.ts`:
modal open → close modal; active call → confirm before leaving; otherwise pop
navigation; nothing left to pop → exit the app (the user is never trapped).
Back never ends a room, transfers host or mutates another member.

## 7. Lifecycle, background/foreground and network recovery

`src/lib/android/lifecycle.ts` + `src/hooks/useAppLifecycle.ts`:

- Background/offline produce **no** actions at all — no leave, no end, no host transfer.
- Foreground/online re-read the session and refetch every active authoritative
  query (membership, room, playback, chat, call authorization, realtime; plus
  entitlements after a process restart).
- Room state older than 15s is stale and must be refetched before it is trusted.
- Call/transport authorization is never reused after a background interruption or
  past its server-issued expiry.
- `MutationGuard` de-duplicates authoritative mutations across reconnects
  (chat sends, playback commands, queue mutations, call joins) for 30s.

## 8. WebView security

| Aspect | Setting |
| --- | --- |
| JavaScript | Enabled (required); no `addJavascriptInterface` beyond Capacitor's bridge |
| Navigation | `server.allowNavigation` limited to the app origin |
| External URLs | Handed to the system browser only for the documented allow list |
| File access | No `file://` or `content://` navigation; blocked by policy |
| Mixed content | `allowMixedContent: false`, `usesCleartextTraffic="false"` |
| Release debugging | `webContentsDebuggingEnabled: false`, `debuggable false` |
| Backup / transfer | Disabled (`allowBackup="false"`, extraction rules exclude everything) |
| TLS | Release trusts system CAs only; user CAs are debug-only |

External browser allow list: `play.google.com`, `policies.google.com`,
`support.google.com`, `youtube.com` / `www.youtube.com`. Everything else is blocked.

## 9. Secure storage audit

| Data | Where | Lifetime |
| --- | --- | --- |
| Supabase session | WebView storage via the generated client | Persistent until sign-out; never backed up |
| Analytics consent | localStorage mirror of the authoritative DB row | Persistent, non-sensitive |
| Pending deep-link destination | sessionStorage | ≤ 10 min, single-use, revalidated |
| Room / playback / chat state | React Query cache (memory) | Process lifetime; revalidated on resume |
| Entitlement snapshot | React Query cache (memory) | Refetched on process start |
| Call / transport grants | Memory only | Server-issued TTL; discarded on background |

Nothing sensitive is written to disk by the shell, and device backup/transfer is off.

## 10. Debug vs release

| | Debug | Release |
| --- | --- | --- |
| Application ID | `…​.debug` | `com.synctogether.com` |
| `debuggable` | true | false |
| Minify / shrink | off | on |
| WebView inspection | on | off |
| User CA trust | on | off |
| Verbose logging, test billing, test ads | on | off (`debugCapabilities()`) |

`validateRuntimeConfig()` fails a release configuration that points at localhost,
uses http, contains a placeholder or ships a non-publishable key.

## 11. Environment model

- **Development**: Vite dev mode; local/dev backend allowed; debug capabilities on.
- **Staging/Test**: `staging`/`preview` mode; https backend; debug capabilities on.
- **Production**: `production` mode; https backend, publishable key only, no
  placeholders, no localhost — any violation is reported as a hard problem.

Client values are `VITE_*` only. Secrets stay server-side and are read inside
server function handlers.

## 12. Crash / error reporting boundary

`src/lib/android/crash-reporting.ts` defines a `CrashSink` interface plus redaction
that strips JWTs, `sb_*` keys, emails, 64-hex grant/purchase tokens, bearer/apikey/
password patterns, and drops forbidden context keys (message, content, filename,
url, token, sdp, candidate…). No third-party provider is integrated in this phase.

## 13. Real-device test matrix (required before release)

| Dimension | Cases |
| --- | --- |
| Android versions | 7.0 (minSdk 24), 12/13 (middle), 15/16 (latest) |
| Network | Wi-Fi, mobile data, Wi-Fi→mobile, mobile→Wi-Fi, offline, reconnect |
| Permissions | camera granted/denied/permanently denied, mic granted/denied, no camera device |
| Features | room join, invite deep link (cold + warm start), YouTube sync, music room, study room, chat pagination, local media (photo/video/audio), voice call, video call, background/foreground, process death restore |
| UI | portrait, landscape, keyboard open/close, small (≤5"), large/tablet, font scale 200% |
| Billing | Play test track only (no production products in this phase) |

## 14. What is verified automatically vs. on device

- **Automated (this repo)**: configuration validation, deep-link/open-redirect rules,
  back-navigation model, lifecycle revalidation plan, stale state/authorization rules,
  reconnect de-duplication, permission model, crash redaction, external navigation
  policy, plus the full Phases 1–9 regression suite.
- **Emulator**: manifest merge, Gradle assemble, App Link routing, orientation and
  keyboard behaviour.
- **Physical device**: camera/microphone acquisition and switching, WebRTC quality,
  real network transitions, system picker behaviour per OEM, process death.
- **External configuration**: Play Console signing, App Links `assetlinks.json`
  hosting, subscription products, AdMob production units.
