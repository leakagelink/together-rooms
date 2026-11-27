/**
 * Liquid Sync theme preference. Dark glass is the default identity; the light
 * glass theme applies only when the user explicitly chooses "light".
 * The saved settings row stays the source of truth; this local copy only lets
 * the choice apply on every screen from the first paint.
 */
export const THEME_STORAGE_KEY = "synctogether.theme.v1";

export type ThemePreference = "system" | "light" | "dark";

export function isLightTheme(preference: string | null | undefined): boolean {
  return preference === "light";
}

export function applyThemePreference(preference: string | null | undefined): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", !isLightTheme(preference));
  try {
    if (preference) window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the theme still applies for this session.
  }
}

export function readStoredTheme(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}
