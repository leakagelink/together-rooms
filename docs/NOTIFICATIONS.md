# Notifications

## In-app (live now, no external service)

Notifications are produced by database triggers, so they cannot be forged by a
client:

| Event | Type | Who is notified |
| --- | --- | --- |
| New room chat message | `chat_message` | Joined members except the sender (max one unread per room / 5 min) |
| Invited to a room | `room_invite` | The invited user |
| Member joins / leaves | `member_joined`, `member_left` | Other members / the host |
| Room media changes | `playback` | Members except the controller (1 min dedupe) |
| Queue item added | `queue` | Members except the adder (2 min dedupe) |
| Task assigned | `study` | The assignee |
| Moderation action | `moderation` | The target user |
| Plan / subscription change | `subscription` | The subscriber |

Delivery: `notifications` is in the `supabase_realtime` publication and RLS
scopes every row to `user_id = auth.uid()`. The bell in the app header
(`src/components/notification-bell.tsx`, `src/hooks/useNotifications.ts`)
subscribes once per signed-in user.

Read state is changed only through `mark_notifications_read(_ids)` and
`clear_notifications()`. Per-user preferences in `user_settings`
(`notify_room_invites`, `notify_room_activity`) are enforced inside
`emit_notification`, before the row is written.

## Push notifications (Android, optional next step)

Push uses Firebase Cloud Messaging, which is free. Plumbing already in place:

- `push_tokens` table (own-row read/delete only)
- `register_push_token(_token, _platform)` RPC

Remaining work, which needs assets only the app owner can create:

1. Create a Firebase project and add an Android app with package
   `com.synctogether.com`.
2. Download `google-services.json` into `android/app/`.
3. Install `@capacitor/push-notifications`, request permission after sign-in,
   and call `register_push_token` with the FCM registration token.
4. Store the FCM HTTP v1 service-account credential as a server secret and send
   messages from a server function fanning out over `push_tokens`.

Play Store notes: Android 13+ requires the runtime `POST_NOTIFICATIONS`
permission prompt, and the Data Safety form must declare that device
identifiers (the FCM token) are collected for app functionality.
