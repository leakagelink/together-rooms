/**
 * Session resume support.
 *
 * The Android shell is killed aggressively by the OS, so a returning signed-in
 * user would otherwise always land back on the public landing page. We remember
 * the last *authenticated* in-app path (never auth screens, never the public
 * landing page) so the app can resume where the user left off.
 *
 * Only a path is stored — no ids, tokens or user data beyond the URL itself —
 * and it is cleared on sign-out along with the rest of the local caches.
 */
const KEY = "st.last-route";
const MAX_LENGTH = 512;

/** Paths that must never be resumed into. */
function isResumable(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false; // protocol-relative escape
  if (path === "/") return false;
  if (path.startsWith("/auth")) return false;
  if (path.startsWith("/delete-account")) return false;
  return path.length <= MAX_LENGTH;
}

export function rememberLastRoute(path: string): void {
  if (typeof window === "undefined") return;
  if (!isResumable(path)) return;
  try {
    window.localStorage.setItem(KEY, path);
  } catch {
    /* storage unavailable — resume is best effort */
  }
}

export function readLastRoute(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(KEY);
    return value && isResumable(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearLastRoute(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
