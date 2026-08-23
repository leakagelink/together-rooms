import { describe, expect, it } from "vitest";

import { classifyMediaError, deviceFailureMessage } from "./capability";

describe("call device capability", () => {
  it("CALL-D1 maps a blocked permission to a recoverable failure", () => {
    expect(classifyMediaError({ name: "NotAllowedError" })).toBe("permission_denied");
    expect(deviceFailureMessage("permission_denied")).toMatch(/site settings/i);
  });

  it("CALL-D2 distinguishes missing hardware from busy hardware", () => {
    expect(classifyMediaError({ name: "NotFoundError" })).toBe("not_found");
    expect(classifyMediaError({ name: "NotReadableError" })).toBe("in_use");
    expect(deviceFailureMessage("not_found")).toMatch(/listen-only/i);
  });

  it("CALL-D3 falls back to a generic failure for unknown errors", () => {
    expect(classifyMediaError(new Error("boom"))).toBe("unknown");
    expect(classifyMediaError(null)).toBe("unknown");
  });

  it("CALL-D4 explains unsupported and insecure contexts without blaming the user", () => {
    expect(deviceFailureMessage("unsupported")).toMatch(/browser/i);
    expect(deviceFailureMessage("insecure_context")).toMatch(/secure/i);
  });
});
