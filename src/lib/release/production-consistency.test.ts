/**
 * Final production consistency guardrails for the live release:
 * App Links statement, free-only product surface and legal links.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

const REAL_FINGERPRINT =
  "9C:41:A6:69:FE:19:74:AF:B5:77:07:D1:3E:20:38:4A:A3:62:EE:3F:F5:2A:99:D6:D9:41:AB:55:EB:98:46:9A";

describe("assetlinks", () => {
  const statements = JSON.parse(read("public/.well-known/assetlinks.json")) as {
    relation: string[];
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
  }[];

  it("declares the production package with the real Play App Signing fingerprint", () => {
    expect(statements).toHaveLength(1);
    const statement = statements[0]!;
    expect(statement.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(statement.target.namespace).toBe("android_app");
    expect(statement.target.package_name).toBe("com.synctogether.com");
    expect(statement.target.sha256_cert_fingerprints).toEqual([REAL_FINGERPRINT]);
  });

  it("contains no placeholder fingerprint", () => {
    const raw = read("public/.well-known/assetlinks.json");
    expect(raw).not.toMatch(/placeholder|REPLACE|XX:XX|AA:BB|TODO/i);
  });
});

describe("free-only product surface", () => {
  it("profile query does not select subscription_tier", () => {
    const query = read("src/lib/profile-query.ts");
    expect(query).toContain('.select("id, username, display_name, bio, status, avatar_url")');
    expect(query).not.toMatch(/subscription_tier/);
    expect(read("src/routes/_authenticated/profile.tsx")).not.toMatch(/subscription_tier/);
  });

  it("has no purchase/subscribe/upgrade analytics events", () => {
    const source = read("src/lib/analytics.ts");
    expect(source).not.toMatch(/subscription_screen_viewed|purchase_started|restore_requested/);
  });

  it("declares purchase history as not collected", () => {
    const source = read("src/lib/release/data-safety.ts");
    expect(source).not.toMatch(/Google Play Billing"\]/);
  });
});

describe("legal surface", () => {
  it("privacy policy states the 18+ audience", () => {
    const source = read("src/routes/privacy.tsx");
    expect(source).toMatch(/aged 18 and over/);
    expect(source).not.toMatch(/under 13/);
  });

  it("settings exposes every legal and safety link", () => {
    const source = read("src/routes/_authenticated/settings.index.tsx");
    for (const path of ["/privacy", "/terms", "/guidelines", "/child-safety"]) {
      expect(source).toContain(path);
    }
  });
});
