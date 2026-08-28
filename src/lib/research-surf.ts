/**
 * SURF MODE — in-app Research Browser policy.
 *
 * SyncTogether is not a browser. Surf Mode is a *supporting capability* of the
 * Study & Research Room: it lets a member look something up without leaving the
 * room (presence, realtime and research state all stay mounted behind it).
 *
 * SECURITY MODEL
 * --------------
 *  - Web content renders in a sandboxed cross-origin frame. The frame gets no
 *    `allow-same-origin`, no `allow-top-navigation`, and no messaging channel,
 *    so page JavaScript cannot read the app origin, cannot reach the Capacitor
 *    bridge, cannot see Supabase credentials / auth tokens / room or invite
 *    tokens, and cannot navigate the shell away from the room.
 *  - Only http(s) may render. intent:, market:, tel:, mailto: and every other
 *    scheme are never auto-executed; at most they are offered to the user as an
 *    explicit "Open in Browser" action, and unsafe schemes are refused outright.
 *  - The external browser is never opened automatically for a supported page.
 *    It is only reachable through a user-initiated fallback.
 *
 * PRIVACY MODEL
 * -------------
 *  - Navigation history is in-memory only, scoped to the open Surf session, and
 *    discarded when Surf Mode closes. Nothing is written to the server.
 *  - Nothing is broadcast to the room. A resource becomes visible to other
 *    members only through the explicit "Share with room" action.
 *  - Only `redactBrowseUrl()` output (scheme + host) may ever reach logs or
 *    analytics; full URLs, query strings and search terms never leave the device.
 */

import { checkResourceUrl, displayHost, urlRejectionMessage } from "@/lib/url-safety";

/**
 * Sandbox for the research frame. Deliberately excludes:
 *   allow-same-origin      — page JS must never share the app origin
 *   allow-top-navigation*  — a page must never be able to replace the room
 *   allow-modals/pointer-lock/presentation/downloads
 */
export const RESEARCH_FRAME_SANDBOX = "allow-scripts allow-forms allow-popups";

/** Feature policy: no camera, mic, geolocation, payment or USB inside research. */
export const RESEARCH_FRAME_ALLOW = [
  "camera 'none'",
  "microphone 'none'",
  "geolocation 'none'",
  "payment 'none'",
  "usb 'none'",
  "display-capture 'none'",
  "midi 'none'",
].join("; ");

export const SURF_BLOCKED_MESSAGE = "This website can't be displayed inside SyncTogether.";

export type SchemeDecision =
  /** http(s): renders inside the in-app research frame. */
  | "in_app"
  /** Known, non-executable handoff (tel:, mailto:) — only on explicit user action. */
  | "external_confirm"
  /** Never handled: app intents, custom schemes, script/data/file URLs. */
  | "blocked";

const EXTERNAL_CONFIRM_SCHEMES = new Set(["mailto:", "tel:", "sms:"]);

/**
 * Decides what may happen with a URL a page or a user produced. Anything that
 * could launch a native intent or execute script is blocked, never "handled".
 */
export function classifyScheme(raw: string): SchemeDecision {
  const value = (raw ?? "").trim();
  if (!value) return "blocked";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "blocked";
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme === "http:" || scheme === "https:") {
    if (parsed.username || parsed.password) return "blocked";
    return "in_app";
  }
  if (EXTERNAL_CONFIRM_SCHEMES.has(scheme)) return "external_confirm";
  return "blocked";
}

/** True only for URLs that may be loaded into the research frame. */
export function canRenderInApp(raw: string): boolean {
  return classifyScheme(raw) === "in_app";
}

/**
 * The only representation of a browsed URL that may reach a log line, a crash
 * report or analytics: scheme + host, with every path, query and fragment
 * removed. Auth hosts still produce only a host, never a token-bearing URL.
 */
export function redactBrowseUrl(raw: string): string {
  try {
    const parsed = new URL((raw ?? "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "[redacted]";
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
  } catch {
    return "[redacted]";
  }
}

export interface ShareableResource {
  url: string;
  title: string;
  host: string;
}

export type ShareCandidate =
  { ok: true; resource: ShareableResource } | { ok: false; error: string };

/**
 * Builds the payload for "Share with room". Only the URL, the domain and a
 * user-entered title are ever shared — page-provided metadata and page contents
 * are never trusted or transmitted. The server-authoritative resource RPC
 * re-validates the URL; this is UX-level feedback.
 */
export function buildShareCandidate(rawUrl: string, userTitle?: string): ShareCandidate {
  const check = checkResourceUrl(rawUrl);
  if (!check.ok) return { ok: false, error: urlRejectionMessage(check.reason) };
  const title = (userTitle ?? "").trim().slice(0, 200) || displayHost(check.host);
  return { ok: true, resource: { url: check.url, title, host: check.host } };
}

/* ------------------------------------------------------------------ */
/* In-memory, session-scoped navigation history                        */
/* ------------------------------------------------------------------ */

export interface SurfHistory {
  entries: string[];
  index: number;
}

export function createHistory(url: string): SurfHistory {
  return { entries: [url], index: 0 };
}

/** Pushes a new entry, discarding any forward entries (browser semantics). */
export function pushHistory(history: SurfHistory, url: string): SurfHistory {
  const entries = [...history.entries.slice(0, history.index + 1), url];
  return { entries, index: entries.length - 1 };
}

export function goBack(history: SurfHistory): SurfHistory {
  return history.index > 0 ? { ...history, index: history.index - 1 } : history;
}

export function goForward(history: SurfHistory): SurfHistory {
  return history.index < history.entries.length - 1
    ? { ...history, index: history.index + 1 }
    : history;
}

export function canGoBack(history: SurfHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: SurfHistory): boolean {
  return history.index < history.entries.length - 1;
}

export function currentUrl(history: SurfHistory): string {
  return history.entries[history.index] ?? "";
}

/** Surf history never survives the session: closing the browser drops it. */
export function clearHistory(): SurfHistory | null {
  return null;
}

/* ------------------------------------------------------------------ */
/* Embedding policy                                                    */
/* ------------------------------------------------------------------ */

/**
 * Hosts known to refuse framing (X-Frame-Options / frame-ancestors). Loading
 * them into the research frame produces the platform's raw
 * `ERR_BLOCKED_BY_RESPONSE` page, so we detect them up front and show the
 * app's own fallback with an explicit "Open in Browser" action instead.
 */
const EMBED_BLOCKED_HOSTS = [
  "google.com",
  "google.co.in",
  "duckduckgo.com",
  "bing.com",
  "search.yahoo.com",
  "yahoo.com",
  "ecosia.org",
  "startpage.com",
  "search.brave.com",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "reddit.com",
  "quora.com",
  "medium.com",
  "pinterest.com",
  "amazon.com",
  "amazon.in",
  "github.com",
  "stackoverflow.com",
  "wikipedia.org",
];

/** True when the host is known to reject embedding in any app frame. */
export function isEmbedBlocked(raw: string): boolean {
  try {
    const host = new URL((raw ?? "").trim()).hostname.toLowerCase().replace(/^www\./, "");
    return EMBED_BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

/** True when the typed input is a search phrase rather than a URL/domain. */
export function isSearchQuery(input: string): boolean {
  const raw = (input ?? "").trim();
  if (!raw) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  return !(/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) && !raw.includes(" "));
}
