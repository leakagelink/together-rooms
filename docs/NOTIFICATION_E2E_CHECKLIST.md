# Notification end-to-end device checklist

Routing is defined once in `src/lib/notifications/routing.ts` and used by both
the in-app bell and the Android push-tap handler (`src/lib/android/push.ts`).
Unit coverage: `src/lib/notifications/routing.test.ts`.

Build: `npx cap sync android && npx cap open android`, install on the device,
sign in on two accounts (A on device, B on web).

| # | Trigger (from account B) | Type | Expected screen on tap |
|---|---|---|---|
| 1 | Send a chat message in a shared room | `chat_message` | Room → Chat tab |
| 2 | Invite A to a room | `room_invite` | Room → Stage tab |
| 3 | A third user joins the room A hosts | `member_joined` | Room → People tab |
| 4 | A member leaves the room A hosts | `member_left` | Room → People tab |
| 5 | Play/pause/seek a video | `playback` | Room → Stage tab |
| 6 | Add/skip a queue track | `queue` | Room → Stage tab |
| 7 | Assign a task to A | `study` | Room → Stage tab |
| 8 | Moderation action against A | `moderation` | Room → Chat tab |
| 9 | Subscription state change | `subscription` | Settings → Subscription |

For each row verify: banner arrives with app foreground / background / killed,
tap opens the exact screen above, badge count drops, and the item is marked read.
