# SyncTogether — Final Release Steps (C4, H3, H7 + Play Console)

Everything below is a manual/action item. Code-side work is done.
Package: `com.synctogether.com` · Domain: `https://together-rooms.lovable.app`

---

## C4 — Publish `assetlinks.json` (deep links open in the app)

A placeholder file already exists at `public/.well-known/assetlinks.json`.
You only need to paste the real fingerprints and publish.

### Step 1 — Get your Play App Signing SHA-256
1. Play Console → your app → **Test and release → Setup → App signing**
2. Copy the value under **App signing key certificate → SHA-256 certificate fingerprint**
   (format: `AB:CD:EF:...`, 32 pairs)

> If you have not uploaded a build yet, this page appears after your first AAB upload.
> Do that first (see H7 Step 1), then come back.

### Step 2 — Get your upload key SHA-256
In PowerShell, from the project folder:

```powershell
keytool -list -v -keystore .\android\app\release.keystore -alias <your-alias>
```
Copy the `SHA256:` line.

### Step 3 — Paste both into the file
Open `public/.well-known/assetlinks.json` and replace:
- `REPLACE_WITH_RELEASE_SIGNING_SHA256` → upload key SHA-256
- `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` → Play App Signing SHA-256

Keep both — Play re-signs your app, and the upload key is what you test with locally.

### Step 4 — Publish and verify
1. Publish the project (Publish button) so the file goes live.
2. Open in a browser: `https://together-rooms.lovable.app/.well-known/assetlinks.json`
   → must return the raw JSON, **HTTP 200, no redirect**.
3. Run Google's verifier:
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://together-rooms.lovable.app&relation=delegate_permission/common.handle_all_urls`
   → expect `"maxAge"` and your package in the response, no `errorCode`.

### Step 5 — Verify on device
```powershell
adb shell pm get-app-links com.synctogether.com
```
Expect `verified` for `together-rooms.lovable.app`. If it says `legacy_failure`, force re-check:
```powershell
adb shell pm verify-app-links --re-verify com.synctogether.com
```
Then tap an invite link from WhatsApp — it must open the app, not Chrome.

---

## H3 — TURN relay for "Share from this device"

P2P currently uses STUN only, so transfers fail behind carrier-grade NAT
(common on Indian mobile networks). Two ways to close this.

### Option A (recommended, paid but cheap) — managed TURN
1. Create an account on a TURN provider (Metered / Xirsys / Twilio Network Traversal).
2. Get: TURN URL(s), username, credential.
3. Add them as project secrets — tell me the values are ready and I will wire them
   into the ICE configuration and expose them through a short-lived server function
   (credentials must never be hardcoded in the app).
4. Retest sharing between two devices on **different mobile networks** (not same Wi-Fi).

### Option B (free, self-hosted) — coturn
1. Any small VPS with a public IP.
2. Install `coturn`, enable `lt-cred-mech`, open UDP/TCP 3478 and 5349 + relay range.
3. Use a static-auth-secret and generate time-limited credentials server-side.
4. Same step 3–4 as above.

### Option C (ship now) — expectation-setting only
Not a policy blocker. If you want to launch first, we keep STUN-only and show a
clear "couldn't connect on this network, try Wi-Fi" fallback message. Say the word
and I'll add that message; then mark H3 as accepted-risk in `RELEASE_BLOCKERS.md`.

---

## H7 — Real-device verification on the signed build

### Step 1 — Build the signed AAB
```powershell
bun run build
npx cap sync android
cd android
.\gradlew.bat bundleRelease
```
Output: `android\app\build\outputs\bundle\release\app-release.aab`

For device testing you also want an installable build:
```powershell
.\gradlew.bat assembleRelease
adb install -r .\app\build\outputs\apk\release\app-release.apk
```

### Step 2 — Run this checklist on a physical phone
Record pass/fail for each; this is the evidence H7 asks for.

| # | Test | Expected |
| --- | --- | --- |
| 1 | Cold start | Splash shows, no white screen |
| 2 | First launch | UMP consent form appears; choose "Consent" |
| 3 | Ads | Banner/interstitial renders; never over player controls or delete-account |
| 4 | Re-launch after consent | No form again; privacy settings can reopen it |
| 5 | Sign up | Password checklist works, account created first try |
| 6 | Restart app while signed in | Lands on last screen, not Home |
| 7 | Create room → invite link → open on 2nd phone | Opens in app (needs C4 done) |
| 8 | Watch Together | Search works, both phones stay in sync, seek syncs |
| 9 | Fullscreen | Video goes truly fullscreen, no "blocked by browser" |
| 10 | Music room | Queue add, next/prev, status visible to both users |
| 11 | Study room → Surf | Search results render in-app; blocked host shows fallback card |
| 12 | Share from this device | Consent tick → Start sharing enabled → 2nd phone receives media |
| 13 | Notification | Send a room event; tap notification → routes to correct room |
| 14 | Android back button | Never exits app from inside a room; exits from Home |
| 15 | Minimize + resume | Room reconnects, YouTube pauses (expected, ToS) |
| 16 | Delete account | `/delete-account` flow completes; account gone |

### Step 3 — Test on Play's own track
Upload the AAB to **Internal testing** first. App Links and Play App Signing only
behave correctly on a Play-signed build.

---

## Play Console forms — fill order

Do them in this exact order; each unlocks the next.

### 1. Create the app
Play Console → **Create app** → name `SyncTogether`, language, **App**, **Free**.

### 2. Store listing
- App name / short description / full description → copy from `docs/ASO_STORE_LISTING.md`
- App icon 512×512, feature graphic 1024×500
- Phone screenshots: watch together → music queue → study room → chat → sharing (min 4)

### 3. App content (left menu → Policy → App content)
Complete every card:

**Privacy policy**
`https://together-rooms.lovable.app/privacy`

**Ads**
"Does your app contain ads?" → **Yes**

**App access**
Choose **All functionality is available without special access**? → **No**.
Provide a reviewer test account + steps from `docs/REVIEWER_ACCESS_PLAN.md`.

**Content rating**
Category: Social / Communication. Answer honestly:
- User-generated content → **Yes**
- Users can interact / share content → **Yes**
- Users can share their location → **No**
- Digital purchases → **No**
- Violence, sexual content, drugs, gambling → **No**

**Target audience and content**
Target age: **13+** (do NOT tick under-13 — the app is not Families-policy designed).
"Could appeal to children" → **No**.

**News app** → No · **COVID contact tracing** → No · **Data safety** → next section
**Government app** → No · **Financial features** → None

**Data safety** — use `docs/DATA_SAFETY_DRAFT.md` verbatim. Key answers:
- Data collected: Email, User IDs, App interactions, Crash logs, Advertising ID, Photos/Videos*, Messages
- *Local media is P2P and NOT collected — declare it as "not collected", only session metadata
- Encrypted in transit → **Yes**
- Users can request deletion → **Yes**, URL `https://together-rooms.lovable.app/delete-account`
- Data shared with third parties: Advertising ID (AdMob), Device IDs (FCM)

**Advertising ID declaration** → Yes, used for **Advertising or marketing** + **Analytics**

### 4. Monetisation
**Products → In-app products** → leave empty. Do not enable subscriptions.
App pricing → **Free** (irreversible — correct for you).

### 5. Release
- **Testing → Internal testing** → upload AAB → add your own email as tester → install → run H7 checklist
- Then **Production → Create new release** → upload the same AAB
- Release notes: short, e.g. "First release: watch, listen and study together in sync rooms."
- **Send for review**

### 6. After first review
- Expect 1–7 days. If rejected, the reason names a specific policy — send it to me and I'll fix the code side.
- Re-check `adb shell pm get-app-links` after the Play-signed build is live.

---

## Quick status

| Item | Owner | Blocks launch? |
| --- | --- | --- |
| C4 assetlinks | You (paste SHA-256) + publish | Yes — invite links break |
| H3 TURN | You (provider) or accept risk | No — quality only |
| H7 device tests | You (phone) | Yes — unverified release |
| Play Console forms | You | Yes |
