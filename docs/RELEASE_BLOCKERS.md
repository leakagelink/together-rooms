# SyncTogether — RELEASE BLOCKERS

**Audit date:** 2026-08-27 (UTC). Severity: **C** = critical (blocks submission), **H** = high (blocks production traffic), **M** = medium, **L** = low. No production code was changed while producing this list.

---

## CRITICAL — must be fixed before any Play submission

| # | Finding | Evidence | Impact | Fix |
|---|---|---|---|---|
| C1 | **Privacy policy contradicts the app.** `privacy.tsx` says no advertising SDK is integrated; the app ships Google Mobile Ads 24.4.0 with a live banner and interstitial. It also omits subscriptions, Advertising ID, FCM tokens, YouTube embeds, and retention periods. | `src/routes/privacy.tsx`; `rooms.index.tsx:121`; `variables.gradle` | Play rejection for Data Safety mismatch; GDPR/CCPA exposure | Rewrite the policy from `docs/DATA_SAFETY_DRAFT.md`; add Google Privacy Policy + YouTube ToS links |
| C2 | **Terms of Service are a placeholder** and do not cover paid subscriptions, auto-renewal, refunds, UGC licence, or acceptable use. | `src/routes/terms.tsx` | Play "Subscriptions" policy requires clear terms; rejection risk | Rewrite before submission |
| C3 | **Google Play Billing client is absent.** Premium is advertised in the UI but no purchase can be started on-device. | no `com.android.billingclient` in `android/app/build.gradle`; no billing Java/plugin | Users see a paid tier they cannot buy — Play "misleading claims"; whole billing server stack unused | Either integrate the billing client end-to-end, or hide all Premium purchase UI for v1 |
| C4 | **`assetlinks.json` not published** while the manifest declares `autoVerify="true"` App Links for `/invite/*` and `/auth/*`. | `AndroidManifest.xml`; no `.well-known/assetlinks.json` in the project | Deep-link verification fails; invite links open in the browser instead of the app | Publish `assetlinks.json` at the domain with the release signing SHA-256 |
| C5 | **Security test suite is not passing.** 11 suites fail with `AuthApiError: Request rate limit reached`; 194 tests skipped. | `bunx vitest run` | The RLS/RPC security guarantees claimed by earlier phases are currently **unverified** | Re-run against a project with raised auth rate limits, or pool/reuse test users; get a green run recorded before release |
| C6 | **Google Play service account not configured.** `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is missing, so purchase verification and RTDN processing fail closed. | `verification.server.ts` | No entitlement could ever be granted, even if C3 were fixed | Configure the secret and link the Play developer account |

## HIGH — fix before production traffic

| # | Finding | Evidence | Impact | Fix |
|---|---|---|---|---|
| H1 | **`anon` role holds `INSERT`/`UPDATE`/`DELETE` on 13 public tables** (incl. `profiles`, `push_tokens`, `rate_limits`). RLS currently blocks all of it, but defence-in-depth is broken: one permissive policy becomes an unauthenticated write. | live `information_schema.role_table_grants` probe | Privilege-escalation blast radius | `REVOKE INSERT, UPDATE, DELETE ON <tables> FROM anon;` in a new migration |
| H2 | **Dead voice/video call tables remain live.** `room_call_sessions` / `room_call_participants` still have `authenticated` write grants and remain in the `supabase_realtime` publication despite the feature being removed. | live DB probe | Unreachable-but-writable attack surface; realtime cost | Drop the tables (and their RPCs/types), or at minimum revoke grants and remove from the publication |
| H3 | **No TURN/ICE relay server.** Local-media P2P uses STUN only. | `useLocalMediaTransfer.ts` | Transfers silently fail behind symmetric NAT / carrier CGNAT — a large share of mobile users | Add a TURN server, or set explicit user-facing expectations and a fallback message |
| H4 | **UGC reporting gaps.** Reporting exists for messages, users, and rooms — but not for notes, tasks, resource links, queue items, playlists, or local-media sessions. | `report-dialog.tsx` call sites | Play UGC policy requires an in-app report path for all user content | Add report entry points to the five uncovered surfaces |
| H5 | **No repeat-offender enforcement or appeals flow.** | no strike/suspension logic in `moderation_actions` consumers | Play UGC policy expects escalation and an appeals route | Add strike accumulation + an appeal contact/route |
| H6 | **Pasted YouTube links bypass SafeSearch.** `safeSearch=strict` applies only to search results, not to IDs pasted directly. | `media-search.functions.ts:33-47` vs paste tab | Mature content reachable in a Teen-rated app | Fetch and check `contentDetails.contentRating` / `status` for pasted IDs before allowing playback |
| H7 | **Real-device flows never verified.** AdMob rendering + UMP form, notification tap routing, background local-media audio, fullscreen, App Links, and the release AAB build have not been run on hardware. | no device test evidence in repo | Unknown release-time failures | Execute `docs/PHASE14_2_RELEASE_GATE.md` on a physical device and record results |
| H8 | **No retention schedule.** Audit, moderation, and billing rows are retained indefinitely after account deletion, with no stated period. | `purge_user_data` | Data Safety and GDPR storage-limitation requirement | Define and publish retention periods; add a purge job |

## MEDIUM

| # | Finding | Evidence | Fix |
|---|---|---|---|
| M1 | 108 lint problems (98 errors, mostly `prettier/prettier`). | `eslint` run | `eslint --fix` |
| M2 | WebView shell loads a remote origin (`server.url`) rather than a bundled build — heightens Play "minimum functionality" scrutiny and breaks the app entirely if the origin is down. | `capacitor.config.ts` | Bundle the web build for release, keep remote loading for dev only |
| M3 | Rewarded and app-open ad configuration (including real unit IDs) ships but has no native controller or call site. | `placement-map.ts`, `admob-production.ts` | Remove the dead config and unit IDs |
| M4 | 17 unused `src/components/ui/*` scaffolds keep 9 npm dependencies alive (`date-fns`, `recharts`, `embla-carousel-react`, `cmdk`, `vaul`, `input-otp`, `react-day-picker`, `react-resizable-panels`, several Radix packages). | import scan | Delete the unused files, then `bun remove` the orphans |
| M5 | `LOVABLE_API_KEY` is configured but has no call site. | secret list vs `src/` scan | Remove the secret |
| M6 | `useAppLifecycle`'s `inCall` parameter is hard-coded `false` — leftover from the removed calling feature. | `src/hooks/useAppLifecycle.ts` | Delete the parameter |
| M7 | `premium-gate.tsx` is unimported dead code. | import scan | Delete or wire up |
| M8 | No crash-reporting backend is wired to `observability/monitor.ts`. | `monitor.ts` | Wire a provider before launch |
| M9 | No automated content classification (NSFW/profanity) on chat, notes, or resource links. | no classifier in repo | Consider a moderation classifier for scale |

## LOW

| # | Finding | Fix |
|---|---|---|
| L1 | Unused Android instrumentation scaffolds (`ExampleUnitTest.java`, `ExampleInstrumentedTest.java`). | delete |
| L2 | Chat has no reply/threading — UX gap, not a compliance issue. | backlog |
| L3 | No social login; email/password only. | backlog |
| L4 | Local-media transfers rely on WebRTC DTLS with no application-layer E2EE. | document the guarantee level |
| L5 | Capacity-limit UI does not clearly explain the free-vs-premium difference. | copy update |

---

## Counts

- **Critical: 6** · **High: 8** · **Medium: 9** · **Low: 5** — **28 findings total.**

## Verdict

**NO-GO for production submission.** All six critical items must be closed first; C1, C2, and C4 are cheap, and C3 can be closed either by integrating billing or by removing the Premium purchase surface for v1.

**CONDITIONAL GO for internal testing** once C1, C2, and C5 are addressed — internal testing does not require App Links verification or a live billing client.

---

## Phase 15 remediation status (free-only release)

| ID | Blocker | Status |
| --- | --- | --- |
| C1 | Privacy policy did not match app behaviour | **Resolved** — `/privacy` and `/terms` rewritten: free-only (no purchases), AdMob + UMP disclosed, local-media P2P handling, FCM tokens, children policy and a published contact address. |
| C3 | Missing Play Billing client | **Not applicable** — billing removed entirely. No billing code, products, entitlements or purchase surfaces ship. Play Console: declare "no in-app purchases". |
| C5 | Security suites failed under parallel execution | **Resolved** — `vitest.config.ts` runs test files sequentially, removing auth rate-limit contention. Full suite green. |
| — | Moderation recorded decisions without enforcing them | **Resolved** — the console now calls `moderation_enforce` / `moderation_reverse`; suspensions are enforced by a database trigger on every user-writable table, so suspended accounts cannot write through any path. |
| — | UGC reporting bypassed server checks | **Resolved** — all reports go through `report_content`; direct writes to `user_reports` are revoked. Reportable surfaces now include resources, notes, tasks, queue items, playlists and local-media sessions. |

Remaining owner actions are listed in `PLAY_CONSOLE_CONFIGURATION.md`.
