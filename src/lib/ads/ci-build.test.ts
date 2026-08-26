/** PHASE 14.2 — deterministic Android CI/release gate checks (CI-BUILD-T1 … T7). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const workflow = read(".github/workflows/android-build.yml");
const appGradle = read("android/app/build.gradle");
const androidIgnore = read("android/.gitignore");

describe("phase 14.2 deterministic Android CI build gate", () => {
  it("CI-BUILD-T1: checks out source and compiles the actual Android directory", () => {
    expect(workflow).toContain("uses: actions/checkout@v4");
    expect(workflow).toMatch(/name: Compile debug variant[\s\S]*?working-directory: android/);
    expect(workflow).toMatch(/name: Verify release compilation[\s\S]*?working-directory: android/);
  });

  it("CI-BUILD-T2: pins JDK 21 and installs API/build-tools 36", () => {
    expect(workflow).toContain('java-version: "21"');
    expect(workflow).toContain('sdkmanager "platforms;android-36" "build-tools;36.0.0"');
  });

  it("CI-BUILD-T3: invokes the checked-in wrapper for debug and unsigned release", () => {
    expect(workflow).toContain("./gradlew assembleDebug --no-daemon --console=plain --stacktrace");
    expect(workflow).toContain("./gradlew assembleRelease --no-daemon --console=plain --stacktrace");
    expect(workflow).toContain("uses: gradle/actions/setup-gradle@v4");
  });

  it("CI-BUILD-T4: Gradle failures cannot be ignored or converted to success", () => {
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
    expect(workflow).not.toMatch(/\|\|\s*true/);
    expect(workflow).not.toMatch(/set \+e/);
  });

  it("CI-BUILD-T5: CI neither consumes signing secrets nor publishes artifacts", () => {
    expect(workflow).not.toMatch(/ANDROID_KEYSTORE|ANDROID_KEY_PASSWORD|ANDROID_KEY_ALIAS/);
    expect(workflow).not.toMatch(/uses:\s*actions\/upload-artifact/);
    expect(workflow).not.toMatch(/^\s*-\s+name:\s+.*(?:deploy|publish)/im);
    expect(workflow).not.toMatch(/^\s+run:\s+.*(?:deploy|publish)/im);
  });

  it("CI-BUILD-T6: release signing fails clearly when explicitly requested or partial", () => {
    expect(appGradle).toContain('System.getenv("REQUIRE_SIGNED_RELEASE")');
    expect(appGradle).toContain("Incomplete release signing configuration");
    expect(appGradle).toContain("Signed release requested but signing configuration is missing");
    expect(appGradle).toContain("releaseSigningConfigured");
  });

  it("CI-BUILD-T7: generated outputs and owner keystores remain untracked", () => {
    expect(androidIgnore).toContain("local.properties");
    expect(androidIgnore).toContain("*.jks");
    expect(androidIgnore).toContain("*.keystore");
    expect(androidIgnore).toContain("*.aab");
    expect(androidIgnore).toContain("build/");
  });
});