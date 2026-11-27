import { Capacitor } from "@capacitor/core";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/**
 * Android WebView storage normally persists on its own. Some devices/WebView
 * versions can still lose that storage when the process is force-stopped, so
 * native builds keep a second, app-private copy of the auth tokens.
 *
 * The copy never leaves the device, is never logged, and is removed on explicit
 * sign-out. Browser behaviour continues to use Supabase's localStorage storage.
 */
const NATIVE_SESSION_KEY = "synctogether.auth.session.v1";

interface StoredTokens {
  access_token: string;
  refresh_token: string;
}

export interface PersistentSessionResult {
  session: Session | null;
  error: Error | null;
}

let restoreInFlight: Promise<Session | null> | null = null;

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function preferences() {
  const { Preferences } = await import("@capacitor/preferences");
  return Preferences;
}

function isAuthRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = error.status;
  return status === 400 || status === 401 || status === 403;
}

async function restoreNativeSession(): Promise<Session | null> {
  const store = await preferences();
  const { value } = await store.get({ key: NATIVE_SESSION_KEY });
  if (!value) return null;

  let tokens: StoredTokens;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("access_token" in parsed) ||
      !("refresh_token" in parsed) ||
      typeof parsed.access_token !== "string" ||
      typeof parsed.refresh_token !== "string" ||
      !parsed.access_token ||
      !parsed.refresh_token
    ) {
      throw new Error("Invalid stored session");
    }
    tokens = { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
  } catch {
    await store.remove({ key: NATIVE_SESSION_KEY });
    return null;
  }

  try {
    const { data, error } = await supabase.auth.setSession(tokens);
    if (error) {
      // A rejected/expired refresh token is useless, but a network failure must
      // never log the user out or destroy their only recoverable session.
      if (isAuthRejection(error)) await store.remove({ key: NATIVE_SESSION_KEY });
      return null;
    }
    return data.session;
  } catch (error) {
    if (isAuthRejection(error)) await store.remove({ key: NATIVE_SESSION_KEY });
    return null;
  }
}

/** Read the normal session first, then restore the native backup if necessary. */
export async function getPersistentSession(): Promise<PersistentSessionResult> {
  const { data, error } = await supabase.auth.getSession();
  if (data.session || !isNative()) return { session: data.session, error };

  if (!restoreInFlight) {
    restoreInFlight = restoreNativeSession();
  }

  try {
    const session = await restoreInFlight;
    return { session, error: session ? null : error };
  } catch {
    // Storage/network failures are deliberately non-destructive. The normal
    // signed-out flow still runs, and a later launch can retry the restore.
    return { session: null, error };
  } finally {
    restoreInFlight = null;
  }
}

/** Mirror auth changes on native without letting an initial null event wipe it. */
export async function syncNativeAuthSession(event: string, session: Session | null): Promise<void> {
  if (!isNative()) return;
  const store = await preferences();
  if (event === "SIGNED_OUT") {
    await store.remove({ key: NATIVE_SESSION_KEY });
    return;
  }
  if (!session) return;
  const tokens: StoredTokens = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  };
  await store.set({ key: NATIVE_SESSION_KEY, value: JSON.stringify(tokens) });
}

/** Explicit logout must also remove the native recovery copy. */
export async function clearNativeAuthSession(): Promise<void> {
  if (!isNative()) return;
  const store = await preferences();
  await store.remove({ key: NATIVE_SESSION_KEY });
}
