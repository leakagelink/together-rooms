import type { CapacitorConfig } from "@capacitor/cli";

/**
 * PHASE 10 — Android packaging configuration.
 *
 * SyncTogether is a server-rendered TanStack Start application: server
 * functions are the security boundary for every authoritative mutation, so the
 * Android build is a hardened WebView shell that loads the deployed origin
 * rather than a static export of the client bundle. Nothing security relevant
 * moves into the shell.
 *
 * The remote origin is https-only; cleartext traffic stays disabled in both the
 * Capacitor config and the Android network security configuration.
 */
const APP_ORIGIN = process.env["CAPACITOR_APP_ORIGIN"] ?? "https://together-rooms.lovable.app";

const config: CapacitorConfig = {
  appId: "app.lovable.synctogether",
  appName: "SyncTogether",
  // Only used as an offline fallback shell; the live app is served from the origin.
  webDir: "android-shell",
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
    url: APP_ORIGIN,
    cleartext: false,
    // Only the app's own origin may be loaded inside the WebView. Everything
    // else (YouTube help pages, Play subscription management, legal links) is
    // handed to the system browser by the external navigation policy.
    allowNavigation: ["together-rooms.lovable.app"],
  },
};

export default config;
