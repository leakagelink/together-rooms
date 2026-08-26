/**
 * PHASE 12 — acknowledgement retry policy (pure logic, no I/O).
 *
 * Play auto-refunds an unacknowledged purchase after three days, so a failed
 * acknowledgement is a real revenue and support problem — but it must never
 * take the entitlement away from a user who paid. The model is therefore:
 *
 *   grant entitlement  →  record ack as PENDING  →  attempt  →
 *     success            → ACKNOWLEDGED (idempotent, never repeated)
 *     retryable failure  → PENDING with bounded backoff
 *     terminal failure   → FAILED_TERMINAL, operationally visible, no more attempts
 *
 * The entitlement is never touched by any of these transitions.
 */
import { classifyReason, type ErrorClass } from "@/lib/observability/errors";

export type AckStatus = "pending" | "acknowledged" | "not_required" | "failed_terminal";

/**
 * Bounded retries. Backoff is exponential from one minute and capped, so the
 * whole schedule (6 attempts) completes inside Play's three-day refund window
 * with room to spare, and a permanently broken configuration stops retrying
 * instead of hammering Google forever.
 */
export const MAX_ACK_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

export function ackBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

export interface AckStateRow {
  status: AckStatus;
  attempts: number;
  next_attempt_at: string;
}

export interface AckTransition {
  status: AckStatus;
  attempts: number;
  nextAttemptAt: string | null;
  acknowledgedAt: string | null;
  lastError: string | null;
  errorClass: ErrorClass | null;
  /** True when the row now needs a human: bounded retries are exhausted. */
  terminal: boolean;
}

export type AckAttemptResult = { ok: true; performed: boolean } | { ok: false; reason: string };

/**
 * Decides the next persisted state after one acknowledgement attempt.
 * Idempotent by construction: a success always lands on the same terminal
 * ACKNOWLEDGED state regardless of how many times it is applied.
 */
export function nextAckState(
  previous: Pick<AckStateRow, "attempts">,
  result: AckAttemptResult,
  now: number,
): AckTransition {
  const attempts = previous.attempts + 1;

  if (result.ok) {
    return {
      status: "acknowledged",
      attempts,
      nextAttemptAt: null,
      acknowledgedAt: new Date(now).toISOString(),
      lastError: null,
      errorClass: null,
      terminal: false,
    };
  }

  if (result.reason === "not_acknowledgeable") {
    // Pending or already-acknowledged purchases are simply out of scope.
    return {
      status: "not_required",
      attempts,
      nextAttemptAt: null,
      acknowledgedAt: null,
      lastError: result.reason,
      errorClass: "NON_RETRYABLE",
      terminal: false,
    };
  }

  const info = classifyReason(result.reason);
  const exhausted = attempts >= MAX_ACK_ATTEMPTS;

  if (!info.retryable || exhausted) {
    return {
      status: "failed_terminal",
      attempts,
      nextAttemptAt: null,
      acknowledgedAt: null,
      lastError: result.reason,
      errorClass: info.errorClass,
      terminal: true,
    };
  }

  return {
    status: "pending",
    attempts,
    nextAttemptAt: new Date(now + ackBackoffMs(attempts)).toISOString(),
    acknowledgedAt: null,
    lastError: result.reason,
    errorClass: info.errorClass,
    terminal: false,
  };
}

/** A row is due when it is still pending and its backoff has elapsed. */
export function isAckDue(row: AckStateRow, now: number): boolean {
  if (row.status !== "pending") return false;
  if (row.attempts >= MAX_ACK_ATTEMPTS) return false;
  return Date.parse(row.next_attempt_at) <= now;
}
