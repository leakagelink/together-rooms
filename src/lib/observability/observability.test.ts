/**
 * PHASE 12 — observability, redaction and error-classification tests.
 *
 * OBS-T1..T10 cover the logging boundary; RELIABILITY-T1..T5 cover the error
 * model.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  childCorrelationId,
  correlationFromHeaders,
  newCorrelationId,
  sanitizeCorrelationId,
} from "./correlation";
import { classifyHttpStatus, classifyReason, classifyThrown, isRetryableClass } from "./errors";
import { buildRecord, log, setLogSink, type LogRecord } from "./logger";
import { isDeniedKey, looksSensitive, pseudonymize, redact, REDACTED } from "./redaction";

const captured: LogRecord[] = [];

beforeEach(() => {
  captured.length = 0;
  setLogSink((record) => captured.push(record));
});

describe("OBS — structured logging boundary", () => {
  it("OBS-T1: every line carries timestamp, level, category and event", () => {
    const record = log({ category: "ROOM", event: "member_joined" });
    expect(record.category).toBe("ROOM");
    expect(record.event).toBe("member_joined");
    expect(record.level).toBe("info");
    expect(() => new Date(record.ts).toISOString()).not.toThrow();
    expect(captured).toHaveLength(1);
  });

  it("OBS-T2: user and room identifiers are pseudonymised, never raw", () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    const record = log({ category: "CHAT", event: "message_sent", userId, roomId: userId });
    expect(record.user_ref).toBeDefined();
    expect(JSON.stringify(record)).not.toContain(userId);
    // stable across calls so operators can still correlate
    expect(record.user_ref).toBe(pseudonymize(userId));
  });

  it("OBS-T3: user content fields are dropped by key name", () => {
    const record = buildRecord({
      category: "CHAT",
      event: "message_sent",
      data: { content: "meet me at 5", title: "secret plan", message_count: 3 },
    });
    expect(record.data?.["content"]).toBe(REDACTED);
    expect(record.data?.["title"]).toBe(REDACTED);
    expect(record.data?.["message_count"]).toBe(3);
  });

  it("OBS-T4: credential-shaped values are dropped even under innocent keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart";
    const record = buildRecord({
      category: "BILLING",
      event: "verified",
      data: { note_for_ops: jwt, key: "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345" },
    });
    expect(JSON.stringify(record)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(record.data?.["key"]).toBe(REDACTED);
  });

  it("OBS-T5: purchase tokens and long opaque blobs never reach a log line", () => {
    const purchaseToken = "a".repeat(80);
    expect(looksSensitive(purchaseToken)).toBe(true);
    const record = buildRecord({
      category: "BILLING",
      event: "ack",
      data: { purchase_token: purchaseToken, value: purchaseToken },
    });
    expect(JSON.stringify(record)).not.toContain(purchaseToken);
  });

  it("OBS-T6: deny list covers tokens, secrets, emails and free text", () => {
    for (const key of ["access_token", "apiKey", "password", "email", "bio", "url", "notes"]) {
      expect(isDeniedKey(key)).toBe(true);
    }
    // deliberately allowed: hashes and enums are safe operational values
    for (const key of ["token_hash", "purchase_token_hash", "content_type", "attempts"]) {
      expect(isDeniedKey(key)).toBe(false);
    }
  });

  it("OBS-T7: nested payloads are redacted and bounded in depth and size", () => {
    const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
    const record = buildRecord({ category: "SYSTEM", event: "x", data: deep });
    expect(JSON.stringify(record)).not.toContain("too deep");

    const long = buildRecord({
      category: "SYSTEM",
      event: "x",
      data: { safe_label: "y".repeat(500) },
    });
    expect((long.data?.["safe_label"] as string).length).toBeLessThan(140);
  });

  it("OBS-T8: functions and class instances are never serialised", () => {
    const record = buildRecord({
      category: "SYSTEM",
      event: "x",
      data: { fn: () => "secret", when: new Date(0) },
    });
    expect(record.data?.["fn"]).toBe("[unsupported]");
  });

  it("OBS-T9: correlation ids are opaque, safe and sanitised on input", () => {
    const id = newCorrelationId("rtdn");
    expect(id).toMatch(/^rtdn_[0-9a-f]{24}$/);

    // hostile inbound values are replaced, not echoed
    const hostile = sanitizeCorrelationId("../../etc/passwd\n injected line");
    expect(hostile).not.toContain("passwd");

    const headers = new Headers({ "x-correlation-id": "abc123def456" });
    expect(correlationFromHeaders(headers)).toBe("abc123def456");
    expect(childCorrelationId("cid_1234abcd", "verify")).toBe("cid_1234abcd.verify");
  });

  it("OBS-T10: the sink is swappable so logs are never coupled to a vendor", () => {
    const other: LogRecord[] = [];
    setLogSink((record) => other.push(record));
    log({ category: "AUTH", event: "sign_in", outcome: "ok" });
    expect(other).toHaveLength(1);
    expect(captured).toHaveLength(0);
  });
});

describe("RELIABILITY — error classification", () => {
  it("RELIABILITY-T1: HTTP statuses map to the right retry semantics", () => {
    expect(classifyHttpStatus(503)).toBe("RETRYABLE");
    expect(classifyHttpStatus(429)).toBe("RATE_LIMIT");
    expect(classifyHttpStatus(403)).toBe("SECURITY");
    expect(classifyHttpStatus(404)).toBe("NON_RETRYABLE");
    expect(classifyHttpStatus(422)).toBe("VALIDATION");
  });

  it("RELIABILITY-T2: security failures are never retryable", () => {
    for (const reason of ["bad_signature", "bad_issuer", "bad_audience", "expired"]) {
      const info = classifyReason(reason);
      expect(info.errorClass).toBe("SECURITY");
      expect(info.retryable).toBe(false);
    }
    expect(isRetryableClass("SECURITY")).toBe(false);
  });

  it("RELIABILITY-T3: transient infrastructure failures are retryable", () => {
    expect(classifyReason("verification_unavailable").retryable).toBe(true);
    expect(classifyReason("jwks_unavailable").retryable).toBe(true);
    expect(classifyThrown({ name: "AbortError" }).retryable).toBe(true);
  });

  it("RELIABILITY-T4: terminal provider answers are not retried forever", () => {
    expect(classifyReason("purchase_not_found").retryable).toBe(false);
    expect(classifyReason("product_mismatch").retryable).toBe(false);
  });

  it("RELIABILITY-T5: client messages never leak provider or stack detail", () => {
    const info = classifyThrown(new Error("PostgREST: permission denied for table entitlements"));
    expect(info.errorClass).toBe("SECURITY");
    expect(info.clientMessage).not.toContain("entitlements");
    expect(info.clientMessage).not.toContain("PostgREST");
  });
});

describe("redaction primitives", () => {
  it("pseudonymisation is stable, short and not the input", () => {
    const value = "user-abc";
    expect(pseudonymize(value)).toBe(pseudonymize(value));
    expect(pseudonymize(value)).toHaveLength(12);
    expect(pseudonymize(value)).not.toContain(value);
  });

  it("arrays are truncated rather than dumped whole", () => {
    const out = redact({ items: Array.from({ length: 50 }, (_, i) => i) });
    expect((out["items"] as number[]).length).toBeLessThanOrEqual(10);
  });
});
