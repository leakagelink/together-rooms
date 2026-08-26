# Billing Acknowledgement Recovery (Phase 12.1)

## 1. Problem identified

A verified Google Play purchase could remain permanently unacknowledged.
The entitlement was granted correctly, but if the acknowledge call to Play
failed and the process ended, no automatic path existed to complete it.
Play auto-refunds an unacknowledged purchase after **three days**.

## 2. Root cause

`billing_ack_state` stored only the SHA-256 **hash** of the purchase token.
Google's acknowledge endpoint requires the **raw** token, and the Play
Developer API provides no way to enumerate unacknowledged purchases or to
resolve a token from a hash. Recovery therefore required the raw token to be
resubmitted by the device — which never happens if the user closes, logs out
of, or uninstalls the app.

## 3. Chosen architecture

**Option A — encrypted recoverable token, minimum retention.**

- SHA-256 hash: primary key, idempotency, dedupe, audit correlation (kept).
- AES-256-GCM envelope of the raw token: used **only** for acknowledgement
  retry / reconciliation, deleted as soon as it is no longer needed.

## 4. Why this was selected

Provider-authoritative recovery was investigated first and is **not possible**:

- `purchases.subscriptionsv2.get` requires the token.
- `purchases.subscriptions.acknowledge` requires the token.
- `purchases.voidedpurchases.list` returns tokens, but only for *voided*
  purchases — the opposite of what recovery needs.
- RTDN carries a token, but only when Google happens to send a notification;
  it cannot be relied upon as the sole recovery path.

There is no "list unacknowledged purchases" API. Without a recoverable token,
unattended recovery is impossible.

## 5–7. Lifecycles

| Data | Written | Used for | Deleted |
|---|---|---|---|
| Raw token | never persisted | in-memory Play calls only | end of request |
| Token hash | on ack intent | identity, idempotency, dedupe, audit | retained |
| Encrypted envelope | on ack intent | ack retry / reconciliation only | on settle, or after 7 days |

Retention window: **7 days** (`RECOVERY_RETENTION_MS`) — Play's 3-day refund
window plus operator margin. `purge_expired_ack_recovery()` runs on every
reconciliation pass and clears envelopes that are settled or expired.

## 8. Encryption and key management — stated honestly

- Algorithm: **AES-256-GCM** via WebCrypto (authenticated, random 96-bit IV
  per token, explicit key version in the envelope).
- Envelope: `v1.<keyVersion>.<b64url(iv)>.<b64url(ciphertext||tag)>`.
- Key: derived (SHA-256) from the server-side environment secret
  `BILLING_TOKEN_RECOVERY_KEY_V1`.

**Classification: BEST AVAILABLE ON THIS PLATFORM — not hardware-backed.**
There is no KMS, HSM, or managed key service in this deployment. The security
property actually obtained is *key/ciphertext separation*: ciphertext lives in
Postgres, the key lives only in the server runtime environment. A database
compromise alone does not reveal tokens. A full server-runtime compromise
does. A production-grade external KMS would be required to improve on this.

## 9. Guaranteed / not guaranteed

Guaranteed: durable recovery state survives process restart; recovery runs
unattended; no plaintext token at rest; settled rows are never re-acknowledged;
terminal failures are visible; entitlements are never revoked by ack failure.

Not guaranteed: recovery against real Google endpoints has **not** been
executed against production Play (no live purchase testing was performed);
recovery is impossible if the envelope is purged or the key is lost.

## 10. Acknowledgement state machine

```text
VERIFIED → pending → ack_in_progress ─┬→ acknowledged        (settled, recovery purged)
                                      ├→ not_required        (settled, recovery purged)
                                      ├→ pending (backoff)   (retryable failure)
                                      ├→ recovery_required   (no recovery material)
                                      └→ failed_terminal     (non-retryable / exhausted)
```

Transitions go through `complete_billing_ack`, which refuses to overwrite a
settled row and requires the caller to hold the row's lease.

## 11. Retry model

6 attempts, exponential backoff from 1 minute capped at 6 hours; the full
schedule completes inside Play's 3-day window. Failure classes come from
`src/lib/observability/errors.ts`: retryable → bounded retry, non-retryable →
terminal, unknown → conservative terminal with operator visibility.

## 12. Worker / reconciliation flow

`POST /api/public/billing/reconcile` (shared-secret authenticated; disabled
when unset) → `claim_billing_ack_work` claims due rows under
`FOR UPDATE SKIP LOCKED` with a 120s lease → envelope decrypted server-side →
purchase re-verified with Play → acknowledged → `complete_billing_ack` →
`purge_expired_ack_recovery`. A crashed worker's lease simply expires and the
row is reclaimed later; no state is lost.

## 13. RTDN interaction

RTDN remains a trigger, never the entitlement source. When a notification's
fresh verification shows the purchase is still unacknowledged, the RTDN path
acknowledges it and refreshes the recovery envelope. It cannot duplicate work:
a settled row is not modified.

## 14. Terminal failure and operator recovery

`failed_terminal` / `recovery_required` rows are logged with an explicit
outcome and metric (`billing.ack.terminal_failure`,
`billing.ack.recovery_required`), and are queryable by status. Operator
procedure: re-trigger `/api/public/billing/reconcile` (safe, idempotent); if a
row is `recovery_required`, the token is unrecoverable and the purchase must be
handled through Play Console support. Direct database editing is
**emergency-only** and not part of the normal procedure.

## 15. Key rotation

Bump `CURRENT_KEY_VERSION` and add `BILLING_TOKEN_RECOVERY_KEY_V<n>`, keeping
the previous secret configured until all envelopes older than the retention
window have expired. Old envelopes keep decrypting under their recorded
version; new ones are sealed with the new key.

## 16. Backup and security boundaries

Database backups contain ciphertext only; they are not sufficient to recover
tokens without the runtime secret. No raw token appears in logs, errors,
audit rows, analytics, realtime payloads, or client responses; ciphertext is
never exposed to clients (no anon/authenticated grants, RLS denies all, and
the three recovery routines are granted to `service_role` only).
