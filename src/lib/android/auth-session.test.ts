import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const {
  native,
  getSession,
  setSession,
  preferenceGet,
  preferenceSet,
  preferenceRemove,
} = vi.hoisted(() => ({
  native: { value: true },
  getSession: vi.fn(),
  setSession: vi.fn(),
  preferenceGet: vi.fn(),
  preferenceSet: vi.fn(),
  preferenceRemove: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.value },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: preferenceGet,
    set: preferenceSet,
    remove: preferenceRemove,
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession, setSession } },
}));

import {
  clearNativeAuthSession,
  getPersistentSession,
  syncNativeAuthSession,
} from "./auth-session";

function session(accessToken = "access-token"): Session {
  return { access_token: accessToken, refresh_token: "refresh-token" } as Session;
}

describe("native auth session persistence", () => {
  beforeEach(() => {
    native.value = true;
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    preferenceGet.mockResolvedValue({ value: null });
    preferenceSet.mockResolvedValue(undefined);
    preferenceRemove.mockResolvedValue(undefined);
  });

  it("restores the saved native session after Android cold start", async () => {
    const restored = session("restored-access-token");
    preferenceGet.mockResolvedValue({
      value: JSON.stringify({ access_token: "saved-access", refresh_token: "saved-refresh" }),
    });
    setSession.mockResolvedValue({ data: { session: restored }, error: null });

    const result = await getPersistentSession();

    expect(setSession).toHaveBeenCalledWith({
      access_token: "saved-access",
      refresh_token: "saved-refresh",
    });
    expect(result.session).toBe(restored);
    expect(result.error).toBeNull();
  });

  it("uses an existing valid session without replacing it", async () => {
    const existing = session();
    getSession.mockResolvedValue({ data: { session: existing }, error: null });

    const result = await getPersistentSession();

    expect(result.session).toBe(existing);
    expect(preferenceGet).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("keeps browser authentication on its existing storage path", async () => {
    native.value = false;

    await getPersistentSession();
    await syncNativeAuthSession("SIGNED_IN", session());

    expect(preferenceGet).not.toHaveBeenCalled();
    expect(preferenceSet).not.toHaveBeenCalled();
  });

  it("saves refreshed tokens but never clears them on an initial null event", async () => {
    await syncNativeAuthSession("TOKEN_REFRESHED", session("new-access"));
    expect(preferenceSet).toHaveBeenCalledWith({
      key: "synctogether.auth.session.v1",
      value: JSON.stringify({ access_token: "new-access", refresh_token: "refresh-token" }),
    });

    await syncNativeAuthSession("INITIAL_SESSION", null);
    expect(preferenceRemove).not.toHaveBeenCalled();
  });

  it("clears the native session only on explicit sign-out", async () => {
    await syncNativeAuthSession("SIGNED_OUT", null);
    await clearNativeAuthSession();

    expect(preferenceRemove).toHaveBeenCalledTimes(2);
    expect(preferenceRemove).toHaveBeenCalledWith({ key: "synctogether.auth.session.v1" });
  });

  it("does not destroy the saved session during a network failure", async () => {
    preferenceGet.mockResolvedValue({
      value: JSON.stringify({ access_token: "saved-access", refresh_token: "saved-refresh" }),
    });
    setSession.mockRejectedValue(new Error("Network unavailable"));

    const result = await getPersistentSession();

    expect(result.session).toBeNull();
    expect(preferenceRemove).not.toHaveBeenCalled();
  });
});
