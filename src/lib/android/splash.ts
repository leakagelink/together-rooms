/**
 * Native splash control.
 *
 * The Android shell loads the live origin, so the WebView is blank for as long
 * as the first paint takes. The native splash therefore stays up
 * (`launchAutoHide: false`) and is dismissed by the web app once React has
 * mounted. On the web this is a no-op.
 */
let hidden = false;

interface SplashScreenPlugin {
  hide(options?: { fadeOutDuration?: number }): Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { SplashScreen?: SplashScreenPlugin };
}

export async function hideNativeSplash(): Promise<void> {
  if (hidden) return;
  hidden = true;
  if (typeof window === "undefined") return;
  const capacitor = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return;
  try {
    // Resolved from the native plugin registry rather than imported, so the
    // web bundle never needs the plugin package at build time.
    const splash = capacitor.Plugins?.SplashScreen;
    await splash?.hide({ fadeOutDuration: 250 });
  } catch {
    /* plugin unavailable — the native auto-hide fallback applies */
  }
}

