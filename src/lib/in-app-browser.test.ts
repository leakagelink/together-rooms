import { describe, expect, it } from "vitest";

import { isBrowsableUrl, toBrowseUrl } from "./in-app-browser";

describe("isBrowsableUrl", () => {
  it("accepts http and https only", () => {
    expect(isBrowsableUrl("https://example.com")).toBe(true);
    expect(isBrowsableUrl("http://example.com")).toBe(true);
    expect(isBrowsableUrl("javascript:alert(1)")).toBe(false);
    expect(isBrowsableUrl("file:///etc/passwd")).toBe(false);
    expect(isBrowsableUrl("not a url")).toBe(false);
  });
});

describe("toBrowseUrl", () => {
  it("keeps absolute http(s) urls", () => {
    expect(toBrowseUrl(" https://arxiv.org/abs/123 ")).toBe("https://arxiv.org/abs/123");
  });

  it("upgrades a bare domain", () => {
    expect(toBrowseUrl("wikipedia.org/wiki/Physics")).toBe("https://wikipedia.org/wiki/Physics");
  });

  it("searches for free text", () => {
    expect(toBrowseUrl("quantum entanglement")).toBe(
      "https://duckduckgo.com/?q=quantum%20entanglement",
    );
  });

  it("rejects empty input and unsafe schemes", () => {
    expect(toBrowseUrl("   ")).toBeNull();
    expect(toBrowseUrl("javascript:alert(1)")).toBe(
      "https://duckduckgo.com/?q=javascript%3Aalert(1)",
    );
  });
});
