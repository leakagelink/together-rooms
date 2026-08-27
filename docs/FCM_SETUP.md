# FCM Push Notifications — Setup

## Done in the app

- `android/app/google-services.json` installed (project `sync-b99e0`, package `com.synctogether.com`).
- `@capacitor/push-notifications` installed; the Gradle `google-services` plugin was already wired.
- `POST_NOTIFICATIONS` permission declared and requested at runtime (Android 13+).
- Device token registered after sign-in via `register_push_token` (`src/lib/android/push.ts`).
- Server-side FCM HTTP v1 sender in `src/lib/notifications/push-send.server.ts`.

## Remaining step (one secret)

The sender needs a Firebase service account key:

1. Firebase Console → gear icon → **Project settings** → **Service accounts**.
2. **Generate new private key** → downloads a JSON file.
3. Give the whole JSON contents to be stored as the secret `FIREBASE_SERVICE_ACCOUNT`.

Never commit that JSON to the repo — it is a full server credential.

## Building the Android app

```powershell
npx cap sync android
```

Then run/assemble in Android Studio. Push only works on a real device/emulator
with Google Play services, not in the browser preview.

## Delivery pipeline (live)

1. A database trigger writes a row into `notifications`.
2. `tg_dispatch_push` calls `POST /api/public/push/dispatch` through pg_net with
   a shared bearer secret (`PUSH_DISPATCH_SECRET`, mirrored in the
   service-role-only `push_dispatch_config` table).
3. The route loads the notification with the service-role client and sends it to
   every registered device of that user via FCM HTTP v1.
4. Dead tokens (403/404) are deleted automatically.

Push failures never block the in-app notification write.

## Security note

The service-account key was shared in chat during setup. Rotate it in
Firebase Console → Project settings → Service accounts (generate a new key,
delete the old one) and re-save `FIREBASE_SERVICE_ACCOUNT`.
