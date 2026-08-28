/**
 * SURF MODE — in-app Research Browser security, privacy and policy tests.
 *
 * SURF-T1 … SURF-T20. Behavioural rules that can be proven in pure code are
 * asserted directly; rules that live in the component contract are asserted
 * against the component source, so a regression that re-introduces an external
 * redirect, an ad placement or an origin-sharing sandbox fails the suite.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  RESEARCH_FRAME_ALLOW,
  RESEARCH_FRAME_SANDBOX,
  SURF_BLOCKED_MESSAGE,
  buildShareCandidate,
  canGoBack,
  canGoForward,
  canRenderInApp,
  classifyScheme,
  clearHistory,
  createHistory,
  currentUrl,
  goBack,
  goForward,
  pushHistory,
  redactBrowseUrl,
} from "@/lib/research-surf";
import {
  APPROVED_BANNER_PLACEMENTS,
  APPROVED_INTERSTITIAL_TRANSITIONS,
  isForbiddenAdSurface,
} from "@/lib/ads/placement-map";

const browserSource = readFileSync("src/components/room/research-browser.tsx", "utf8");
const studySource = readFileSync("src/components/room/study-room.tsx", "utf8");
const viewerSource = readFileSync("src/components/room/research-viewer.tsx", "utf8");
const roomSource = readFileSync("src/routes/_authenticated/rooms.$roomId.tsx", "utf8");

describe("SURF-T1: Surf Mode opens inside SyncTogether", () => {
  it("renders the in-app research browser rather than delegating to a platform browser", () => {
    expect(studySource).toContain("<ResearchBrowser");
    expect(browserSource).toContain("<iframe");
    expect(browserSource).toContain("fixed inset-0");
  });
});

describe("SURF-T2: supported https pages never auto-launch the external browser", () => {
  it("treats normal https pages as in-app renderable", () => {
    for (const url of [
      "https://en.wikipedia.org/wiki/Photosynthesis",
      "https://arxiv.org/abs/2301.00001",
      "https://duckduckgo.com/?q=cell+biology",
    ]) {
      expect(canRenderInApp(url)).toBe(true);
      expect(classifyScheme(url)).toBe("in_app");
    }
  });

  it("no surf entry point calls the native/system browser opener", () => {
    expect(studySource).not.toContain("openResource(");
    expect(viewerSource).not.toContain("openResource(");
    expect(browserSource).not.toContain("openResource(");
    expect(browserSource).not.toContain("@capacitor/browser");
  });
});

describe("SURF-T3: the external browser is only an explicit user fallback", () => {
  it("window.open lives solely in the user-invoked fallback handler", () => {
    const occurrences = browserSource.match(/window\.open\(/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(browserSource).toContain("const openExternally = () => {");
    expect(browserSource).toContain("Open in Browser");
  });

  it("refuses to hand a blocked scheme to the external browser", () => {
    expect(classifyScheme("intent://scan/#Intent;scheme=zxing;end")).toBe("blocked");
    expect(classifyScheme("market://details?id=com.x")).toBe("blocked");
    expect(classifyScheme("javascript:alert(1)")).toBe("blocked");
  });
});

describe("SURF-T4 / SURF-T18: room membership and realtime survive Surf Mode", () => {
  it("Surf Mode is an overlay inside the mounted Study Room, not a route change", () => {
    expect(browserSource).not.toContain("useNavigate");
    expect(browserSource).not.toContain("router.navigate");
    expect(studySource).toContain("setEmbedUrl(next)");
    // The room keeps every panel mounted, so realtime subscriptions persist.
    expect(roomSource).toContain("Every panel stays mounted");
  });
});

describe("SURF-T5 / SURF-T6: room research state stays server-authorized", () => {
  it("sharing goes through the server-authoritative resource RPC only", () => {
    expect(studySource).toContain("addResource({");
    expect(browserSource).not.toContain("supabase");
    expect(browserSource).not.toContain("from(");
  });

  it("the browser owns no realtime channel of its own", () => {
    expect(browserSource).not.toContain("channel(");
    expect(browserSource).not.toContain("useRoomStudy");
  });
});

describe("SURF-T7 / SURF-T20: URLs and search queries never reach logs or analytics", () => {
  it("redacts everything but scheme and host", () => {
    expect(redactBrowseUrl("https://mail.example.com/inbox?token=SECRET#x")).toBe(
      "https://mail.example.com",
    );
    expect(redactBrowseUrl("https://accounts.google.com/o/oauth2/auth?client_id=abc")).toBe(
      "https://accounts.google.com",
    );
    expect(redactBrowseUrl("https://duckduckgo.com/?q=private%20search")).toBe(
      "https://duckduckgo.com",
    );
    expect(redactBrowseUrl("javascript:alert(1)")).toBe("[redacted]");
  });

  it("the browser never logs or reports the browsed address", () => {
    expect(browserSource).not.toContain("console.log");
    expect(browserSource).not.toContain("trackEvent");
    expect(browserSource).not.toContain("analytics");
    expect(browserSource).not.toContain("captureError");
  });
});

describe("SURF-T8 / SURF-T9: page JavaScript is fully isolated", () => {
  it("the frame never shares the app origin and cannot navigate the shell", () => {
    expect(RESEARCH_FRAME_SANDBOX).toBe("allow-scripts allow-forms allow-popups");
    expect(RESEARCH_FRAME_SANDBOX).not.toContain("allow-same-origin");
    expect(RESEARCH_FRAME_SANDBOX).not.toContain("allow-top-navigation");
    expect(RESEARCH_FRAME_SANDBOX).not.toContain("allow-downloads");
  });

  it("denies camera, microphone, geolocation and payment to web content", () => {
    for (const feature of ["camera", "microphone", "geolocation", "payment", "display-capture"]) {
      expect(RESEARCH_FRAME_ALLOW).toContain(`${feature} 'none'`);
    }
  });

  it("exposes no message channel or bridge to the embedded page", () => {
    expect(browserSource).not.toContain("postMessage");
    expect(browserSource).not.toContain('addEventListener("message"');
    expect(browserSource).not.toContain("contentWindow");
    expect(browserSource).not.toContain("@capacitor/");
    expect(browserSource).not.toContain("Capacitor.");
    expect(browserSource).toContain('referrerPolicy="no-referrer"');
  });
});

describe("SURF-T10: unsafe and custom URL schemes are handled safely", () => {
  it("classifies every scheme family deterministically", () => {
    expect(classifyScheme("http://example.com")).toBe("in_app");
    expect(classifyScheme("https://example.com")).toBe("in_app");
    expect(classifyScheme("mailto:a@b.com")).toBe("external_confirm");
    expect(classifyScheme("tel:+911234")).toBe("external_confirm");
    expect(classifyScheme("file:///etc/passwd")).toBe("blocked");
    expect(classifyScheme("data:text/html,<script>")).toBe("blocked");
    expect(classifyScheme("content://media/1")).toBe("blocked");
    expect(classifyScheme("synctogether://room/1")).toBe("blocked");
    expect(classifyScheme("")).toBe("blocked");
    expect(classifyScheme("not a url")).toBe("blocked");
  });

  it("refuses credentials embedded in the authority", () => {
    expect(classifyScheme("https://user:pass@example.com")).toBe("blocked");
    expect(canRenderInApp("https://user:pass@example.com")).toBe(false);
  });

  it("only in_app URLs can ever be rendered", () => {
    expect(canRenderInApp("mailto:a@b.com")).toBe(false);
    expect(canRenderInApp("intent://x")).toBe(false);
  });
});

describe("SURF-T11 / SURF-T12: sharing is explicit, browsing is private", () => {
  it("builds a resource from the URL, domain and user title only", () => {
    const built = buildShareCandidate(
      "https://www.nature.com/articles/x?utm_source=z",
      " My note ",
    );
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.resource.url).toContain("nature.com/articles/x");
      expect(built.resource.title).toBe("My note");
      expect(built.resource.host).toBe("www.nature.com");
    }
  });

  it("falls back to the domain, never to page-supplied metadata", () => {
    const built = buildShareCandidate("https://www.nature.com/articles/x");
    expect(built.ok && built.resource.title).toBe("nature.com");
    expect(browserSource).not.toContain("document.title");
    expect(browserSource).not.toContain("innerHTML");
  });

  it("rejects unsafe or private-network share targets", () => {
    expect(buildShareCandidate("http://127.0.0.1/admin").ok).toBe(false);
    expect(buildShareCandidate("javascript:alert(1)").ok).toBe(false);
  });

  it("nothing is shared without the explicit share action", () => {
    expect(browserSource).toContain("Share with room");
    expect(browserSource).toContain("const share = async () => {");
    // Navigation alone performs no mutation.
    expect(browserSource).not.toContain("useEffect(() => {\n    void onShareWithRoom");
  });
});

describe("SURF-T13: research discussion reuses the existing room chat", () => {
  it("offers a focus action into the room chat instead of a second chat", () => {
    expect(browserSource).toContain("Discuss in room");
    expect(roomSource).toContain('onDiscussInRoom={() => setTab("chat")}');
    expect(browserSource).not.toContain("useRoomChat");
    expect(browserSource).not.toContain("sendRoomMessage");
  });
});

describe("SURF-T14 / SURF-T15: no ads anywhere in Surf Mode", () => {
  it("adds no new approved ad placement", () => {
    expect(APPROVED_BANNER_PLACEMENTS).not.toContain("research_surf" as never);
    expect(APPROVED_INTERSTITIAL_TRANSITIONS).not.toContain("research_surf" as never);
    expect(isForbiddenAdSurface("research_surf")).toBe(true);
    expect(isForbiddenAdSurface("study_room")).toBe(true);
  });

  it("the browser renders no ad component and requests no interstitial", () => {
    expect(browserSource).not.toContain("AdSlot");
    expect(browserSource).not.toContain("useAds");
    expect(browserSource).not.toContain("interstitial");
  });
});

describe("SURF-T16: back / forward / reload behave like a browser", () => {
  it("tracks a session-scoped history stack", () => {
    let history = createHistory("https://a.example/1");
    expect(canGoBack(history)).toBe(false);
    expect(canGoForward(history)).toBe(false);

    history = pushHistory(history, "https://a.example/2");
    history = pushHistory(history, "https://a.example/3");
    expect(currentUrl(history)).toBe("https://a.example/3");
    expect(canGoBack(history)).toBe(true);

    history = goBack(history);
    expect(currentUrl(history)).toBe("https://a.example/2");
    expect(canGoForward(history)).toBe(true);

    history = goForward(history);
    expect(currentUrl(history)).toBe("https://a.example/3");

    // A new navigation from the middle discards the forward entries.
    history = goBack(goBack(history));
    history = pushHistory(history, "https://b.example/new");
    expect(history.entries).toEqual(["https://a.example/1", "https://b.example/new"]);
    expect(canGoForward(history)).toBe(false);
  });

  it("exposes the controls in the browser chrome", () => {
    for (const label of ['aria-label="Back"', 'aria-label="Forward"', 'aria-label="Reload"']) {
      expect(browserSource).toContain(label);
    }
  });
});

describe("SURF-T17: closing Surf Mode returns to the Research Room", () => {
  it("close clears the session and unmounts the frame", () => {
    expect(browserSource).toContain('aria-label="Close research browser"');
    expect(browserSource).toContain("if (!url || !history) return null;");
    expect(studySource).toContain("onClose={() => setEmbedUrl(null)}");
    // History never outlives the session.
    expect(clearHistory()).toBeNull();
  });
});

describe("SURF-T19: honest fallback for pages that refuse embedding", () => {
  it("shows the required message with an explicit external action", () => {
    expect(SURF_BLOCKED_MESSAGE).toBe("This website can't be displayed inside SyncTogether.");
    expect(browserSource).toContain("SURF_BLOCKED_MESSAGE");
    expect(browserSource).toContain("setBlocked(true)");
  });
});
