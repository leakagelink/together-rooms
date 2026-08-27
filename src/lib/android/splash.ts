/**
 * Native splash control.
 *
 * The Android shell loads the live origin, so the WebView is blank for as long
 * as the first paint takes. The native splash therefore stays up
 * (`launchAutoHide: false`) and is dismissed by the web app once React has
 * mounted. On the web this is a no-op.
 */
let hidden = false;

export async function hideNativeSplash(): Promise<void> {
  if (hidden) return;
  hidden = true;
  if (typeof window === "undefined") return;
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    /* plugin unavailable — the native auto-hide fallback applies */
  }
}
