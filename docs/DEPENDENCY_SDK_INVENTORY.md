# SyncTogether — DEPENDENCY & SDK INVENTORY

**Audit date:** 2026-08-27 (UTC). Versions as declared in `package.json`, `android/variables.gradle`, `android/app/build.gradle`.

---

## 1. Native Android SDKs (highest policy impact)

| Name | Version | Purpose | Production reachable | Collects/transmits data | Data Safety impact | Play policy impact | Still needed |
|---|---|---|---|---|---|---|---|
| **Google Mobile Ads (`com.google.android.gms:play-services-ads`)** | 24.4.0 (`variables.gradle`) | Banner + interstitial ads | **YES** — `rooms.index.tsx:121`, `rooms.$roomId.tsx:195` | **YES** — Advertising ID (AAID), device & network info, IP-derived approximate location, ad interactions | **HIGH.** Forces "Device or other IDs → collected + shared → Advertising/marketing"; injects `com.google.android.gms.permission.AD_ID` into the merged manifest | Ads policy, families policy exclusion, Advertising-ID declaration | YES |
| **User Messaging Platform (`com.google.android.ump:user-messaging-platform`)** | 3.2.0 | GDPR/consent (TCF) form | **YES** — `ConsentController.java` | Consent state stored on-device; talks to Google | MEDIUM — consent handling must be disclosed | Required for EEA/UK ad serving | YES |
| **Capacitor Android runtime (`capacitor-android`)** | 8.5.x | WebView shell | YES | No, itself | None | Minimum-functionality scrutiny (WebView shell) | YES |
| **AndroidX AppCompat / Core / CoordinatorLayout / core-splashscreen** | 1.7.1 / 1.17.0 / 1.3.0 / 1.2.0 | UI + splash | YES | No | None | None | YES |
| **Google Services Gradle plugin + `google-services.json`** | project `sync-b99e0` | FCM wiring | YES | Firebase installation ID | MEDIUM | None | YES |
| **JUnit / Espresso / androidx.test** | 4.13.2 / 3.7.0 / 1.3.0 | Instrumentation scaffolding | **NO** (test-only, and never run) | No | None | None | Optional — scaffold `ExampleUnitTest.java` / `ExampleInstrumentedTest.java` are unused |
| **Google Play Billing (`com.android.billingclient`)** | **ABSENT** | — | — | — | — | **Premium cannot be purchased** | **MISSING — required if Premium ships** |

## 2. Capacitor plugins

| Name | Version | Purpose | Reachable | Data | Impact | Still needed |
|---|---|---|---|---|---|---|
| `@capacitor/core` | ^8.5.0 | bridge | YES | No | None | YES |
| `@capacitor/android` | ^8.5.0 | Android platform | YES | No | None | YES |
| `@capacitor/app` | ^8.1.1 | lifecycle, deep links, back button | YES (`useAppLifecycle.ts`, `android/deep-link.ts`, `navigation.ts`) | No | None | YES |
| `@capacitor/network` | ^8.0.1 | connectivity | YES (`useOnlineStatus.ts`) | Network state | Low | YES |
| `@capacitor/push-notifications` | ^8.1.2 | FCM | YES (`android/push.ts`, `push-registrar.tsx`) | **FCM token, device ID** | MEDIUM — declare Device IDs | YES |
| `@capacitor/splash-screen` | ^8.0.2 | splash | YES (`android/splash.ts`) | No | None | YES |
| `@capacitor/cli` | ^8.5.0 (dev) | tooling | No | No | None | YES |
| **Local `AdsPlugin`** | in-repo | native ad bridge | YES | via ads SDK | see ads SDK | YES |

## 3. Backend / data

| Name | Version | Purpose | Reachable | Data | Impact | Still needed |
|---|---|---|---|---|---|---|
| `@supabase/supabase-js` | ^2.112.3 | Auth, Postgres, Realtime, RPC | YES — everywhere | **All first-party user data** | HIGH — Supabase is a **processor**, not third-party sharing; must be named in the privacy policy | YES |
| Supabase Auth (service) | managed | accounts, sessions, password reset | YES | Email, password hash, IP, user agent | HIGH | YES |
| Supabase Realtime | managed | `postgres_changes` on 17 tables | YES | room/chat/playback state | MEDIUM | YES |
| Supabase Storage | **NOT USED** | — | — | — | — | no bucket exists — confirms no server-side media hosting |

## 4. Third-party HTTP services (no SDK, server-side fetch only)

| Service | Auth | Where | Data sent | Impact | Still needed |
|---|---|---|---|---|---|
| **YouTube Data API v3** | `YOUTUBE_DATA_API_KEY` (server secret, configured) | `media-search.functions.ts`, `media-metadata.functions.ts` | Search query, video IDs. **No user identifiers sent** | MEDIUM — YouTube API Services ToS requires linking Google's Privacy Policy and YouTube ToS in-app (**currently missing**) | YES |
| **YouTube IFrame Player** | none | `watch-together.tsx` | Client-side; YouTube sets its own cookies/identifiers in the embed | MEDIUM — must be disclosed | YES |
| **Google Play Developer API** | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (**NOT configured**) | `verification.server.ts` | Purchase token, package, product | HIGH | YES, if Premium ships |
| **Google Pub/Sub (RTDN)** | Google-signed OIDC | `api.public.billing.rtdn.ts` | Inbound only | MEDIUM | YES, if Premium ships |
| **Firebase Cloud Messaging** | `FIREBASE_SERVICE_ACCOUNT` (configured) | `push-send.server.ts` | FCM token, notification title/body/data | **HIGH — data shared with Google** | YES |
| **Google Identity JWKS** | public | `google-oidc.server.ts` | none | None | YES |
| Lovable AI Gateway | `LOVABLE_API_KEY` present as a platform secret | **NO CALL SITE EXISTS in `src/`** | — | None today | **NO — unused** |

## 5. Web framework & runtime

| Name | Version | Purpose | Reachable | Data | Impact | Still needed |
|---|---|---|---|---|---|---|
| `react` / `react-dom` | ^19.2.0 | UI | YES | No | None | YES |
| `@tanstack/react-router` | 1.170.18 | routing | YES | No | None | YES |
| `@tanstack/react-start` | 1.168.32 | SSR + server functions | YES | request data | None | YES |
| `@tanstack/router-plugin` | 1.168.23 | route generation | build | — | None | YES |
| `@tanstack/react-query` | ^5.102.3 | data layer | YES | cached user data | Low | YES |
| `@tanstack/react-query-persist-client` + `query-sync-storage-persister` | ^5.102.3 | cache persistence to storage | YES | **caches user data in browser storage** | Low — note in policy | YES |
| `vite` | ^8.2.0 | build | build | — | None | YES |
| `nitro` | 3.0.260603-beta | server runtime | YES | — | None | YES (transitively required) |
| `vite-tsconfig-paths` | ^6.0.2 | build | build | — | None | YES |
| `zod` | ^3.24.2 | input validation on every server fn | YES | — | Positive (security) | YES |
| `react-hook-form` + `@hookform/resolvers` | ^7.71.2 / ^5.2.2 | forms | YES | — | None | YES |
| `sonner` | ^2.0.7 | toasts | YES | — | None | YES |
| `lucide-react` | ^0.575.0 | icons | YES | — | None | YES |
| `tailwindcss` + `@tailwindcss/vite` + `tw-animate-css` | ^4.2.1 / ^4.2.1 / ^1.3.4 | styling | YES | — | None | YES |
| `clsx`, `tailwind-merge`, `class-variance-authority` | ^2.1.1 / ^3.5.0 / ^0.7.1 | styling utils | YES | — | None | YES |

## 6. UI component libraries

| Name | Version | Used by app code | Verdict |
|---|---|---|---|
| `@radix-ui/react-{dialog, dropdown-menu, tabs, select, popover, tooltip, switch, checkbox, label, separator, avatar, progress, scroll-area, collapsible, alert-dialog, toggle, slot}` | 1.x–2.x | YES | KEEP |
| `@radix-ui/react-{accordion, aspect-ratio, context-menu, hover-card, menubar, navigation-menu, radio-group, slider, toggle-group}` | 1.x–2.x | **NO** — only by unused `src/components/ui/*` scaffolds | CODE REMOVAL RECOMMENDED |
| `embla-carousel-react` | ^8.6.0 | **NO** (only `ui/carousel.tsx`, unimported) | REMOVE |
| `recharts` | ^2.15.4 | **NO** (only `ui/chart.tsx`, unimported) | REMOVE |
| `cmdk` | ^1.1.1 | **NO** (only `ui/command.tsx`) | REMOVE |
| `vaul` | ^1.1.2 | **NO** (only `ui/drawer.tsx`) | REMOVE |
| `input-otp` | ^1.4.2 | **NO** (only `ui/input-otp.tsx`) | REMOVE |
| `react-day-picker` | ^9.14.0 | **NO** (only `ui/calendar.tsx`) | REMOVE |
| `react-resizable-panels` | ^4.6.5 | **NO** (only `ui/resizable.tsx`) | REMOVE |
| **`date-fns`** | ^4.1.0 | **NO — zero references anywhere in `src/`** | **REMOVE** |

## 7. Dev tooling (never shipped)

`@lovable.dev/vite-tanstack-config` ^2.15.0 · `typescript` ^5.8.3 · `typescript-eslint` ^8.56.1 · `eslint` ^9.32.0 + `@eslint/js` + `eslint-config-prettier` + `eslint-plugin-prettier` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` · `prettier` ^3.7.3 · `vitest` ^4.1.11 · `@vitejs/plugin-react` ^5.2.0 · `globals` ^15.15.0 · `@types/{node,react,react-dom}`.
No data impact. All still needed.

---

## Summary

- **Total npm dependencies:** 62 runtime + 21 dev.
- **Runtime dependencies with a Data Safety impact: 5** — `@supabase/supabase-js`, `@capacitor/push-notifications`, `@capacitor/network`, `@tanstack/react-query-persist-client`, plus the native ads/UMP SDKs (not npm).
- **Native SDKs with a Play policy impact: 3** — Google Mobile Ads, UMP, Firebase/FCM.
- **Missing SDK required by an advertised feature: 1** — Google Play Billing client.
- **Unused dependencies safe to remove: 9** — `date-fns` plus the 8 libraries reachable only through unimported shadcn scaffolds (removing the 17 unused `src/components/ui/*` files makes them all orphaned).
- **Unused platform secret: 1** — `LOVABLE_API_KEY` (no AI call site exists).
- **No analytics SDK, no crash-reporting SDK, no attribution SDK, no AI SDK, no browser library, no native file/media library** is present.
