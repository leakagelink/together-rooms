# Surf Mode — the in-app Research Browser

Research Room → **Surf** → in-app Research Browser → research without leaving the room.

Surf Mode is a *supporting capability* of the Study & Research Room. SyncTogether
is not, and is not presented as, a general-purpose web browser.

## Previous behaviour (removed)

| Layer | Old mechanism |
| --- | --- |
| `src/components/room/study-room.tsx` | Surf form called `openResource()` on native |
| `src/components/room/research-viewer.tsx` | "Open" called `openResource()` on native |
| `src/lib/in-app-browser.ts` → `openResource()` | `@capacitor/inappbrowser` → on any failure fell back to `@capacitor/browser` (**system browser**) → on web `window.open` |
| `src/components/room/embedded-browser.tsx` | web-only iframe surface (now deleted) |

In practice the native plugin path failed on device and every Surf action landed
in Chrome — the app was left behind. Both call sites no longer reference
`openResource` at all.

## New architecture

- `src/lib/research-surf.ts` — pure policy: scheme classification, URL
  redaction, share-candidate construction, session history stack, frame sandbox
  and permission-policy constants.
- `src/components/room/research-browser.tsx` — the Research Browser UI:
  address/search, back, forward, reload, close, loading state, blocked state,
  **Share with room**, **Discuss in room**.
- Mounted *inside* `StudyRoom`, only while Surf Mode is open (`url !== null`).
  The room component, its realtime subscriptions, presence and research state
  stay mounted behind the overlay; closing returns to the board unchanged.
  No route change, no room-ending logic, no interstitial.

## Android / WebView security boundary

Web content renders in a sandboxed cross-origin `<iframe>` inside the existing
hardened Capacitor WebView. No new WebView, no new JavaScript bridge.

- `sandbox="allow-scripts allow-forms allow-popups"` — deliberately **no**
  `allow-same-origin` (page JS cannot touch the app origin, `localStorage`, the
  Supabase session, room or invite tokens), **no** `allow-top-navigation`
  (a page cannot replace the room), **no** `allow-downloads`, **no**
  `allow-modals`.
- `allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; display-capture 'none'; midi 'none'"`.
- `referrerPolicy="no-referrer"`.
- No `postMessage` listener, no `contentWindow` access, no Capacitor plugin call
  from the browser component: web content has no path to any privileged native
  action.
- Cleartext stays disabled (`network_security_config.xml`), mixed content stays
  off (`allowMixedContent: false`), and top-level WebView navigation is still
  governed by `src/lib/android/navigation.ts`.

## URL / navigation policy

`classifyScheme()` is the single source of truth:

| Input | Decision |
| --- | --- |
| `https:` / `http:` without credentials | `in_app` — renders in the frame |
| `mailto:` / `tel:` / `sms:` | `external_confirm` — only on explicit user action |
| `intent:`, `market:`, `content:`, `file:`, `data:`, `javascript:`, custom schemes | `blocked` — never executed |
| credentials in the authority, malformed input | `blocked` |

Free text in the address bar becomes a DuckDuckGo search; a bare domain is
upgraded to `https://`.

## External fallback

The system browser is **never** opened automatically for a supported page. When
a site refuses embedding (`X-Frame-Options` / `frame-ancestors`, detected by the
load timeout) the user sees:

> This website can't be displayed inside SyncTogether.

with a single, user-initiated **Open in Browser** button.

## Privacy model

- Navigation history is **in-memory only**, scoped to the open Surf session, and
  dropped when the browser closes. Nothing is persisted locally or on the server.
- No URL, search term, cookie, header or token is logged, reported or sent to
  analytics. If a host ever needs to appear in diagnostics, only
  `redactBrowseUrl()` output (`scheme://host`) is permitted.
- Browsing is private by default: nothing is broadcast to the room.

## Research sharing model

Private browsing state ≠ shared research resource. A page becomes visible to
other members only through **Share with room**, which sends URL + domain +
optional user title through the existing server-authoritative
`addRoomResource` RPC (host-approval modes still apply). Page-supplied metadata,
page HTML and page contents are never read, stored or uploaded.

## Discussion, moderation, authorization

- **Discuss in room** closes the browser and focuses the existing room chat tab.
  No second chat system exists.
- Shared resources are ordinary room resources and inherit the existing
  `report_content` reporting and staff moderation flow.
- All room-scoped research state remains behind the existing membership RPCs,
  RLS and realtime authorization; a removed member loses research realtime access
  through the unchanged revocation path. The browser holds no channel and no
  Supabase client of its own.

## Ads

Surf Mode is a sensitive interactive flow. `research_surf` is registered in
`FORBIDDEN_AD_SURFACES`; no new banner placement and no new interstitial
transition were added, and the browser renders no ad component.

## Play policy audit

| Area | Verdict |
| --- | --- |
| WebView / website policy (supporting feature, not a browser product) | COMPLIANT BY IMPLEMENTATION |
| Device and Network Abuse (no bridge, no privileged exposure, no intent execution) | COMPLIANT BY IMPLEMENTATION |
| User Data (no history/URL collection, no analytics leakage) | COMPLIANT BY IMPLEMENTATION |
| UGC (shared resources reportable through existing moderation) | COMPLIANT BY IMPLEMENTATION |
| Data Safety declaration unchanged (no new collection) | OWNER REVIEW |
| Store listing accuracy — must not describe a browser | OWNER REVIEW |
| Permissions (none added) | COMPLIANT BY IMPLEMENTATION |
| Third-party content rendering on real devices, popup/download behaviour, blocked-site fallback | EXTERNAL TEST REQUIRED |
| Malicious redirect chains in the wild | POTENTIAL RISK — mitigated by sandbox + scheme policy |

## Tests

`scripts/security/research-surf.test.ts` covers SURF-T1 … SURF-T20.
