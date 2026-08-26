/**
 * PHASE 12.1 — acknowledgement recovery tests (ACK-RECOVERY-T1..T18).
 *
 * These run against an in-memory fake of `billing_ack_state` that reproduces
 * the guarantees the SQL provides (lease claiming, refusal to overwrite a
 * settled row, retention purge), so the recovery loop can be verified without
 * a database or any contact with Google.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ACK_ATTEMPTS } from "./acknowledgement";
import {
  acknowledgeWithRecovery,
  recordAckIntent,
  runBillingReconciliation,
  type AckRow,
  type ReconciliationClient,
} from "./reconciliation.server";
import {
  CURRENT_KEY_VERSION,
  openRecoveryToken,
  sealRecoveryToken,
  RECOVERY_RETENTION_MS,
} from "./token-crypto.server";
import { setLogSink } from "@/lib/observability/logger";

const RAW_TOKEN = "play-purchase-token-abcdefghijklmnop-1234567890";
const NOW = 1_700_000_000_000;
const USER = "00000000-0000-0000-0000-000000000042";

process.env["BILLING_TOKEN_RECOVERY_KEY_V1"] = "unit-test-recovery-key-0123456789abcdef";

const logLines: string[] = [];
setLogSink((line) => {
  logLines.push(typeof line === "string" ? line : JSON.stringify(line));
});

interface Row {
  purchase_token_hash: string;
  user_id: string;
  product_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  acknowledged_at: string | null;
  recovery_ciphertext: string | null;
  recovery_key_version: number | null;
  recovery_expires_at: string | null;
  lease_owner: string | null;
  lease_until: string | null;
}

/** In-memory stand-in for the table + the three SECURITY DEFINER routines. */
function fakeDb(now = NOW) {
  const rows = new Map<string, Row>();
  const runs: Record<string, unknown>[] = [];
  let clock = now;

  const client = {
    from: (table: string) => ({
      insert: async (values: Record<string, unknown>) => {
        if (table === "billing_reconciliation_runs") runs.push(values);
        return { data: null, error: null };
      },
      upsert: async (values: Record<string, unknown>) => {
        const hash = values["purchase_token_hash"] as string;
        if (!rows.has(hash)) {
          rows.set(hash, {
            purchase_token_hash: hash,
            user_id: values["user_id"] as string,
            product_id: values["product_id"] as string,
            status: "pending",
            attempts: 0,
            last_error: null,
            next_attempt_at: values["next_attempt_at"] as string,
            acknowledged_at: null,
            recovery_ciphertext: null,
            recovery_key_version: null,
            recovery_expires_at: null,
            lease_owner: null,
            lease_until: null,
          });
        }
        return { data: null, error: null };
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, value: unknown) => {
          const row = rows.get(value as string);
          if (row) Object.assign(row, values);
          return { data: null, error: null };
        },
      }),
      select: (_columns: string) => {
        const builder: Record<string, unknown> = {};
        let filterHash: string | null = null;
        const chain = (column?: string, val?: unknown) => {
          if (column === "purchase_token_hash") filterHash = val as string;
          return builder;
        };
        builder["eq"] = chain;
        builder["lte"] = chain;
        builder["order"] = chain;
        builder["limit"] = chain;
        builder["then"] = (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
          const data = filterHash
            ? [rows.get(filterHash)].filter(Boolean)
            : [...rows.values()].filter((r) => r.status === "pending");
          return Promise.resolve({ data, error: null }).then(resolve);
        };
        return builder;
      },
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "claim_billing_ack_work") {
        const owner = args["_owner"] as string;
        const claimed: AckRow[] = [];
        for (const row of rows.values()) {
          if (!["pending", "ack_in_progress"].includes(row.status)) continue;
          if (Date.parse(row.next_attempt_at) > clock) continue;
          if (row.lease_until && Date.parse(row.lease_until) > clock) continue;
          if (row.attempts >= MAX_ACK_ATTEMPTS) continue;
          row.lease_owner = owner;
          row.lease_until = new Date(clock + 120_000).toISOString();
          row.status = "ack_in_progress";
          claimed.push({ ...row } as unknown as AckRow);
        }
        return { data: claimed, error: null };
      }
      if (fn === "complete_billing_ack") {
        const row = rows.get(args["_hash"] as string);
        if (!row) return { data: false, error: null };
        // settled rows are never overwritten (stale-worker protection)
        if (row.status === "acknowledged" || row.status === "not_required") {
          return { data: false, error: null };
        }
        const owner = args["_owner"] as string | null;
        if (owner && row.lease_owner && row.lease_owner !== owner) {
          return { data: false, error: null };
        }
        row.status = args["_status"] as string;
        row.attempts = Math.max(row.attempts, args["_attempts"] as number);
        row.last_error = (args["_last_error"] as string | null) ?? null;
        row.next_attempt_at =
          (args["_next_attempt_at"] as string | null) ?? new Date(clock).toISOString();
        row.acknowledged_at =
          row.acknowledged_at ?? ((args["_acknowledged_at"] as string | null) ?? null);
        row.lease_owner = null;
        row.lease_until = null;
        if (args["_clear_recovery"]) {
          row.recovery_ciphertext = null;
          row.recovery_key_version = null;
          row.recovery_expires_at = null;
        }
        return { data: true, error: null };
      }
      if (fn === "purge_expired_ack_recovery") {
        let purged = 0;
        for (const row of rows.values()) {
          if (!row.recovery_ciphertext) continue;
          const expired =
            !row.recovery_expires_at || Date.parse(row.recovery_expires_at) <= clock;
          if (expired || ["acknowledged", "not_required"].includes(row.status)) {
            row.recovery_ciphertext = null;
            row.recovery_key_version = null;
            row.recovery_expires_at = null;
            purged += 1;
          }
        }
        return { data: purged, error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as ReconciliationClient;

  return {
    client,
    rows,
    runs,
    advance(ms: number) {
      clock += ms;
    },
    get clock() {
      return clock;
    },
  };
}

async function seedFailedAck(db: ReturnType<typeof fakeDb>) {
  vi.doMock("./verification.server", () => ({
    acknowledgePlaySubscription: async () => ({ ok: false, reason: "request_failed" }),
    verifyPlayPurchase: async () => ({ ok: false, reason: "verification_failed" }),
  }));
  await acknowledgeWithRecovery(
    db.client,
    { userId: USER, productId: "premium_monthly", purchaseToken: RAW_TOKEN },
    { acknowledged: false, state: "active", productId: "premium_monthly" },
    NOW,
  );
  vi.doUnmock("./verification.server");
  vi.resetModules();
  return [...db.rows.values()][0]!;
}

describe("ACK-RECOVERY — billing acknowledgement recovery", () => {
  beforeEach(() => {
    logLines.length = 0;
    vi.resetModules();
  });

  it("ACK-RECOVERY-T1: a failed acknowledgement leaves a recoverable pending row", async () => {
    const db = fakeDb();
    const row = await seedFailedAck(db);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.recovery_ciphertext).toBeTruthy();
    expect(row.recovery_ciphertext).not.toContain(RAW_TOKEN);
    expect(Date.parse(row.next_attempt_at)).toBeGreaterThan(NOW);
  });

  it("ACK-RECOVERY-T2: retry works after a process restart (state is durable, not in-memory)", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    // Simulate a completely fresh process: nothing but the database survives.
    db.advance(10 * 60_000);
    const summary = await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => ({ ok: true, performed: true }),
    });
    expect(summary.repaired).toBe(1);
    expect([...db.rows.values()][0]!.status).toBe("acknowledged");
  });

  it("ACK-RECOVERY-T3: recovery runs with no user, device or session involved", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    db.advance(10 * 60_000);
    const seen: AckRow[] = [];
    await runBillingReconciliation(db.client, {
      now: db.clock,
      triggerSource: "cron",
      acknowledge: async (row) => {
        seen.push(row);
        return { ok: true, performed: true };
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.user_id).toBe(USER);
  });

  it("ACK-RECOVERY-T4: the raw token is recovered from storage, not resubmitted", async () => {
    const db = fakeDb();
    const row = await seedFailedAck(db);
    const recovered = await openRecoveryToken(row.recovery_ciphertext);
    expect(recovered).toBe(RAW_TOKEN);
  });

  it("ACK-RECOVERY-T5: the raw purchase token never appears in logs", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    db.advance(10 * 60_000);
    await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => ({ ok: false, reason: "request_failed" }),
    });
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join("\n")).not.toContain(RAW_TOKEN);
  });

  it("ACK-RECOVERY-T6: no client-visible surface carries the raw token or ciphertext", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    db.advance(10 * 60_000);
    const summary = await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => ({ ok: true, performed: true }),
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(RAW_TOKEN);
    expect(Object.keys(summary).sort()).toEqual(
      ["correlationId", "examined", "failed", "repaired"].sort(),
    );
  });

  it("ACK-RECOVERY-T7: duplicate workers cannot both claim the same row", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    db.advance(10 * 60_000);
    const calls: string[] = [];
    const [a, b] = await Promise.all([
      runBillingReconciliation(db.client, {
        now: db.clock,
        workerId: "worker-a",
        acknowledge: async (row) => {
          calls.push(row.purchase_token_hash);
          return { ok: true, performed: true };
        },
      }),
      runBillingReconciliation(db.client, {
        now: db.clock,
        workerId: "worker-b",
        acknowledge: async (row) => {
          calls.push(row.purchase_token_hash);
          return { ok: true, performed: true };
        },
      }),
    ]);
    expect(calls).toHaveLength(1);
    expect(a.examined + b.examined).toBe(1);
    expect([...db.rows.values()][0]!.status).toBe("acknowledged");
  });

  it("ACK-RECOVERY-T8: repeating a successful acknowledgement is idempotent", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    db.advance(10 * 60_000);
    await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => ({ ok: true, performed: true }),
    });
    const first = { ...[...db.rows.values()][0]! };
    db.advance(60_000);
    const second = await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => ({ ok: true, performed: true }),
    });
    expect(second.examined).toBe(0);
    expect([...db.rows.values()][0]!.acknowledged_at).toBe(first.acknowledged_at);
  });

  it("ACK-RECOVERY-T9: a stale worker cannot overwrite a successful acknowledgement", async () => {
    const db = fakeDb();
    const row = await seedFailedAck(db);
    db.advance(10 * 60_000);
    await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => ({ ok: true, performed: true }),
    });
    const acknowledgedAt = [...db.rows.values()][0]!.acknowledged_at;

    // A worker that started earlier now reports a failure for the same row.
    const stale = await db.client.rpc("complete_billing_ack", {
      _hash: row.purchase_token_hash,
      _owner: "stale-worker",
      _status: "failed_terminal",
      _attempts: 9,
      _last_error: "request_failed",
      _next_attempt_at: null,
      _acknowledged_at: null,
      _clear_recovery: true,
    });
    expect(stale.data).toBe(false);
    expect([...db.rows.values()][0]!.status).toBe("acknowledged");
    expect([...db.rows.values()][0]!.acknowledged_at).toBe(acknowledgedAt);
  });

  it("ACK-RECOVERY-T10: stored recovery data is opaque without the server-side key", async () => {
    const sealed = await sealRecoveryToken(RAW_TOKEN);
    expect(sealed).not.toBeNull();
    expect(sealed!.ciphertext).not.toContain(RAW_TOKEN);
    // A database client sees the envelope only; without the env key it decodes to nothing.
    const key = process.env["BILLING_TOKEN_RECOVERY_KEY_V1"];
    delete process.env["BILLING_TOKEN_RECOVERY_KEY_V1"];
    await expect(openRecoveryToken(sealed!.ciphertext)).resolves.toBeNull();
    process.env["BILLING_TOKEN_RECOVERY_KEY_V1"] = key!;
  });

  it("ACK-RECOVERY-T11: malformed or tampered ciphertext fails safely", async () => {
    const sealed = await sealRecoveryToken(RAW_TOKEN);
    const parts = sealed!.ciphertext.split(".");
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]}AA`].join(".");
    await expect(openRecoveryToken(tampered)).resolves.toBeNull();
    await expect(openRecoveryToken("garbage")).resolves.toBeNull();
    await expect(openRecoveryToken("v1.1.short.short")).resolves.toBeNull();
    await expect(openRecoveryToken(null)).resolves.toBeNull();
    await expect(openRecoveryToken("v9.1.AAAAAAAAAAAAAAAA.AAAA")).resolves.toBeNull();
  });

  it("ACK-RECOVERY-T12: the envelope carries a key version for future rotation", async () => {
    const sealed = await sealRecoveryToken(RAW_TOKEN);
    expect(sealed!.keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(sealed!.ciphertext.startsWith(`v1.${CURRENT_KEY_VERSION}.`)).toBe(true);
    // An envelope naming a key version with no configured secret cannot be opened.
    const parts = sealed!.ciphertext.split(".");
    await expect(
      openRecoveryToken([parts[0], "7", parts[2], parts[3]].join(".")),
    ).resolves.toBeNull();
  });

  it("ACK-RECOVERY-T13: recovery data is deleted once acknowledgement settles", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    expect([...db.rows.values()][0]!.recovery_ciphertext).toBeTruthy();
    db.advance(10 * 60_000);
    await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => ({ ok: true, performed: true }),
    });
    const row = [...db.rows.values()][0]!;
    expect(row.recovery_ciphertext).toBeNull();
    expect(row.recovery_key_version).toBeNull();
    expect(row.recovery_expires_at).toBeNull();
  });

  it("ACK-RECOVERY-T13b: retention expiry alone removes recovery data", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    db.advance(RECOVERY_RETENTION_MS + 1000);
    await db.client.rpc("purge_expired_ack_recovery", {});
    expect([...db.rows.values()][0]!.recovery_ciphertext).toBeNull();
  });

  it("ACK-RECOVERY-T14: hash-based identity and idempotency are preserved", async () => {
    const db = fakeDb();
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(RAW_TOKEN).digest("hex");
    await recordAckIntent(db.client, {
      tokenHash: hash,
      userId: USER,
      productId: "premium_monthly",
      purchaseToken: RAW_TOKEN,
      now: NOW,
    });
    await recordAckIntent(db.client, {
      tokenHash: hash,
      userId: USER,
      productId: "premium_monthly",
      purchaseToken: RAW_TOKEN,
      now: NOW,
    });
    expect(db.rows.size).toBe(1);
    expect([...db.rows.keys()][0]).toBe(hash);
    expect([...db.rows.values()][0]!.attempts).toBe(0);
  });

  it("ACK-RECOVERY-T15: exhausted retries become an operationally visible terminal state", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    const row = [...db.rows.values()][0]!;
    row.attempts = MAX_ACK_ATTEMPTS - 1;
    row.next_attempt_at = new Date(NOW).toISOString();
    db.advance(1000);
    await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => ({ ok: false, reason: "request_failed" }),
    });
    expect(row.status).toBe("failed_terminal");
    expect(row.last_error).toBe("request_failed");
    expect(logLines.join("\n")).toContain("acknowledgement_attempt_failed");
  });

  it("ACK-RECOVERY-T16: a pass with no recovery material parks the row instead of burning retries", async () => {
    const db = fakeDb();
    const row = await seedFailedAck(db);
    row.recovery_ciphertext = null;
    row.recovery_key_version = null;
    db.advance(10 * 60_000);
    const summary = await runBillingReconciliation(db.client, { now: db.clock });
    expect(summary.failed).toBe(1);
    expect(row.status).toBe("recovery_required");
    expect(row.attempts).toBe(1); // unchanged: no attempt was consumed
    expect(logLines.join("\n")).toContain("acknowledgement_recovery_required");
  });

  it("ACK-RECOVERY-T17: an RTDN-triggered pass does not re-acknowledge a settled purchase", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    db.advance(10 * 60_000);
    let calls = 0;
    await runBillingReconciliation(db.client, {
      now: db.clock,
      acknowledge: async () => {
        calls += 1;
        return { ok: true, performed: true };
      },
    });
    db.advance(60_000);
    await runBillingReconciliation(db.client, {
      now: db.clock,
      triggerSource: "rtdn",
      acknowledge: async () => {
        calls += 1;
        return { ok: true, performed: true };
      },
    });
    expect(calls).toBe(1);
  });

  it("ACK-RECOVERY-T18: a worker crash mid-acknowledgement keeps the row recoverable", async () => {
    const db = fakeDb();
    await seedFailedAck(db);
    db.advance(10 * 60_000);
    await expect(
      runBillingReconciliation(db.client, {
        now: db.clock,
        workerId: "crashing-worker",
        acknowledge: async () => {
          throw new Error("process killed mid-call");
        },
      }),
    ).resolves.toMatchObject({ failed: 1 });
    const row = [...db.rows.values()][0]!;
    // Lease released, recovery material intact, still eligible for a later pass.
    expect(row.status).toBe("pending");
    expect(row.lease_owner).toBeNull();
    expect(row.recovery_ciphertext).toBeTruthy();
  });
});
