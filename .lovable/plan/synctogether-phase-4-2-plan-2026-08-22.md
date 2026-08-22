# SyncTogether — Phase 4.2 Plan

## Goal
Harden the YouTube provider layer for policy completeness (MFK, metadata provenance, referrer policy, embedded player integrity, background playback, Android/WebView integrity) and add 14 YT-POLICY tests.

## Scope

### 1. Database
- Add `media_metadata_cache` table with TTL, policy flags (`made_for_kids`, `embeddable`, `privacy_status`, `status`), and least-privilege grants/RLS.
- Add `policy_check_result` JSONB column to `room_playback_state` to record the last policy decision.
- Update `set_room_media` RPC to reject MFK, non-embeddable, unavailable, or malformed videos, and to record the policy snapshot.
- Revoke direct DML on `media_metadata_cache` from authenticated/anon.

### 2. Server-side metadata + policy engine
- `src/lib/media-policy.ts`: pure functions that map a YouTube Data API response to a policy decision (MFK, embeddable, privacy status, title, thumbnail, TTL). No secrets.
- `src/lib/media-policy.test.ts`: unit tests for malformed data, MFK, non-embeddable, private/unavailable, cache TTL, and fallback behaviour.
- `src/lib/media-metadata.functions.ts`: update `resolveYouTubeMetadata` to first call the Data API (server-side only, `YOUTUBE_DATA_API_KEY` from env), cache the result, and fall back to oEmbed if the Data API fails. Reject MFK and non-embeddable videos.
- `src/lib/media-cache.functions.ts`: authenticated server functions to read/write cache entries (thin wrappers over RPCs).
- `src/lib/playback.functions.ts`: `setRoomMedia` calls the policy check before the RPC and passes the verified policy result.
- `src/lib/providers/media-provider.ts`: add new error kinds (`policy_blocked`, `made_for_kids`, `not_embeddable`, `privacy_blocked`) and `MediaPolicy` type.

### 3. Referrer policy
- Add `Referrer-Policy: strict-origin-when-cross-origin` to the root route head meta tags.
- Set `referrerpolicy="strict-origin-when-cross-origin"` on the YouTube IFrame player options.

### 4. Embedded player integrity
- Adjust `WatchTogether` so overlay text and controls never block the underlying YouTube player when a video is loaded; the player container keeps `pointer-events-auto` and YouTube branding/controls remain accessible.
- Add a small, non-blocking metadata provenance label beneath the player.

### 5. Background playback prevention
- Add a `visibilitychange` listener in `useRoomPlayback` that pauses the *local* player when the tab is hidden, without mutating the room. Resync on foreground return.
- Add a `backgroundPaused` flag to the hook return for UI feedback.

### 6. Android/WebView integrity
- Add lightweight `isWebView()` detection in `src/lib/playback-device.ts`.
- In `WatchTogether`, when WebView is detected, require a user gesture before the first programmatic `loadVideoById` and show a dedicated "Tap to play in this app" overlay.

### 7. Tests
- Create `scripts/security/youtube-policy.test.ts` with YT-POLICY-T1…T14, covering:
  1. Data API key is not exposed to the client.
  2. Malformed media IDs are rejected.
  3. MFK videos are rejected.
  4. Non-embeddable videos are rejected.
  5. Unavailable/private videos are rejected.
  6. Policy cache is populated and TTL respected.
  7. oEmbed fallback is used when Data API errors.
  8. Caller-supplied metadata is still ignored.
  9. Direct writes to `media_metadata_cache` are blocked.
  10. Background tab pauses locally only.
  11. Referrer policy is set.
  12. Player controls/branding remain accessible.
  13. WebView is detected and handled.
  14. Analytics events are suppressed for MFK content.

### 8. Documentation
- Update `docs/YOUTUBE-POLICY.md` with Phase 4.2 boundaries: MFK rejection, metadata provenance, cache TTL, referrer policy, background playback, WebView handling, and analytics suppression.

### 9. Quality
- Lint clean, typecheck clean, build clean, all tests pass (target: 160+ total).
