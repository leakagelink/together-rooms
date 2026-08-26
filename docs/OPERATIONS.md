# SyncTogether — Operations & Reliability (Phase 12)

Operational runbook for the production backend: what is logged, how failures
are classified and retried, how billing self-heals, and what to check when
something looks wrong.

## 1. Health probes

`GET /api/public/health`

| Probe | Query | Meaning | Failure mode |
| --- | --- | --- | --- |
| Liveness | `?probe=live` (default) | The worker can serve requests. Touches no dependency, so a slow database cannot cause a restart loop. | Always 200 while the process is up |
| Readiness | `?probe=ready` | One cheap read against static configuration data plus presence checks for required config groups. | 503 with `status: "degraded"` |

The response contains booleans and a duration only — no versions, hostnames,
counts, connection details or error text. An unauthenticated caller learns
nothing exploitable.

## 2. Structured logging

All operational logging goes through `src/lib/observability/logger.ts`. Every
line is one JSON object:

```json
{"ts":"…","level":"warn","category":"BILLING","event":"acknowledgement_failed",
 "outcome":"retry_scheduled","correlation_id":"rtdn_…","user_ref":"a1b2c3d4e5f6",
 "error_class":"RETRYABLE","reason":"request_failed","data":{"attempts":2}}
```

Categories: `AUTH ROOM PLAYBACK CHAT MODERATION MEDIA CALL BILLING RTDN ADS
CONSENT SECURITY SYSTEM`.

### What is never logged

Enforced centrally in `redaction.ts`, not left to call sites:

- chat, note, task, research and resource content; titles, descriptions, URLs
- access/refresh tokens, purchase tokens, service-account keys, API keys, JWTs,
  PEM blocks, cookies, session material
- email addresses, usernames, display names, avatars, phone numbers
- media bytes, call audio/video, WebRTC payloads

User and room identifiers are **pseudonymised** to a short stable digest, so
lines can be correlated without the log becoming a membership database. This is
a privacy measure for logs, not an authentication mechanism.

Three layers apply: a key deny list, value scanning (a credential-shaped value
is dropped even under an innocent key), and hard depth/size/array bounds.

### Correlation

`correlation.ts` mints opaque ids and accepts an inbound
`x-correlation-id` / `x-request-id` / `ce-id` only when it is plainly
formatted. One id follows an RTDN delivery through OIDC verification, dedupe,
Play verification, `apply_billing_event` and acknowledgement.

### Monitoring vendor

None is integrated. `monitor.ts` defines the adapter contract
(`captureError` / `recordMetric` / `recordTiming`) and applies the same
redaction, so a crash reporter can be plugged in later without touching call
sites and without a vendor SDK in the bundle today.

## 3. Error classification

`src/lib/observability/errors.ts` places every failure in exactly one class,
which decides retry behaviour, log severity, and what the user is told.

| Class | Retried | Typical cause |
| --- | --- | --- |
| `RETRYABLE` | yes | provider 5xx, credentials temporarily unavailable |
| `TRANSIENT` | yes | timeout, connection reset |
| `RATE_LIMIT` | yes, after the window | 429, our own rate limiter |
| `PROVIDER` | no | provider answered with something unusable |
| `VALIDATION` | no | bad input; retrying unchanged cannot help |
| `SECURITY` | **never** | bad signature, wrong issuer/audience, forbidden |
| `NON_RETRYABLE` | no | 404/410, product mismatch |
| `UNKNOWN` | no | unclassified; logged as an error |

Client-facing messages are fixed strings per class. Provider text and stack
traces never cross the boundary.

## 4. Billing reliability

### Acknowledgement recovery

Play auto-refunds an unacknowledged purchase after ~3 days.

1. Verification succeeds → entitlement granted through `apply_billing_event`.
2. **Before** calling Google, an intent row is written to
   `billing_ack_state` (`pending`). A crash between granting and
   acknowledging therefore leaves a durable, visible record.
3. The acknowledge attempt is recorded: success → `acknowledged` (terminal,
   idempotent); retryable failure → `pending` with exponential backoff
   (1 min → 6 h cap, max 6 attempts, well inside the refund window);
   non-retryable or exhausted → `failed_terminal`.

**A failed acknowledgement never revokes, blocks or downgrades an entitlement.**

Only the SHA-256 hash of a purchase token is stored — never the raw token, which
would make the table a credential store. Google's acknowledge API needs the raw
token, so a repair can only be completed from a path that holds one (RTDN
redelivery, or a restore-purchases request from the owning device).

### Reconciliation pass

`POST /api/public/billing/reconcile`, authenticated with the
`BILLING_RECONCILE_SECRET` header compared in constant time. Without the secret
configured the route returns 404 — it is disabled, not open.

Each pass writes a row to `billing_reconciliation_runs`
(`examined / repaired / failed / correlation_id`). Without a token resolver the
pass is a **measurement** pass: it reports the pending backlog and its staleness
so a stuck acknowledgement surfaces long before the refund window closes, and
deliberately burns no retry attempts on work it cannot perform.

Idempotency: `apply_billing_event` is monotonic on `event_seq`, so replaying an
older state is a no-op rather than a downgrade. Reconciliation is safe to run
concurrently with live RTDN traffic, and safe to double-trigger.

### RTDN recovery

- Pub/Sub is at-least-once: the message id is claimed in `play_rtdn_messages`
  before any work; redelivery short-circuits as `duplicate`.
- A notification is a trigger, never a source of truth — the Play Developer API
  is re-queried and its answer is what is applied.
- Revocation requires confirmation from Google's voided-purchases list.
- Unknown purchase tokens are recorded and dropped; an owner is never guessed.
- 2xx acknowledges (including permanently unprocessable messages, so no backlog
  builds); 5xx asks for redelivery.

## 5. Indexes added for these paths

| Index | Backs |
| --- | --- |
| `idx_sub_events_token_time` | resolving the owning account for a purchase token (newest event first) |
| `idx_billing_ack_due` | partial index over acknowledgements actually due |
| `idx_rtdn_outcome_time` | operational listing of notifications that failed |

## 6. Backend-only tables

`billing_ack_state` and `billing_reconciliation_runs` are written only by
trusted server code. They carry `service_role` grants only, RLS is enabled, and
no policies exist — so every client role is denied by default. This is
intentional and is what the "RLS enabled, no policy" linter note refers to.

## 7. What to check first

| Symptom | Look at |
| --- | --- |
| Users report a purchase that "didn't apply" | `subscription_events` for the account (`verification_failed` rows carry a reason), then `billing_ack_state` |
| Unexpected refunds | `billing_ack_state` rows in `pending` or `failed_terminal` older than a day |
| Notifications not arriving | `play_rtdn_messages` via `idx_rtdn_outcome_time`; repeated 401s mean the OIDC audience or service-account email drifted |
| Endpoint returning 503 | `?probe=ready` — check whether `database` or a config group is false |
