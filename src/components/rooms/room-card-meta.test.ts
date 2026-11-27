import { describe, expect, it } from "vitest";

import { roomStatusView } from "./room-card-meta";

describe("room card status", () => {
  it("shows active rooms as Live and keeps other real statuses", () => {
    expect(roomStatusView("active")).toEqual({ label: "Live", tone: "live" });
    expect(roomStatusView("paused").label).toBe("Paused");
    expect(roomStatusView("ended").label).toBe("Ended");
  });
});
