/**
 * PHASE 10 — deep links and pending destinations.
 *
 * SECURITY MODEL
 * --------------
 * An Android App Link can be delivered by anything on the device, so the URL is
 * untrusted input. Two separate rules apply:
 *
 *   1. Only the app's own https origin may become an in-app destination. Any
 *      other origin, scheme, protocol-relative form or backslash trick is
 *      rejected outright — this is what makes an open redirect impossible.
 *   2. Only an allow-listed path shape may be *stored* as a pending destination
 *      while the user signs in. Invite redemption itself is untouched: the
 *      server still validates the token hash, expiry and one-shot consumption.
 *
 * Nothing here grants access. It only decides which in-app route we may send a
 * user to after authentication.
 */

import { isValidInviteToken } from "@/lib/room-rules";

export const APP_ORIGIN_HOSTS = ["together-rooms.lovable.app"] as const;

/** Paths that may be resumed after sign-in. Deliberately narrow. */
const RESUMABLE_PATH_PATTERNS: RegExp[] = [
  /^\/invite\/[a-f0-9]{48}$/,
  /^\/rooms$/,
  /^\/rooms\/[0-9a-fA-F-]{36}$/,
  /^\/playlists$/,
  /^\/settings(\/[a-z-]{1,32})?$/,
  /^\/profile$/,
];

export type DeepLinkRejection =
  | "malformed"
  | "foreign_origin"
  | "scheme_not_allowed"
  | "path_not_allowed"
  | "invalid_invite_token";

export interface DeepLinkAccepted {
  ok: true;
  /** Always a same-origin, path-only destination — never an absolute URL. */
  path: string;
  kind: "invite" | "app";
  inviteToken?: string;
}

export interface DeepLinkRejected {
  ok: false;
  reason: DeepLinkRejection;
}

export type DeepLinkResult = DeepLinkAccepted | DeepLinkRejected;

function isAppHost(host: string): boolean {
  return (APP_ORIGIN_HOSTS as readonly string[]).includes(host.toLowerCase());
}

/**
 * Resolves an incoming deep link (absolute URL, or an in-app path) to a safe
 * internal destination.
 */
export function resolveDeepLink(
  raw: string,
  allowedHosts: readonly string[] = APP_ORIGIN_HOSTS,
): DeepLinkResult {
  const value = (raw ?? "").trim();
  if (!value || value.length > 2048) return { ok: false, reason: "malformed" };

  // "//evil.com", "/\evil.com" and "\\evil.com" are browser-resolvable as an
  // absolute foreign origin; refuse them before any parsing.
  if (/^[\\/]{2}/.test(value) || value.includes("\\")) {
    return { ok: false, reason: "foreign_origin" };
  }

  let url: URL;
  if (value.startsWith("/")) {
    try {
      url = new URL(value, `https://${allowedHosts[0]}`);
    } catch {
      return { ok: false, reason: "malformed" };
    }
  } else {
    try {
      url = new URL(value);
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (url.protocol !== "https:") return { ok: false, reason: "scheme_not_allowed" };
    if (!allowedHosts.map((h) => h.toLowerCase()).includes(url.hostname.toLowerCase())) {
      return { ok: false, reason: "foreign_origin" };
    }
    if (url.username || url.password) return { ok: false, reason: "foreign_origin" };
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/invite/")) {
    const token = path.slice("/invite/".length);
    if (!isValidInviteToken(token)) return { ok: false, reason: "invalid_invite_token" };
    return { ok: true, path: `/invite/${token}`, kind: "invite", inviteToken: token };
  }

  if (!RESUMABLE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return { ok: false, reason: "path_not_allowed" };
  }
  return { ok: true, path, kind: "app" };
}

export const PENDING_DESTINATION_KEY = "synctogether.pending_destination.v1";
/** A pending destination is a UX convenience, not a credential: it expires fast. */
export const PENDING_DESTINATION_TTL_MS = 10 * 60 * 1000;

interface StoredDestination {
  path: string;
  at: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Stores where to continue after sign-in. Rejected links are never stored. */
export function rememberPendingDestination(raw: string): DeepLinkResult {
  const result = resolveDeepLink(raw);
  if (!result.ok) return result;
  const store = storage();
  if (store) {
    const payload: StoredDestination = { path: result.path, at: Date.now() };
    try {
      store.setItem(PENDING_DESTINATION_KEY, JSON.stringify(payload));
    } catch {
      // Storage unavailable (private mode): the user simply lands on /rooms.
    }
  }
  return result;
}

/**
 * Consumes the pending destination. Re-validated on read, because anything on
 * the device could have written to session storage in the meantime.
 */
export function takePendingDestination(now: number = Date.now()): string | null {
  const store = storage();
  if (!store) return null;
  let rawValue: string | null = null;
  try {
    rawValue = store.getItem(PENDING_DESTINATION_KEY);
    store.removeItem(PENDING_DESTINATION_KEY);
  } catch {
    return null;
  }
  if (!rawValue) return null;
  let parsed: StoredDestination;
  try {
    parsed = JSON.parse(rawValue) as StoredDestination;
  } catch {
    return null;
  }
  if (typeof parsed?.path !== "string" || typeof parsed?.at !== "number") return null;
  if (now - parsed.at > PENDING_DESTINATION_TTL_MS) return null;
  const revalidated = resolveDeepLink(parsed.path);
  return revalidated.ok ? revalidated.path : null;
}

export function clearPendingDestination(): void {
  try {
    storage()?.removeItem(PENDING_DESTINATION_KEY);
  } catch {
    // nothing to do
  }
}
