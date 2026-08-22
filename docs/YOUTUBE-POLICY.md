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
