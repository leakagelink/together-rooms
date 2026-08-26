/**
 * PHASE 13 — billing reconciliation scheduler configuration.
 *
 * The acknowledgement recovery worker only runs if something calls
 * POST /api/public/billing/reconcile. That "something" is external (a cron
 * service), so the only thing this project can own is the *specification* of a
 * valid scheduler configuration — and the guarantee that an incomplete or
 * unsafe configuration fails CLOSED (endpoint disabled / audit fails) instead
 * of silently never running.
 *
 * Pure and side-effect free: callers pass the values they read.
 */

export type SchedulerProblem =
  | "missing_secret"
  | "weak_secret"
  | "missing_endpoint"
  | "insecure_endpoint"
  | "secret_in_url"
  | "missing_interval"
  | "interval_too_long"
  | "interval_too_short";

export interface SchedulerConfigInput {
  /** Shared secret sent in the `x-reconcile-secret` header. */
  secret?: string | undefined;
  /** Absolute https URL the scheduler posts to. */
  endpointUrl?: string | undefined;
  /** How often the scheduler fires. */
  intervalMinutes?: number | undefined;
}

export interface SchedulerConfigResult {
  ok: boolean;
  /** True when the endpoint will actually accept scheduler calls. */
  enabled: boolean;
  problems: SchedulerProblem[];
}

/** Minimum entropy we accept for the shared secret (hex/base64 of >=16 bytes). */
export const MIN_RECONCILE_SECRET_LENGTH = 32;

/**
 * Play auto-refunds unacknowledged purchases after ~3 days; the retry ladder
 * caps at 6h, so a scheduler slower than 6h would starve the retry schedule.
 */
export const MAX_RECONCILE_INTERVAL_MINUTES = 360;
/** Below this the worker mostly claims nothing and burns quota. */
export const MIN_RECONCILE_INTERVAL_MINUTES = 5;

export function validateSchedulerConfig(input: SchedulerConfigInput): SchedulerConfigResult {
  const problems: SchedulerProblem[] = [];
  const secret = input.secret?.trim();
  const endpoint = input.endpointUrl?.trim();

  if (!secret) problems.push("missing_secret");
  else if (secret.length < MIN_RECONCILE_SECRET_LENGTH) problems.push("weak_secret");

  if (!endpoint) {
    problems.push("missing_endpoint");
  } else {
    let url: URL | null = null;
    try {
      url = new URL(endpoint);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== "https:") {
      problems.push("insecure_endpoint");
    } else if (url.search.length > 0 || (secret ? url.href.includes(secret) : false)) {
      // The secret is a header value. Putting it in a query string leaks it to
      // logs, proxies and referrers.
      problems.push("secret_in_url");
    }
  }

  const interval = input.intervalMinutes;
  if (interval === undefined || interval === null || !Number.isFinite(interval)) {
    problems.push("missing_interval");
  } else if (interval > MAX_RECONCILE_INTERVAL_MINUTES) {
    problems.push("interval_too_long");
  } else if (interval < MIN_RECONCILE_INTERVAL_MINUTES) {
    problems.push("interval_too_short");
  }

  return {
    ok: problems.length === 0,
    // The route itself 404s without a secret: no secret ⇒ not reachable at all.
    enabled: Boolean(secret) && problems.length === 0,
    problems,
  };
}

export function describeSchedulerProblem(problem: SchedulerProblem): string {
  switch (problem) {
    case "missing_secret":
      return "BILLING_RECONCILE_SECRET is not set — the reconcile endpoint stays disabled (404) and acknowledgement recovery will never run.";
    case "weak_secret":
      return `BILLING_RECONCILE_SECRET must be at least ${MIN_RECONCILE_SECRET_LENGTH} characters of random material.`;
    case "missing_endpoint":
      return "No scheduler endpoint URL configured.";
    case "insecure_endpoint":
      return "The scheduler endpoint must be an absolute https URL.";
    case "secret_in_url":
      return "The shared secret must be sent as the x-reconcile-secret header, never in the URL.";
    case "missing_interval":
      return "No scheduler interval configured.";
    case "interval_too_long":
      return `The scheduler must run at least every ${MAX_RECONCILE_INTERVAL_MINUTES} minutes to keep inside Play's acknowledgement window.`;
    case "interval_too_short":
      return `Running more often than every ${MIN_RECONCILE_INTERVAL_MINUTES} minutes provides no benefit.`;
  }
}

/** Recommended production values, documented in docs/OPERATIONS.md. */
export const RECOMMENDED_RECONCILE_INTERVAL_MINUTES = 15;
