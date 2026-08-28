/**
 * In-app browsing for research resources.
 *
 * Play policy note: we never wrap third-party sites in a headless webview we
 * control, never strip their chrome, and never inject scripts. On Android we
 * hand the URL to a Custom Tab (Capacitor Browser) so the user stays inside
 * SyncTogether visually while the system browser engine — with its own address
 * bar, TLS indicator and cookie jar — renders the page. On the web we open a
 * normal noopener tab, which is the only compliant option there.
 */
import { Capacitor } from "@capacitor/core";

export type OpenMode = "in_app" | "new_tab";

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

export async function openResource(url: string): Promise<OpenMode | null> {
  if (!isBrowsableUrl(url)) return null;

  if (isNativeRuntime()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return "in_app";
    } catch {
      // fall through to the web behaviour
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return "new_tab";
}
