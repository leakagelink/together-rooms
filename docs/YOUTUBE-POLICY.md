# SyncTogether — YouTube Watch Together (Phase 4) policy boundaries

## Which integration is used

Only the official **YouTube IFrame Player API** (`https://www.youtube.com/iframe_api`),
loaded in the browser and rendered as a standard YouTube embed inside the room page.
No server-side YouTube API calls are made, and no YouTube Data API key is used, so
Phase 4 has **no YouTube search**.

## What is sent to YouTube

- The embed request itself, made by the participant's own browser: video ID, referrer
  (the SyncTogether origin), and whatever the browser normally sends (IP, user agent,
  YouTube cookies if the user is signed in to Google in that browser).
- Player commands issued locally (`playVideo`, `pauseVideo`, `seekTo`).

SyncTogether does not send account identity, room identity, chat content, or member
lists to YouTube.

## What SyncTogether stores

One row per room in `room_playback_state`:

| Column                                                                                   | Purpose                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `provider`                                                                               | `youtube` (the only allowed value today)           |
| `provider_media_id`                                                                      | the 11-character video ID — **not** the pasted URL |
| `title`, `thumbnail_url`                                                                 | optional display cache supplied by the controller  |
| `playback_status`, `position_seconds`, `playback_started_at`, `version`, `controlled_by` | synchronization state                              |

The pasted URL is parsed client-side and discarded; only the video ID is transmitted.
There is no per-user watch history, no per-second progress log, and no record of how
much of a video anyone watched. Ending or deleting a room removes the row with it
(`ON DELETE CASCADE`), and `purge_user_data` continues to cover user-owned rows.

Analytics events for playback respect the existing consent gate — nothing is emitted
before consent.

## What SyncTogether does NOT do

- No downloading of YouTube videos.
- No stream extraction, URL extraction, or media proxying.
- No re-hosting, caching, or storage of media bytes.
- No ad blocking or ad skipping.
- No DRM circumvention and no bypassing of embedding, age, or region restrictions:
  if YouTube refuses to embed a video, the room shows a "video unavailable" state.
- No claim of ownership over any YouTube content.

Videos that the uploader has disabled for embedding simply do not play; SyncTogether
has no fallback path for them by design.

## Write behaviour (performance)

Database writes happen only on state-changing commands: media set/cleared, play,
pause, seek. There is no continuous position writing, no polling loop that writes,
and drift correction is strictly client-side (seek the local player, never write).
Expected steady-state cost while watching a video end-to-end is a handful of rows'
worth of updates, not one per second.

## Feedback-loop prevention

Applying remote state to the local player sets a suppression flag that is cleared
after the player's own `onStateChange` events settle; events that fire while the flag
is set never produce a mutation. Every mutation additionally carries the
`expected_version` the client last saw, so a duplicated or late command is rejected by
the database with a `version_conflict` instead of being applied twice.

## Legal status

This document describes implementation boundaries only. It is **not** a claim of
YouTube/Google approval, YouTube API Services compliance certification, Google Play
approval, or legal review of any kind.

## Phase 4.1 — provider hardening (verified behaviour)

### Metadata provenance
Titles and thumbnails supplied by any client are ignored and stored as `NULL`;
`set_room_media` accepts only `provider` + `provider_media_id`. Titles are resolved
at display time from YouTube's public oEmbed endpoint **server-side**, sanitized, and
thumbnails are accepted only from `i.ytimg.com`. The UI labels each title as
`provider` (oEmbed-verified) or `fallback` (derived locally), so an unverified title
can never masquerade as trusted metadata.

### Failure states
Player errors are classified rather than surfaced raw: `2` → invalid id,
`5` → player init failed, `100` → unavailable/removed/private,
`101`/`150` → embedding disabled by the uploader. Each state renders an explicit
message; there is no silent black player and no retry loop that hammers YouTube.

### Autoplay and user gesture
When a browser refuses programmatic playback, the room shows a "Tap to Sync & Play"
overlay. The gesture recomputes the expected position from the authoritative row at
the moment of the tap — it never resumes from a stale offset and never writes to the
database. Participants who are blocked cannot mutate room state at all.

### Clock and reconciliation
The client's clock offset is re-measured on load, reconnect, foreground and manual
resync, throttled to at most one measurement per 30s and refreshed when older than
10 minutes. Returning from background reconciles by re-deriving position from
`playback_started_at` + `position_seconds`, re-verifying membership, and seeking
locally.

### Trust boundary
Local device problems — provider failure, blocked autoplay, drift, backgrounding —
are corrected locally only. The only writers to `room_playback_state` are the
SECURITY DEFINER RPCs, gated by membership, control permission, room status,
rate limits and `expected_version`.

## Phase 4.2 — YouTube policy completeness (verified behaviour)

### Made for Kids (MFK) and data-minimization
Before any video becomes the room's media, `set_room_media` calls the server-side
YouTube Data API policy check. The Data API key (`YOUTUBE_DATA_API_KEY`) is a
server secret and is never sent to the browser. Results are cached in
`media_metadata_cache` for 24 hours to limit quota use.

- `made_for_kids = true` → rejected (`reason: 'made_for_kids'`).
- `embeddable = false` → rejected (`reason: 'not_embeddable'`).
- `privacy_status` is `private` or `status` is `unavailable` → rejected.
- `status = ok` and `embeddable = true` and `made_for_kids = false` → accepted.

The cache is read-only to authenticated users. The only writes happen through the
`upsert_media_metadata_cache` SECURITY DEFINER function, which validates the
provider (`youtube`) and the 11-character media ID format.

### Metadata integrity
Client-supplied `title` and `thumbnail_url` are ignored by `set_room_media`. The
stored `title` and `thumbnail_url` come from the policy resolution path, and
thumbnails are only accepted from YouTube's own image host (`i.ytimg.com`). A
`policy_check_result` snapshot is stored on `room_playback_state` so the UI can
display the resolved status and provenance.

### Referrer-Policy and embedded-player integrity
The application sets `<meta name="referrer" content="no-referrer">` so the browser
does not send the room URL or user path to YouTube. This is a deliberate privacy
choice and may cause YouTube player error `153` (client identity/referrer) for
certain videos. The player error classifier treats `153` as an unavailable/referrer
failure and shows an explicit message instead of retrying or falling back.

The player is rendered with `controls: 1` and `modestbranding: 1` so the standard
YouTube controls, branding and attribution remain visible. The tap-to-sync overlay
uses `pointer-events-none` everywhere except the action button so the underlying
player controls remain reachable. No overlay hides the title, attribution, or ads.

### Background playback prevention
When the document becomes hidden (`visibilitychange`), the local player is paused
without writing to the room state. Returning to the tab re-derives the current
position from the authoritative row and resumes from the correct offset. The room
keeps playing for everyone else; the hidden tab is simply muted.

### WebView / Android integrity
The application uses the official YouTube IFrame API (`www.youtube.com/iframe_api`)
and renders the player on the privacy-enhanced host (`youtube-nocookie.com`). No
WebView-specific URL schemes, video extraction, or native players are used. The
same policy checks, RLS guards, and rate limits apply regardless of whether the
client is a desktop browser or an Android WebView.

