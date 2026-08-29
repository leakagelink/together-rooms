/**
 * PHASE 15.2 — Digital Asset Links validation.
 *
 * This suite reads the live App Links statement shipped under
 * public/.well-known/assetlinks.json and asserts the exact production
 * package name and Google Play App Signing SHA-256 fingerprint are present.
 *
 * A placeholder fingerprint or a mismatch is an immediate release blocker,
 * because Verified App Links would stop working on the Play build.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { EXPECTED_PACKAGE_NAME } from "./app-identity";

const EXPECTED_FINGERPRINT =
  "9C:41:A6:69:FE:19:74:AF:B5:77:07:D1:3E:20:38:4A:A3:62:EE:3F:F5:2A:99:D6:D9:41:AB:55:EB:98:46:9A";

interface AssetLinkStatement {
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

function loadAssetLinks(): AssetLinkStatement[] {
  const path = resolve(process.cwd(), "public", ".well-known", "assetlinks.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as AssetLinkStatement[];
}

describe("Digital Asset Links — production App Links", () => {
  it("ASSET-T1: assetlinks.json is valid JSON", () => {
    const statements = loadAssetLinks();
    expect(Array.isArray(statements)).toBe(true);
    expect(statements.length).toBeGreaterThan(0);
  });

  it("ASSET-T2: the production package name is pinned", () => {
    const statements = loadAssetLinks();
    const android = statements.find((s) => s.target?.namespace === "android_app");
    expect(android).toBeDefined();
    expect(android!.target.package_name).toBe(EXPECTED_PACKAGE_NAME);
  });

  it("ASSET-T3: the real Google Play App Signing SHA-256 fingerprint is present", () => {
    const statements = loadAssetLinks();
    const fingerprints = statements.flatMap(
      (s) => s.target?.sha256_cert_fingerprints ?? [],
    );
    expect(fingerprints).toContain(EXPECTED_FINGERPRINT);
  });

  it("ASSET-T4: no placeholder fingerprints remain", () => {
    const statements = loadAssetLinks();
    const raw = JSON.stringify(statements);
    expect(raw).not.toContain("REPLACE_WITH");
    expect(raw).not.toContain("REPLACE_WITH_RELEASE_SIGNING_SHA256");
    expect(raw).not.toContain("REPLACE_WITH_PLAY_APP_SIGNING_SHA256");
  });

  it("ASSET-T5: the App Link statement delegates URL handling", () => {
    const statements = loadAssetLinks();
    const android = statements.find((s) => s.target?.namespace === "android_app");
    expect(android!.relation).toContain("delegate_permission/common.handle_all_urls");
  });
});
