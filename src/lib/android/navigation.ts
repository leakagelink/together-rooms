/**
 * PHASE 10 — external navigation policy and Android back behaviour.
 *
 * The WebView may only ever navigate within the app's own origin. Everything
 * else is either opened in the system browser (a small, documented allow list
 * of destinations the product genuinely links to) or blocked. This is the
 * single source of truth mirrored by capacitor.config.ts `allowNavigation`.
 */

import { APP_ORIGIN_HOSTS } from "./deep-link";

/** Hosts we are willing to hand to the *system browser* (never the WebView). */
export const EXTERNAL_BROWSER_HOSTS = [
  "play.google.com",
  "policies.google.com",
  "www.youtube.com",
  "youtube.com",
  "support.google.com",
] as const;

export type NavigationDecision = "in_app" | "system_browser" | "blocked";

/**
 * Embedded playback is a separate surface: the YouTube IFrame player runs
 * inside the page, and this policy governs *top-level* navigation only.
 */
export function classifyNavigation(
  raw: string,
  appHosts: readonly string[] = APP_ORIGIN_HOSTS,
): NavigationDecision {
  const value = (raw ?? "").trim();
  if (!value) return "blocked";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // A relative path can only ever resolve against our own origin.
    return value.startsWith("/") && !value.startsWith("//") ? "in_app" : "blocked";
  }
  if (url.protocol !== "https:") return "blocked";
  if (url.username || url.password) return "blocked";
  const host = url.hostname.toLowerCase();
  if (appHosts.map((h) => h.toLowerCase()).includes(host)) return "in_app";
  if ((EXTERNAL_BROWSER_HOSTS as readonly string[]).includes(host)) return "system_browser";
  return "blocked";
}

/* ------------------------------------------------------------------ */
/* Android hardware back button                                        */
/* ------------------------------------------------------------------ */

export interface BackContext {
  /** A modal, sheet or dialog is open. */
  modalOpen: boolean;
  /** The member is currently joined to a live voice/video call. */
  inActiveCall: boolean;
  /** The router can pop a previous in-app entry. */
  canGoBack: boolean;
  /** A confirmation for leaving the call was already shown and accepted. */
  confirmedLeave: boolean;
}

export type BackAction =
  | "close_modal"
  | "confirm_leave_call"
  | "navigate_back"
  | "exit_app";

/**
 * Back never destroys a room and never mutates another member's state: at most
 * it leaves the local call after an explicit confirmation, and otherwise it
 * only pops navigation. When there is nothing left to pop the app exits — the
 * user is never trapped.
 */
export function resolveBackAction(context: BackContext): BackAction {
  if (context.modalOpen) return "close_modal";
  if (context.inActiveCall && !context.confirmedLeave) return "confirm_leave_call";
  if (context.canGoBack) return "navigate_back";
  return "exit_app";
}
