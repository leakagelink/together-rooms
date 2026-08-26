/**
 * PHASE 12 — billing reconciliation tests (RECON-T1..T7).
 *
 * These exercise the recovery pass against a fake admin client, so no Google
 * or database access is required and the invariants are checked directly.
 */
import { describe, expect, it, vi } from "vitest";

import { runBillingReconciliation, type AckRow, type ReconciliationClient } from "./reconciliation.server";
import { setLogSink } from "@/lib/observability/logger";

setLogSink(() => undefined);

const NOW = 1_700_000_000_000;

function fakeAdmin(rows: AckRow[]) {
  const updates: Record<string, unknown>[] = [];
  const runs: Record<string, unknown>[] = [];

  const selectBuilder = () => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder["eq"] = chain;
    builder["lte"] = chain;
    builder["order"] = chain;
    builder["limit"] = chain;
    builder["then"] = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return builder;
  };

  const client = {
    from: (table: string) => ({
      insert: async (values: Record<string, unknown>) => {
        if (table === "billing_reconciliation_runs") runs.push(values);
        return { data: null, error: null };
      },
      upsert: async () => ({ data: null, error: null }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, value: unknown) => {
          updates.push({ ...values, key: value });
          return { data: null, error: null };
        },
      }),
      select: () => selectBuilder(),
    }),
    rpc: async () => ({ data: null, error: null }),
  } as unknown as ReconciliationClient;

  return { client, updates, runs };
}

const dueRow = (overrides: Partial<AckRow> = {}): AckRow => ({
  purchase_token_hash: "hash-1",
  user_id: "00000000-0000-0000-0000-000000000001",
  product_id: "premium_monthly",
  status: "pending",
  attempts: 0,
  next_attempt_at: new Date(NOW - 60_000).toISOString(),
  ...overrides,
});

describe("RECON — billing reconciliation", () => {
  it("RECON-T1: a successful repair closes the row permanently", async () => {
    const { client, updates } = fakeAdmin([dueRow()]);
    const summary = await runBillingReconciliation(client, {
      now: NOW,
      acknowledge: async () => ({ ok: true, performed: true }),
    });
    expect(summary.repaired).toBe(1);
    expect(summary.failed).toBe(0);
    expect(updates[0]?.["status"]).toBe("acknowledged");
    expect(updates[0]?.["acknowledged_at"]).toBeTruthy();
  });

  it("RECON-T2: a retryable failure schedules a later attempt, never a downgrade", async () => {
    const { client, updates } = fakeAdmin([dueRow()]);
    const summary = await runBillingReconciliation(client, {
      now: NOW,
      acknowledge: async () => ({ ok: false, reason: "request_failed" }),
    });
    expect(summary.failed).toBe(1);
    expect(updates[0]?.["status"]).toBe("pending");
    expect(Date.parse(updates[0]?.["next_attempt_at"] as string)).toBeGreaterThan(NOW);
  });

  it("RECON-T3: exhausted retries become terminal and stay operator-visible", async () => {
    const { client, updates } = fakeAdmin([dueRow({ attempts: 5 })]);
    await runBillingReconciliation(client, {
      now: NOW,
      acknowledge: async () => ({ ok: false, reason: "request_failed" }),
    });
    expect(updates[0]?.["status"]).toBe("failed_terminal");
  });

  it("RECON-T4: a thrown provider error is contained, not propagated", async () => {
    const { client } = fakeAdmin([dueRow()]);
    await expect(
      runBillingReconciliation(client, {
        now: NOW,
        acknowledge: async () => {
          throw new Error("socket hang up");
        },
      }),
    ).resolves.toMatchObject({ failed: 1 });
  });

  it("RECON-T5: rows that are not yet due are skipped", async () => {
    const { client, updates } = fakeAdmin([
      dueRow({ next_attempt_at: new Date(NOW + 3_600_000).toISOString() }),
    ]);
    const acknowledge = vi.fn(async () => ({ ok: true as const, performed: true }));
    const summary = await runBillingReconciliation(client, { now: NOW, acknowledge });
    expect(summary.examined).toBe(0);
    expect(acknowledge).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("RECON-T6: without a raw token the pass measures the backlog and burns no attempts", async () => {
    const { client, updates } = fakeAdmin([dueRow()]);
    const summary = await runBillingReconciliation(client, { now: NOW });
    expect(summary.examined).toBe(1);
    expect(summary.failed).toBe(1);
    // no attempt counter was consumed for work that could not be performed
    expect(updates).toHaveLength(0);
  });

  it("RECON-T7: every pass writes an auditable run record", async () => {
    const { client, runs } = fakeAdmin([dueRow()]);
    const summary = await runBillingReconciliation(client, {
      now: NOW,
      triggerSource: "http",
      acknowledge: async () => ({ ok: true, performed: true }),
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.["trigger_source"]).toBe("http");
    expect(runs[0]?.["examined"]).toBe(1);
    expect((runs[0]?.["detail"] as Record<string, unknown>)["correlation_id"]).toBe(
      summary.correlationId,
    );
  });
});
