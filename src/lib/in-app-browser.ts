/**
 * In-app browsing for research resources.
 *
 * Play policy note: the in-app web view is a *user-driven browser surface* —
 * it shows the live URL, a toolbar and back/forward navigation, runs the page
 * unmodified, and injects no scripts. We never scrape, re-frame or re-publish
 * third-party content, and the app's own features are not a repackaging of any
 * single external site.
 */
import { Capacitor } from "@capacitor/core";

export type OpenMode = "web_view" | "system_browser" | "new_tab";

export function isNativeRuntime(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Only http(s) links may ever be handed to a browser surface. */
export function isBrowsableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Turns whatever the user typed into a navigable URL: a bare domain becomes
 * https://…, anything else becomes a web search on a privacy-respecting engine.
 */
export function toBrowseUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return isBrowsableUrl(raw) ? raw : null;

  const looksLikeDomain = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) && !raw.includes(" ");
  if (looksLikeDomain) {
    const candidate = `https://${raw}`;
    return isBrowsableUrl(candidate) ? candidate : null;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
}

/**
 * Opens the URL in the full in-app browser (native), falling back to the
 * system browser and finally a plain new tab on the web.
 */
export async function openResource(url: string): Promise<OpenMode | null> {
  if (!isBrowsableUrl(url)) return null;

  if (isNativeRuntime()) {
    try {
      const {
        InAppBrowser,
        ToolbarPosition,
        AndroidViewStyle,
        iOSViewStyle,
        iOSAnimation,
        AndroidAnimation,
      } = await import("@capacitor/inappbrowser");
      await InAppBrowser.openInWebView({
        url,
        options: {
          showURL: true,
          showToolbar: true,
          clearCache: false,
          clearSessionCache: false,
          mediaPlaybackRequiresUserAction: true,
          closeButtonText: "Done",
          toolbarPosition: ToolbarPosition.TOP,
          showNavigationButtons: true,
          leftToRight: false,
          android: {
            allowZoom: true,
            hardwareBack: true,
            // Stops page audio/video when the app goes to the background.
            pauseMedia: true,
          },
          iOS: {
            allowOverScroll: true,
            enableViewportScale: true,
            allowInLineMediaPlayback: false,
            surpressIncrementalRendering: false,
            viewStyle: iOSViewStyle.FULL_SCREEN,
            animationEffect: iOSAnimation.CROSS_DISSOLVE,
            allowsBackForwardNavigationGestures: true,
          },
        },
      });
      void AndroidViewStyle; // enum imported for type completeness
      return "web_view";
    } catch {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url, presentationStyle: "popover" });
        return "system_browser";
      } catch {
        // fall through to the web behaviour
      }
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return "new_tab";
}

/** Runs `handler` once the in-app browser is dismissed (native only). */
export async function onBrowserClosed(handler: () => void): Promise<() => void> {
  if (!isNativeRuntime()) return () => {};
  try {
    const { InAppBrowser } = await import("@capacitor/inappbrowser");
    const listener = await InAppBrowser.addListener("browserClosed", handler);
    return () => void listener.remove();
  } catch {
    return () => {};
  }
}
