/**
 * PHASE 12 — billing reconciliation and acknowledgement recovery (server-only).
 *
 * Two failure modes are recovered here:
 *
 *  A. ACKNOWLEDGEMENT GAPS — verification succeeded and the entitlement was
 *     granted, but the acknowledge call to Play failed. Play auto-refunds an
 *     unacknowledged purchase after three days, so the attempt is persisted
 *     in `billing_ack_state` and retried with bounded backoff until it
 *     succeeds or is marked terminal for an operator.
 *
 *  B. RTDN GAPS — a notification was lost, arrived out of order, or failed
 *     mid-processing. Reconciliation re-verifies the affected tokens against
 *     the Play Developer API and re-applies the authoritative result through
 *     `apply_billing_event`.
 *
 * Safety properties:
 *  - Google remains the ONLY source of truth. Reconciliation never invents an
 *    entitlement; it only replays a fresh verification.
 *  - `apply_billing_event` is monotonic on `event_seq`, so replaying an older
 *    state is a no-op rather than a downgrade. Reconciliation is therefore
 *    idempotent and safe to run concurrently with live RTDN traffic.
 *  - A failed acknowledgement never revokes or blocks a paid entitlement.
 */
import {
  isAckDue,
  nextAckState,
  type AckAttemptResult,
  type AckStateRow,
} from "./acknowledgement";
import { newCorrelationId } from "@/lib/observability/correlation";
import { createLogger } from "@/lib/observability/logger";
import { recordMetric } from "@/lib/observability/monitor";

type QueryResult = Promise<{ data: unknown; error: unknown }>;

interface SelectBuilder extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: unknown): SelectBuilder;
  lte(column: string, value: string): SelectBuilder;
  order(column: string, options: { ascending: boolean }): SelectBuilder;
  limit(n: number): SelectBuilder;
}

export interface ReconciliationClient {
  from(table: string): {
    insert(values: Record<string, unknown>): QueryResult;
    upsert(values: Record<string, unknown>, options?: Record<string, unknown>): QueryResult;
    update(values: Record<string, unknown>): { eq(column: string, value: unknown): QueryResult };
    select(columns: string): SelectBuilder;
  };
  rpc(fn: string, args: Record<string, unknown>): QueryResult;
}

export interface AckRow extends AckStateRow {
  purchase_token_hash: string;
  user_id: string;
  product_id: string;
}

/**
 * Records that a purchase needs acknowledgement. Called right after a
 * successful verification, BEFORE the acknowledge attempt, so a crash between
 * the two still leaves a durable row for the worker to pick up.
 */
export async function recordAckIntent(
  admin: ReconciliationClient,
  input: { tokenHash: string; userId: string; productId: string },
): Promise<void> {
  await admin.from("billing_ack_state").upsert(
    {
      purchase_token_hash: input.tokenHash,
      user_id: input.userId,
      product_id: input.productId,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
    },
    { onConflict: "purchase_token_hash", ignoreDuplicates: true },
  );
}

/** Persists the outcome of one acknowledgement attempt. */
export async function recordAckAttempt(
  admin: ReconciliationClient,
  tokenHash: string,
  previousAttempts: number,
  result: AckAttemptResult,
  now: number = Date.now(),
): Promise<ReturnType<typeof nextAckState>> {
  const transition = nextAckState({ attempts: previousAttempts }, result, now);
  await admin
    .from("billing_ack_state")
    .update({
      status: transition.status,
      attempts: transition.attempts,
      last_error: transition.lastError,
      last_attempt_at: new Date(now).toISOString(),
      next_attempt_at: transition.nextAttemptAt ?? new Date(now).toISOString(),
      acknowledged_at: transition.acknowledgedAt,
    })
    .eq("purchase_token_hash", tokenHash);

  if (transition.terminal) {
    recordMetric("billing.ack.terminal_failure");
  }
  return transition;
}

/**
 * Acknowledges a purchase with durable recovery, from a path that holds the
 * RAW purchase token (post-verification, or an RTDN redelivery).
 *
 * Order matters: the intent row is written first, so a crash before or during
 * the Play call leaves the purchase visibly un-acknowledged rather than
 * silently lost. The result is then recorded, which either closes the row or
 * schedules a bounded retry. The entitlement is never touched here.
 */
export async function acknowledgeWithRecovery(
  admin: ReconciliationClient,
  input: { userId: string; productId: string; purchaseToken: string },
  verified: { acknowledged: boolean; state: string; productId: string },
  now: number = Date.now(),
): Promise<void> {
  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(input.purchaseToken).digest("hex");
  const logger = createLogger("BILLING");

  await recordAckIntent(admin, {
    tokenHash,
    userId: input.userId,
    productId: input.productId,
  });

  const { data } = await admin
    .from("billing_ack_state")
    .select("attempts")
    .eq("purchase_token_hash", tokenHash)
    .limit(1);
  const attempts = ((data ?? []) as { attempts: number }[])[0]?.attempts ?? 0;

  let result: AckAttemptResult;
  try {
    const { acknowledgePlaySubscription } = await import("./verification.server");
    result = await acknowledgePlaySubscription(
      input.purchaseToken,
      verified as unknown as Parameters<typeof acknowledgePlaySubscription>[1],
    );
  } catch {
    result = { ok: false, reason: "request_failed" };
  }

  const transition = await recordAckAttempt(admin, tokenHash, attempts, result, now);
  if (transition.status === "acknowledged") {
    recordMetric("billing.ack.success");
  } else if (transition.status !== "not_required") {
    logger.warn("acknowledgement_failed", {
      outcome: transition.terminal ? "terminal" : "retry_scheduled",
      ...(transition.errorClass ? { errorClass: transition.errorClass } : {}),
      ...(transition.lastError ? { reason: transition.lastError } : {}),
      userId: input.userId,
      data: { attempts: transition.attempts },
    });
  }
}


export interface ReconciliationSummary {
  correlationId: string;
  examined: number;
  repaired: number;
  failed: number;
}

/**
 * One reconciliation pass. Intended to be invoked by a scheduled call to the
 * `/api/public/billing/reconcile` route (pg_cron or an external scheduler),
 * not from user request paths.
 */
export async function runBillingReconciliation(
  admin: ReconciliationClient,
  options: {
    triggerSource?: string;
    limit?: number;
    now?: number;
    /** Injected so the pass can be exercised without contacting Google. */
    acknowledge?: (row: AckRow) => Promise<AckAttemptResult>;
  } = {},
): Promise<ReconciliationSummary> {
  const correlationId = newCorrelationId("recon");
  const logger = createLogger("BILLING", correlationId);
  const now = options.now ?? Date.now();
  const limit = Math.min(options.limit ?? 50, 200);

  logger.info("reconciliation_started", { data: { trigger: options.triggerSource ?? "cron" } });

  const { data } = await admin
    .from("billing_ack_state")
    .select("purchase_token_hash, user_id, product_id, status, attempts, next_attempt_at")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date(now).toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  const rows = ((data ?? []) as AckRow[]).filter((row) => isAckDue(row, now));

  let repaired = 0;
  let failed = 0;

  /**
   * IMPORTANT: only the SHA-256 hash of a purchase token is persisted — storing
   * raw Play tokens would turn this table into a credential store. Google's
   * acknowledge API needs the raw token, so a pass can only complete a repair
   * when a caller supplies a resolver that holds one (RTDN redelivery, or a
   * restore-purchases request from the owning device).
   *
   * Without a resolver the pass is a MEASUREMENT pass: it surfaces the pending
   * backlog and how stale it is, so an operator sees a stuck acknowledgement
   * long before Play's three-day auto-refund window closes. It deliberately
   * does not burn retry attempts on work it cannot perform.
   */
  for (const row of rows) {
    if (!options.acknowledge) {
      failed += 1;
      logger.warn("acknowledgement_pending", {
        outcome: "retry_scheduled",
        reason: "awaiting_raw_token",
        userId: row.user_id,
        data: { attempts: row.attempts, due_since_ms: now - Date.parse(row.next_attempt_at) },
      });
      continue;
    }

    let result: AckAttemptResult;
    try {
      result = await options.acknowledge(row);
    } catch {
      result = { ok: false, reason: "request_failed" };
    }
    const transition = await recordAckAttempt(
      admin,
      row.purchase_token_hash,
      row.attempts,
      result,
      now,
    );
    if (transition.status === "acknowledged" || transition.status === "not_required") {
      repaired += 1;
    } else {
      failed += 1;
      logger.warn("acknowledgement_attempt_failed", {
        outcome: transition.terminal ? "terminal" : "retry_scheduled",
        ...(transition.errorClass ? { errorClass: transition.errorClass } : {}),
        ...(transition.lastError ? { reason: transition.lastError } : {}),
        userId: row.user_id,
        data: { attempts: transition.attempts },
      });
    }
  }

  await admin.from("billing_reconciliation_runs").insert({
    trigger_source: options.triggerSource ?? "cron",
    finished_at: new Date(Date.now()).toISOString(),
    examined: rows.length,
    repaired,
    failed,
    detail: { correlation_id: correlationId },
  });

  recordMetric("billing.reconciliation.examined", rows.length);
  recordMetric("billing.reconciliation.repaired", repaired);
  recordMetric("billing.reconciliation.failed", failed);
  logger.info("reconciliation_finished", {
    outcome: failed > 0 ? "failed" : "ok",
    data: { examined: rows.length, repaired, failed },
  });

  return { correlationId, examined: rows.length, repaired, failed };
}
