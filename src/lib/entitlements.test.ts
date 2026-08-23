import { describe, expect, it } from "vitest";

import {
  describeStatus,
  FREE_SNAPSHOT,
  isSnapshotPremium,
  type EntitlementSnapshot,
} from "./entitlements";

const NOW = new Date("2026-01-10T00:00:00Z");

function snapshot(overrides: Partial<EntitlementSnapshot>): EntitlementSnapshot {
  return { ...FREE_SNAPSHOT, plan: "premium", premium: true, status: "active", ...overrides };
}

describe("entitlement derivation (ENTITLEMENT-U1..U8)", () => {
  it("U1: a missing snapshot is never premium", () => {
    expect(isSnapshotPremium(null, NOW)).toBe(false);
    expect(isSnapshotPremium(undefined, NOW)).toBe(false);
  });

  it("U2: the free snapshot is never premium", () => {
    expect(isSnapshotPremium(FREE_SNAPSHOT, NOW)).toBe(false);
  });

  it("U3: active with a future expiry is premium", () => {
    expect(isSnapshotPremium(snapshot({ expires_at: "2026-02-01T00:00:00Z" }), NOW)).toBe(true);
  });

  it("U4: active but expired is not premium (cache can't extend access)", () => {
    expect(isSnapshotPremium(snapshot({ expires_at: "2026-01-01T00:00:00Z" }), NOW)).toBe(false);
  });

  it("U5: grace period keeps access until grace_until passes", () => {
    expect(
      isSnapshotPremium(
        snapshot({ status: "grace_period", grace_until: "2026-01-20T00:00:00Z" }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isSnapshotPremium(
        snapshot({ status: "grace_period", grace_until: "2026-01-05T00:00:00Z" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("U6: paused, pending and revoked never grant premium", () => {
    for (const status of ["paused", "pending", "revoked", "expired"] as const) {
      expect(isSnapshotPremium(snapshot({ status }), NOW)).toBe(false);
    }
  });

  it("U7: a forged premium=false snapshot cannot be upgraded client-side", () => {
    expect(isSnapshotPremium({ ...snapshot({}), premium: false }, NOW)).toBe(false);
  });

  it("U8: status copy never uses pressure or countdowns", () => {
    const texts = [
      describeStatus(FREE_SNAPSHOT),
      describeStatus(snapshot({})),
      describeStatus(snapshot({ cancel_at_period_end: true })),
      describeStatus(snapshot({ status: "grace_period" })),
      describeStatus(snapshot({ status: "pending", premium: false })),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/hurry|only|last chance|expires in|\d+\s*(hours|minutes) left/i);
    }
  });
});
