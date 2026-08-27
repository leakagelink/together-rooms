# Play Console submission checklist — SyncTogether

Package: `com.synctogether.com`

## 1. Account deletion (required)

- Public URL: `https://together-rooms.lovable.app/delete-account`
- Paste this exact URL in Play Console → App content → **Data deletion**.
- In-app path: Settings → Privacy & data → Delete my account.

## 2. Reviewer test account

Provide in Play Console → App content → **App access** → "All or some functionality is restricted".

```
Login required: Yes
Email:    reviewer@synctogether.app
Password: <set a real password in the auth provider before submitting>
Notes:
  1. Sign in with the credentials above.
  2. Tap "Create room" to open a room; use "Join by code" for an existing room.
  3. Watch / Music / Study / Local media / Call modes are selectable inside a room.
  4. Premium features can be reviewed without purchase — the test account is
     pre-entitled to Premium.
```

Create the account before submission and confirm the email so no verification mail blocks review.

## 3. Data Safety form answers

| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Email address | Yes | No | Account management | Required |
| Name / username / photo | Yes | No | Account management, app functionality | Required |
| User-generated content (messages, notes, tasks, playlists) | Yes | No | App functionality | Required |
| App interactions (analytics) | Yes | No | Analytics | Optional (consent toggle) |
| Advertising ID | Yes | Yes (AdMob) | Advertising | Optional (UMP consent) |
| Purchase history | Yes | No | App functionality, fraud prevention | Required |

- Data is encrypted in transit: **Yes**.
- Users can request data deletion: **Yes** (URL above).
- Independent security review: **No** (unless commissioned).

## 4. Advertising ID declaration

App content → Advertising ID → **Yes, uses advertising ID**, purposes: *Advertising or marketing*
and *Analytics*. AdMob is integrated with UMP consent; ads are suppressed for Premium users and on
launch, exit, playback and call screens (see `docs/ADMOB_PRODUCTION.md`).

## 5. Remaining manual steps

- Content rating questionnaire (social features + user-generated content + ads).
- Target audience: 18+ (no children's category — avoids Families policy scope).
- Privacy policy URL: `https://together-rooms.lovable.app/privacy`.
- Upload signed AAB (`docs/LOCAL_BUILD_VIDEO_GUIDE.md`) to Closed testing first.
