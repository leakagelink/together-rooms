import { describe, expect, it } from "vitest";

import { isLightTheme } from "./theme";

describe("Liquid Sync theme", () => {
  it("uses the dark glass theme unless the user explicitly picks light", () => {
    expect(isLightTheme("system")).toBe(false);
    expect(isLightTheme("dark")).toBe(false);
    expect(isLightTheme(null)).toBe(false);
    expect(isLightTheme("light")).toBe(true);
  });
});
