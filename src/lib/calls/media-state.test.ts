import { describe, expect, it } from "vitest";

import {
  canEndCall,
  canStartCall,
  cameraAllowed,
  connectionLabel,
  gridColumns,
  isLiveSession,
  lifecycleAction,
  remainingSeats,
  shouldInitiateOffer,
  type CallSession,
} from "./media-state";
import { participantCap } from "./limits";

const base: CallSession = {
  id: "s1",
  room_id: "r1",
  started_by: "host",
  call_mode: "voice",
  session_status: "active",
  allow_relay: true,
  max_participants: 8,
  version: 3,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  created_at: new Date().toISOString(),
};

describe("call state rules", () => {
  it("CALL-U1 treats an expired or ended session as not live", () => {
    expect(isLiveSession(base)).toBe(true);
    expect(isLiveSession({ ...base, session_status: "ended" })).toBe(false);
    expect(isLiveSession({ ...base, expires_at: new Date(Date.now() - 1).toISOString() })).toBe(
      false,
    );
    expect(isLiveSession(null)).toBe(false);
  });

  it("CALL-U2 lets only the starter or a moderator end the call", () => {
    expect(canEndCall(base, "host", false)).toBe(true);
    expect(canEndCall(base, "member", false)).toBe(false);
    expect(canEndCall(base, "member", true)).toBe(true);
    expect(canEndCall(base, undefined, true)).toBe(false);
  });

  it("CALL-U3 mirrors the control mode for starting a call", () => {
    expect(canStartCall("host_only", false)).toBe(false);
    expect(canStartCall("host_only", true)).toBe(true);
    expect(canStartCall("collaborative", false)).toBe(true);
  });

  it("CALL-U4 never requests a camera in a voice call", () => {
    expect(cameraAllowed("voice")).toBe(false);
    expect(cameraAllowed("video")).toBe(true);
  });

  it("CALL-U5 reports remaining seats without going negative", () => {
    expect(remainingSeats(base, 3)).toBe(5);
    expect(remainingSeats(base, 12)).toBe(0);
    expect(remainingSeats(null, 0)).toBe(0);
  });

  it("CALL-U6 keeps mesh caps conservative and mode-specific", () => {
    expect(participantCap("video")).toBeLessThan(participantCap("voice"));
    expect(participantCap("video")).toBe(4);
  });

  it("CALL-U7 chooses one deterministic offerer per peer pair", () => {
    expect(shouldInitiateOffer("aaa", "bbb")).toBe(true);
    expect(shouldInitiateOffer("bbb", "aaa")).toBe(false);
  });

  it("CALL-U8 lays tiles out mobile-first", () => {
    expect(gridColumns(1)).toBe(1);
    expect(gridColumns(3)).toBe(2);
    expect(gridColumns(6)).toBe(3);
  });

  it("CALL-U9 labels every connection state", () => {
    expect(connectionLabel("connected")).toBe("Connected");
    expect(connectionLabel("reconnecting")).toBe("Reconnecting");
    expect(connectionLabel("failed")).toBe("Disconnected");
    expect(connectionLabel("connecting")).toBe("Connecting");
  });

  it("CALL-U10 only refreshes authorization when returning to the foreground", () => {
    expect(lifecycleAction("hidden")).toBe("keep");
    expect(lifecycleAction("visible")).toBe("refresh");
  });
});
