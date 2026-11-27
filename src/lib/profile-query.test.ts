import { describe, expect, it } from "vitest";

import { greetingName, initialsFor } from "./profile-query";

describe("profile display helpers", () => {
  it("builds avatar initials from up to two words", () => {
    expect(initialsFor("Aadi Sharma Kumar")).toBe("AS");
    expect(initialsFor("riya")).toBe("R");
    expect(initialsFor("")).toBe("?");
  });

  it("greets by first name, then email name", () => {
    expect(greetingName("Aadi Sharma", "x@y.com")).toBe("Aadi");
    expect(greetingName(null, "dheeraj@example.com")).toBe("dheeraj");
    expect(greetingName("  ", null)).toBeNull();
  });
});
