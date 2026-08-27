import { describe, expect, it } from "vitest";

import { clampResumePoint, describeResume, isTransferComplete, planResume } from "./resume";

describe("local media resume planning", () => {
  it("starts at the beginning when nothing has arrived", () => {
    expect(planResume([], 3)).toEqual({ index: 0, offset: 0 });
  });

  it("resumes the first incomplete item at its byte offset", () => {
    const plan = planResume(
      [
        { index: 0, received: 100, complete: true },
        { index: 1, received: 4096, complete: false },
      ],
      3,
    );
    expect(plan).toEqual({ index: 1, offset: 4096 });
  });

  it("skips completed items and requests the next missing one", () => {
    const plan = planResume(
      [
        { index: 0, received: 10, complete: true },
        { index: 1, received: 10, complete: true },
      ],
      3,
    );
    expect(plan).toEqual({ index: 2, offset: 0 });
  });

  it("detects a fully delivered transfer", () => {
    const items = [
      { index: 0, received: 10, complete: true },
      { index: 1, received: 10, complete: true },
    ];
    expect(isTransferComplete(items, 2)).toBe(true);
    expect(isTransferComplete(items, 3)).toBe(false);
    expect(isTransferComplete([], 0)).toBe(false);
  });

  it("clamps a hostile or stale resume point on the sharer side", () => {
    expect(clampResumePoint({ index: 99, offset: 1e9 }, 2, 500)).toEqual({ index: 1, offset: 500 });
    expect(clampResumePoint({ index: -5, offset: -20 }, 2, 500)).toEqual({ index: 0, offset: 0 });
    expect(clampResumePoint({ index: NaN, offset: NaN }, 2, 500)).toEqual({ index: 0, offset: 0 });
  });

  it("describes the resume point for the log", () => {
    expect(describeResume({ index: 1, offset: 0 }, 100)).toContain("from the beginning");
    expect(describeResume({ index: 0, offset: 50 }, 100)).toContain("50%");
  });
});
