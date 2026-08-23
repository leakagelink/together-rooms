import { describe, expect, it } from "vitest";

import { checkResourceUrl, displayHost } from "@/lib/url-safety";

describe("checkResourceUrl", () => {
  it("accepts ordinary https links", () => {
    const result = checkResourceUrl("https://Example.com/Docs/Intro?page=2#section");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.host).toBe("example.com");
    expect(result.normalized).toBe("https://example.com/Docs/Intro?page=2");
  });

  it("rejects dangerous schemes", () => {
    for (const raw of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "blob:https://example.com/abc",
      "vbscript:msgbox(1)",
    ]) {
      const result = checkResourceUrl(raw);
      expect(result.ok, raw).toBe(false);
    }
  });

  it("rejects malformed input", () => {
    expect(checkResourceUrl("not a url").ok).toBe(false);
    expect(checkResourceUrl("").ok).toBe(false);
    expect(checkResourceUrl("https://").ok).toBe(false);
  });

  it("rejects loopback, private, link-local and metadata targets", () => {
    for (const raw of [
      "http://localhost:3000/x",
      "http://127.0.0.1/",
      "http://127.1/",
      "http://10.0.0.5/admin",
      "http://172.16.9.9/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.3.2/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://intranet/",
      "http://db.internal/",
      "http://printer.local/",
    ]) {
      const result = checkResourceUrl(raw);
      expect(result.ok, raw).toBe(false);
      if (!result.ok) expect(result.reason).toBe("private_network");
    }
  });

  it("rejects embedded credentials", () => {
    const result = checkResourceUrl("https://user:pass@example.com/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("credentials_not_allowed");
  });

  it("rejects over-long URLs", () => {
    const result = checkResourceUrl(`https://example.com/${"a".repeat(2100)}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_long");
  });

  it("normalizes for duplicate comparison without losing meaning", () => {
    const a = checkResourceUrl("https://example.com/a?b=2&a=1&utm_source=news#top");
    const b = checkResourceUrl("HTTPS://EXAMPLE.COM:443/a?a=1&b=2&fbclid=xyz");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.normalized).toBe(b.normalized);
    expect(a.normalized).toBe("https://example.com/a?a=1&b=2");
  });

  it("keeps meaningful query parameters distinct", () => {
    const one = checkResourceUrl("https://example.com/search?q=rust");
    const two = checkResourceUrl("https://example.com/search?q=zig");
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(one.normalized).not.toBe(two.normalized);
  });

  it("keeps the original URL verbatim", () => {
    const result = checkResourceUrl("https://example.com/a?utm_source=x#frag");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toContain("utm_source=x");
    expect(result.url).toContain("#frag");
  });
});

describe("displayHost", () => {
  it("strips a www prefix", () => {
    expect(displayHost("www.example.com")).toBe("example.com");
    expect(displayHost(null)).toBe("");
  });
});
