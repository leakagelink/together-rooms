# SyncTogether — GOOGLE PLAY REVIEWER ACCESS PLAN

**Audit date:** 2026-08-27 (UTC). Paste the relevant sections into Play Console → App content → **App access** and **Testing instructions**.

---

## 1. Why reviewer credentials are mandatory

Every feature in SyncTogether sits behind authentication. `src/routes/_authenticated/route.tsx` redirects any unauthenticated visitor to `/auth/login`, and there is no guest, demo, or anonymous mode. Without credentials a reviewer can only reach the login, signup, password-reset, privacy, terms, and delete-account pages — and would almost certainly reject the app as non-functional.

Play Console → App access → select **"All or some functionality is restricted"**.

## 2. Reviewer account to provision

Create a real account through the normal signup flow (do **not** insert rows directly, or the profile trigger and entitlement rows will be inconsistent).

| Field | Value to use |
|---|---|
| Email | `play-reviewer@synctogether.app` (owner-controlled inbox) |
| Password | strong, static, no rotation during review |
| Display name | `Play Reviewer` |
| Role | ordinary user — **do not grant `admin` or `moderator`** |
| Tier | see section 4 |

Also provision a **second** account (`play-reviewer2@synctogether.app`) so the reviewer can test the multi-user features — joining a room, chat, and synchronized playback — which are meaningless with one account. Play's App access form accepts multiple credential sets; add both.

Pre-seed the primary account with:
- one room already created in **Watch Together** mode, containing a queued, embeddable, non-Made-for-Kids video,
- one room in **Music** mode with 3 queued tracks,
- one room in **Study** mode with a note, a task, and a resource link,
- a couple of chat messages in each so the screens are not empty.

Provide the join codes in the testing instructions so the second account can enter the same rooms instantly.

## 3. No OTP, no device binding

Login is email + password through Supabase Auth. There is no SMS OTP, no 2FA, and no device allow-list, so nothing blocks a reviewer on unfamiliar hardware. Email confirmation must be **already completed** for both reviewer accounts before submission — otherwise the reviewer hits an unconfirmed-email wall.

## 4. Premium / paid features

**Current state:** the Google Play Billing client is not integrated (`docs/RELEASE_BLOCKERS.md` C3), so nothing can be purchased on-device.

- **If v1 ships without purchases:** remove all Premium purchase UI and state in the notes that the app is free with ads and no in-app purchases.
- **If v1 ships with purchases:** grant the reviewer account a Premium entitlement server-side **in addition** to leaving the purchase flow live, and say so explicitly, so the reviewer can see both the ad-supported and ad-free experiences. Also list the product IDs `synctogether.premium.monthly` and `synctogether.premium.yearly` and confirm they are activated in Play Console.

## 5. Ads during review

The free tier shows a banner on the rooms list and an interstitial when a room session ends. In the EEA/UK a UMP consent form appears on first launch and must be completed before ads serve. Tell the reviewer this is expected, and that consent can be re-opened from Settings → Privacy.

## 6. Notifications

The app asks for the notification permission only when the reviewer enables push in Settings → Notifications. It is not requested at launch. Say so, so the absence of a launch-time prompt is not read as a broken feature.

## 7. Local media sharing

Sharing local photos/videos/audio uses the Android system file picker (Storage Access Framework) — **no storage permission is requested**, and nothing is uploaded to our servers; bytes travel device-to-device over an encrypted WebRTC data channel. This is worth stating explicitly, because reviewers otherwise expect a media permission for a media-sharing feature. Note also that a peer-to-peer transfer between two devices on restrictive mobile networks may not connect (no TURN relay yet), so recommend testing both devices on the same Wi-Fi network.

## 8. Suggested testing instructions text

> SyncTogether requires an account; all features are behind login. Two test accounts are provided.
>
> 1. Sign in with account 1. You land on the rooms list, which shows an ad banner (free tier).
> 2. Open the pre-created room "Watch Demo" — the YouTube player and chat appear in the first tab.
> 3. On a second device (or after signing out), sign in with account 2 and use Join → enter code `<CODE>` to enter the same room. Playback and chat stay synchronized between the two accounts.
> 4. Music and Study rooms are reachable from the rooms list and demonstrate the shared queue and the shared notes/tasks/timer.
> 5. "Share from this device" uses the Android file picker; no storage permission is requested and no media is uploaded to our servers. For the most reliable peer-to-peer connection, keep both devices on the same Wi-Fi network.
> 6. Notification permission is only requested if you enable push in Settings → Notifications.
> 7. Account deletion is available in-app under Settings and, without signing in, at https://together-rooms.lovable.app/delete-account
>
> The app contains user-generated content (chat, notes, shared links). Reporting, blocking, muting, and host removal controls are available from the member list and message menus.

## 9. Owner checklist before submitting

- [ ] Both reviewer accounts created via signup and email-confirmed
- [ ] Demo rooms seeded and join codes noted in the instructions
- [ ] Credentials entered in Play Console → App access
- [ ] Testing instructions pasted into the release notes field
- [ ] Premium decision made (hide purchase UI, or integrate billing and grant the reviewer an entitlement)
- [ ] Confirmed the reviewer account holds **no** staff role
