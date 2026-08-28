import { describe, expect, it } from "vitest";

import { createDiagnostics, formatDiagEvent, MAX_DIAG_EVENTS, shortPeer } from "./diagnostics";

describe("local media diagnostics", () => {
  it("records events newest-first and caps the buffer", () => {
    const diag = createDiagnostics();
    for (let index = 0; index < MAX_DIAG_EVENTS + 10; index += 1) {
      diag.log("info", `event ${index}`);
    }
    const { events } = diag.snapshot();
    expect(events).toHaveLength(MAX_DIAG_EVENTS);
    expect(events[0]!.message).toBe(`event ${MAX_DIAG_EVENTS + 9}`);
  });

  it("tracks per-peer negotiation and chunk counters", () => {
    const diag = createDiagnostics();
    diag.peer("peer-1", "viewer", { offersReceived: 1 });
    diag.peer("peer-1", "viewer", { answered: true, connectionState: "connected" });
    diag.bumpChunk("peer-1", "viewer", 100);
    diag.bumpChunk("peer-1", "viewer", 50);
    const peer = diag.snapshot().peers[0]!;
    expect(peer).toMatchObject({
      peerId: "peer-1",
      offersReceived: 1,
      answered: true,
      connectionState: "connected",
      chunks: 2,
      bytes: 150,
    });
  });

  it("keeps peers separate and drops them on leave", () => {
    const diag = createDiagnostics();
    diag.bumpChunk("a", "viewer", 10);
    diag.bumpChunk("b", "viewer", 20);
    expect(diag.snapshot().peers.map((p) => p.peerId)).toEqual(["a", "b"]);
    diag.drop("a");
    expect(diag.snapshot().peers.map((p) => p.peerId)).toEqual(["b"]);
  });

  it("stores a reconnect reason", () => {
    const diag = createDiagnostics();
    diag.peer("a", "sharer", { lastReason: "No answer after 6 offers" });
    expect(diag.snapshot().peers[0]!.lastReason).toBe("No answer after 6 offers");
  });

  it("bumps version on every mutation and resets on clear", () => {
    const diag = createDiagnostics();
    const start = diag.version();
    diag.log("warn", "x");
    diag.peer("a", "viewer", {});
    expect(diag.version()).toBe(start + 2);
    diag.clear();
    expect(diag.snapshot()).toEqual({ events: [], peers: [] });
  });

  it("formats events with a truncated peer id", () => {
    const diag = createDiagnostics(() => 0);
    diag.log("error", "Peer connection: failed", "0123456789abcdef");
    const line = formatDiagEvent(diag.snapshot().events[0]!);
    expect(line).toContain("01234567…");
    expect(line).toContain("Peer connection: failed");
    expect(shortPeer(null)).toBe("connection");
  });
});
