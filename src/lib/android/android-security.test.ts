/**
 * PHASE 10 — ANDROID-T1 … ANDROID-T15.
 *
 * These assert the *rules* the Android shell depends on. Anything that needs a
 * physical device (real camera acquisition, real Play billing, real WebView
 * navigation interception) is listed in docs/ANDROID.md instead of being
 * faked here.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  PENDING_DESTINATION_KEY,
  rememberPendingDestination,
  resolveDeepLink,
  takePendingDestination,
} from "./deep-link";
import {
  debugCapabilities,
  isReleaseEnvironment,
  resolveEnvironment,
  validateRuntimeConfig,
} from "./environment";
import { buildCrashReport } from "./crash-reporting";
import {
  MutationGuard,
  canReuseCallAuthorization,
  isRoomStateStale,
  lifecycleMutatesRemoteState,
  revalidationPlan,
} from "./lifecycle";
import { classifyNavigation, resolveBackAction } from "./navigation";
import {
  FEATURES_INDEPENDENT_OF_DEVICE_PERMISSIONS,
  PERMISSION_TRIGGERS,
  featureBlockedByPermission,
} from "./permissions";

const PROD = {
  mode: "production",
  supabaseUrl: "https://ebvilmlrsmoyakatqzqr.supabase.co",
  supabasePublishableKey: "sb_publishable_A8gKpxFLxUb55nJEAgj-TQ_SKkjyJNy",
};

describe("Phase 10 — Android production hardening", () => {
  beforeEach(() => {
    // The suite runs in Node: provide the minimal session storage surface the
    // pending-destination store uses, so the security rules are exercised.
    const map = new Map<string, string>();
    const store = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    } as unknown as Storage;
    (globalThis as { window?: unknown }).window = { sessionStorage: store };
  });

  it("ANDROID-T1 release configuration cannot silently use a development backend", () => {
    const local = validateRuntimeConfig({ ...PROD, supabaseUrl: "http://localhost:54321" });
    expect(local.ok).toBe(false);
    expect(local.problems).toContain("development_backend_in_release");
    expect(local.problems).toContain("insecure_supabase_url");
    // Same value is acceptable in development, so the failure is release-specific.
    expect(
      validateRuntimeConfig({ ...PROD, mode: "development", supabaseUrl: "http://localhost:54321" })
        .ok,
    ).toBe(true);
    expect(validateRuntimeConfig(PROD).ok).toBe(true);
  });

  it("ANDROID-T2 required production configuration fails clearly when missing", () => {
    const missing = validateRuntimeConfig({ ...PROD, supabaseUrl: "", supabasePublishableKey: "" });
    expect(missing.ok).toBe(false);
    expect(missing.problems).toEqual(
      expect.arrayContaining(["missing_supabase_url", "missing_supabase_key"]),
    );
    expect(
      validateRuntimeConfig({ ...PROD, supabaseUrl: "https://your-project.supabase.co" }).problems,
    ).toContain("placeholder_value");
  });

  it("ANDROID-T3 debug-only behaviour is not enabled in release configuration", () => {
    const release = debugCapabilities(resolveEnvironment("production"));
    expect(release).toEqual({
      verboseLogging: false,
      testBilling: false,
      testAds: false,
      webviewDebugging: false,
    });
    expect(isReleaseEnvironment(resolveEnvironment("production"))).toBe(true);
    expect(debugCapabilities(resolveEnvironment("development")).webviewDebugging).toBe(true);
  });

  it("ANDROID-T4 deep-link redirect destination is validated", () => {
    const ok = resolveDeepLink("https://together-rooms.lovable.app/rooms");
    expect(ok).toEqual({ ok: true, path: "/rooms", kind: "app" });
    expect(resolveDeepLink("https://evil.example.com/rooms")).toEqual({
      ok: false,
      reason: "foreign_origin",
    });
    expect(resolveDeepLink("/admin/roles").ok).toBe(false);
  });

  it("ANDROID-T5 malformed invite deep links fail safely", () => {
    for (const bad of [
      "",
      "not a url",
      "javascript:alert(1)",
      "https://together-rooms.lovable.app/invite/short",
      "https://together-rooms.lovable.app/invite/<script>",
      "intent://together-rooms.lovable.app/invite/abc#Intent;end",
    ]) {
      expect(resolveDeepLink(bad).ok).toBe(false);
    }
  });

  it("ANDROID-T6 an expired invite deep link does not bypass server validation", () => {
    // A well-formed token resolves only to the *route*; nothing about
    // membership is decided on the device.
    const token = "a1b2".repeat(12);
    const result = resolveDeepLink(`https://together-rooms.lovable.app/invite/${token}`);
    expect(result).toMatchObject({ ok: true, kind: "invite", path: `/invite/${token}` });
    if (result.ok) {
      expect(Object.keys(result)).not.toContain("member");
      expect(Object.keys(result)).not.toContain("roomId");
    }
  });

  it("ANDROID-T7 a pending invite destination cannot create an open redirect", () => {
    for (const attack of [
      "https://evil.example.com/",
      "//evil.example.com/rooms",
      "/\\evil.example.com",
      "https://together-rooms.lovable.app.evil.com/rooms",
      "https://user:pass@together-rooms.lovable.app/rooms",
      "http://together-rooms.lovable.app/rooms",
    ]) {
      expect(rememberPendingDestination(attack).ok).toBe(false);
    }
    expect(takePendingDestination()).toBeNull();

    rememberPendingDestination("https://together-rooms.lovable.app/rooms");
    expect(takePendingDestination()).toBe("/rooms");
    // One-shot: consumed destinations never replay.
    expect(takePendingDestination()).toBeNull();

    // Create / Join tapped while signed out resume after sign-in.
    rememberPendingDestination("/rooms/new");
    expect(takePendingDestination()).toBe("/rooms/new");
    rememberPendingDestination("/rooms/join");
    expect(takePendingDestination()).toBe("/rooms/join");

    // A destination injected directly into storage is re-validated on read.
    window.sessionStorage.setItem(
      PENDING_DESTINATION_KEY,
      JSON.stringify({ path: "https://evil.example.com", at: Date.now() }),
    );
    expect(takePendingDestination()).toBeNull();
  });

  it("ANDROID-T8 stale room state requires authoritative revalidation", () => {
    const now = 1_000_000;
    expect(isRoomStateStale({ fetchedAt: now - 1_000, now })).toBe(false);
    expect(isRoomStateStale({ fetchedAt: now - 60_000, now })).toBe(true);
    const plan = revalidationPlan("foreground", { inRoom: true, inCall: false });
    expect(plan.session).toBe(true);
    expect(plan.membership).toBe(true);
    expect(plan.roomState).toBe(true);
    expect(plan.playback).toBe(true);
    expect(revalidationPlan("process_start", { inRoom: true, inCall: true }).entitlement).toBe(
      true,
    );
  });

  it("ANDROID-T9 stale call authorization cannot survive beyond its rules", () => {
    const now = 1_000_000;
    expect(
      canReuseCallAuthorization({
        issuedAt: now - 5_000,
        expiresAt: now + 60_000,
        now,
        backgroundedSince: false,
      }),
    ).toBe(true);
    // Expired.
    expect(
      canReuseCallAuthorization({
        issuedAt: now - 5_000,
        expiresAt: now - 1,
        now,
        backgroundedSince: false,
      }),
    ).toBe(false);
    // Backgrounded: always re-authorized on return.
    expect(
      canReuseCallAuthorization({
        issuedAt: now,
        expiresAt: now + 600_000,
        now,
        backgroundedSince: true,
      }),
    ).toBe(false);
    expect(revalidationPlan("foreground", { inRoom: true, inCall: true }).callAuthorization).toBe(
      true,
    );
  });

  it("ANDROID-T10 permission denial does not break unrelated app functionality", () => {
    for (const feature of FEATURES_INDEPENDENT_OF_DEVICE_PERMISSIONS) {
      expect(featureBlockedByPermission(feature, "camera")).toBe(false);
      expect(featureBlockedByPermission(feature, "microphone")).toBe(false);
      expect(featureBlockedByPermission(feature, "media_picker")).toBe(false);
    }
    expect(featureBlockedByPermission("video_call", "camera")).toBe(true);
    expect(featureBlockedByPermission("voice_call", "camera")).toBe(false);
    // Nothing is requested at startup.
    expect(PERMISSION_TRIGGERS.every((entry) => entry.requiredAtStartup === false)).toBe(true);
  });

  it("ANDROID-T11 local media selection does not bypass existing authorization", () => {
    // The picker only produces a local File; every session still goes through
    // the Phase 7 server-authoritative session + transport grant.
    const picker = PERMISSION_TRIGGERS.find((entry) => entry.permission === "media_picker");
    expect(picker).toBeDefined();
    expect(picker?.runtime).toBe(false);
    expect(picker?.trigger).toBe("pick_local_media");
    // A picked file never becomes a shareable URL for other members.
    expect(classifyNavigation("file:///storage/emulated/0/DCIM/photo.jpg")).toBe("blocked");
    expect(classifyNavigation("content://media/external/images/1")).toBe("blocked");
  });

  it("ANDROID-T12 background/foreground lifecycle does not mutate another member's state", () => {
    expect(lifecycleMutatesRemoteState()).toBe(false);
    const background = revalidationPlan("background", { inRoom: true, inCall: true });
    expect(Object.values(background).every((value) => value === false)).toBe(true);
    const foreground = revalidationPlan("foreground", { inRoom: true, inCall: true });
    // Every foreground action is a read.
    expect(Object.values(foreground).some((value) => value === true)).toBe(true);
  });

  it("ANDROID-T13 reconnect does not duplicate authoritative mutations", () => {
    const guard = new MutationGuard();
    const at = 1_000;
    expect(guard.accept({ key: "chat:msg-1", at })).toBe(true);
    expect(guard.accept({ key: "chat:msg-1", at: at + 10 })).toBe(false);
    expect(guard.accept({ key: "playback:play:v4", at })).toBe(true);
    expect(guard.accept({ key: "playback:play:v4", at: at + 25_000 })).toBe(false);
    // Outside the window a genuinely new attempt is allowed again.
    expect(guard.accept({ key: "chat:msg-1", at: at + 60_000 })).toBe(true);
    // A failed attempt can be retried.
    guard.release("chat:msg-1");
    expect(guard.accept({ key: "chat:msg-1", at: at + 60_100 })).toBe(true);
  });

  it("ANDROID-T14 release configuration does not expose sensitive environment values", () => {
    expect(
      validateRuntimeConfig({ ...PROD, supabasePublishableKey: "sb_secret_abc123" }).problems,
    ).toContain("secret_key_exposed");
    expect(
      validateRuntimeConfig({ ...PROD, supabasePublishableKey: "eyJhbGciOi.eyJzdWIi.c2ln" })
        .problems,
    ).toContain("secret_key_exposed");

    const report = buildCrashReport({
      error: new Error("failed for user a@b.com with Bearer eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl"),
      route: "/rooms/1",
      environment: "production",
      context: {
        message: "private chat text",
        purchase_token: "abc",
        roomMode: "call",
        participants: 3,
      },
    });
    expect(report.message).not.toContain("a@b.com");
    expect(report.message).not.toContain("eyJhbGciOi");
    expect(report.context).toEqual({ roomMode: "call", participants: 3 });
  });

  it("ANDROID-T15 external navigation follows the allowed navigation policy", () => {
    expect(classifyNavigation("https://together-rooms.lovable.app/rooms")).toBe("in_app");
    expect(classifyNavigation("/rooms")).toBe("in_app");
    expect(classifyNavigation("https://play.google.com/store/account/subscriptions")).toBe(
      "system_browser",
    );
    expect(classifyNavigation("https://evil.example.com")).toBe("blocked");
    expect(classifyNavigation("javascript:alert(1)")).toBe("blocked");
    expect(classifyNavigation("//evil.example.com")).toBe("blocked");
    expect(classifyNavigation("https://user:pass@together-rooms.lovable.app")).toBe("blocked");
  });

  it("back navigation respects hierarchy without trapping the user", () => {
    const base = { modalOpen: false, inActiveCall: false, canGoBack: true, confirmedLeave: false };
    expect(resolveBackAction({ ...base, modalOpen: true })).toBe("close_modal");
    expect(resolveBackAction({ ...base, inActiveCall: true })).toBe("confirm_leave_call");
    expect(resolveBackAction({ ...base, inActiveCall: true, confirmedLeave: true })).toBe(
      "navigate_back",
    );
    expect(resolveBackAction(base)).toBe("navigate_back");
    expect(resolveBackAction({ ...base, canGoBack: false })).toBe("exit_app");
  });
});
