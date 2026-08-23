import { describe, expect, it } from "vitest";

import {
  chunkRange,
  flowDecision,
  peakMemoryBytes,
  planChunks,
  withinSessionLimit,
} from "./chunking";
import { BUFFERED_HIGH_WATER, BUFFERED_LOW_WATER, CHUNK_BYTES, MAX_SESSION_BYTES } from "./limits";

describe("local media chunk planning", () => {
  it("splits a file into bounded chunks without reading it", () => {
    const plan = planChunks(CHUNK_BYTES * 3 + 5);
    expect(plan.chunkCount).toBe(4);
    expect(chunkRange(plan, 0)).toEqual({ index: 0, start: 0, end: CHUNK_BYTES });
    expect(chunkRange(plan, 3)?.end).toBe(plan.totalBytes);
    expect(chunkRange(plan, 4)).toBeNull();
  });

  it("never allows a chunk larger than the transport limit", () => {
    expect(() => planChunks(1000, CHUNK_BYTES + 1)).toThrow();
    expect(() => planChunks(-1)).toThrow();
  });

  it("bounds peak sender memory regardless of file size", () => {
    const small = peakMemoryBytes(planChunks(1024));
    const huge = peakMemoryBytes(planChunks(MAX_SESSION_BYTES));
    expect(small).toBe(huge);
    expect(huge).toBe(CHUNK_BYTES + BUFFERED_HIGH_WATER);
  });

  it("enforces the session size ceiling", () => {
    expect(withinSessionLimit(MAX_SESSION_BYTES)).toBe(true);
    expect(withinSessionLimit(MAX_SESSION_BYTES + 1)).toBe(false);
  });

  it("applies hysteresis backpressure", () => {
    expect(flowDecision(0, false)).toBe("send");
    expect(flowDecision(BUFFERED_HIGH_WATER, false)).toBe("wait");
    // Once waiting, we only resume below the low-water mark.
    expect(flowDecision(BUFFERED_HIGH_WATER - 1, true)).toBe("wait");
    expect(flowDecision(BUFFERED_LOW_WATER, true)).toBe("send");
  });
});
