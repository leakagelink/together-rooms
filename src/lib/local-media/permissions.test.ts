import { describe, expect, it } from "vitest";

import {
  blockingReason,
  buildPreflight,
  canStartSharing,
  detectTransportSupport,
  queryPermission,
} from "./permissions";

const base = {
  fileCount: 2,
  decode: "supported" as const,
  transportAvailable: true,
  consented: true,
};

describe("buildPreflight", () => {
  it("allows sharing only when files, decode, transport and consent are all good", () => {
    expect(canStartSharing(buildPreflight(base))).toBe(true);
  });

  it("blocks when no file was granted by the picker", () => {
    const checks = buildPreflight({ ...base, fileCount: 0 });
    expect(canStartSharing(checks)).toBe(false);
    expect(blockingReason(checks)).toMatch(/Choose media/);
  });

  it("blocks when the consent box is unticked", () => {
    const checks = buildPreflight({ ...base, consented: false });
    expect(canStartSharing(checks)).toBe(false);
    expect(blockingReason(checks)).toMatch(/right to share/);
  });

  it("blocks unsupported formats and missing transport ahead of pending items", () => {
    expect(canStartSharing(buildPreflight({ ...base, decode: "unsupported" }))).toBe(false);
    const noTransport = buildPreflight({ ...base, transportAvailable: false, consented: false });
    expect(blockingReason(noTransport)).toMatch(/peer connection/);
  });

  it("treats an uncertain format as an advisory warning, not a hard block", () => {
    const checks = buildPreflight({ ...base, decode: "maybe" });
    expect(checks.find((c) => c.id === "decode")?.state).toBe("pending");
    expect(canStartSharing(checks)).toBe(true);
    expect(blockingReason(checks)).toBeNull();
  });

  it("never requires camera or microphone", () => {
    const checks = buildPreflight(base);
    expect(checks.find((c) => c.id === "camera")?.state).toBe("not-required");
    expect(checks.find((c) => c.id === "microphone")?.state).toBe("not-required");
  });
});

describe("runtime probes", () => {
  it("detects peer transport support", () => {
    expect(detectTransportSupport({ RTCPeerConnection: function () {} })).toBe(true);
    expect(detectTransportSupport({})).toBe(false);
  });

  it("returns unknown instead of throwing when the permissions API misbehaves", async () => {
    await expect(
      queryPermission("camera" as PermissionName, {
        query: () => Promise.reject(new Error("nope")),
      }),
    ).resolves.toBe("unknown");
    await expect(
      queryPermission("camera" as PermissionName, {
        query: () => Promise.resolve({ state: "granted" }),
      }),
    ).resolves.toBe("granted");
  });
});
