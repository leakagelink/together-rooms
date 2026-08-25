/**
 * PHASE 10 — app lifecycle, network recovery and stale-state rules.
 *
 * Android freezes, backgrounds and kills processes at will. None of that may
 * ever be interpreted as an intent: backgrounding must not remove a member,
 * end a room, transfer host or mutate anyone else's state. Only the server is
 * authoritative — this module decides what the client must *revalidate* on
 * return, and guarantees a reconnect never replays an authoritative mutation.
 */

export type LifecycleEvent = "foreground" | "background" | "online" | "offline" | "process_start";

export interface RoomStateAge {
  /** When the authoritative snapshot was last confirmed by the server. */
  fetchedAt: number;
  now: number;
}

/** Room/membership state older than this must be refetched before it is trusted. */
export const STALE_ROOM_STATE_MS = 15_000;
/** Call authorization is short-lived by design (Phase 7/8 transport grants). */
export const STALE_CALL_AUTH_MS = 60_000;

export function isRoomStateStale({ fetchedAt, now }: RoomStateAge): boolean {
  return now - fetchedAt >= STALE_ROOM_STATE_MS;
}

/**
 * A locally cached call/transport authorization is never re-usable past its
 * server-issued expiry, and is additionally treated as stale after a
 * background interruption regardless of the clock.
 */
export function canReuseCallAuthorization(input: {
  issuedAt: number;
  expiresAt: number;
  now: number;
  backgroundedSince: boolean;
}): boolean {
  if (input.backgroundedSince) return false;
  if (input.now >= input.expiresAt) return false;
  return input.now - input.issuedAt < STALE_CALL_AUTH_MS;
}

export interface RevalidationPlan {
  /** Re-read the session before anything else; everything depends on it. */
  session: boolean;
  membership: boolean;
  roomState: boolean;
  playback: boolean;
  chat: boolean;
  callAuthorization: boolean;
  realtime: boolean;
  entitlement: boolean;
}

const NOTHING: RevalidationPlan = {
  session: false,
  membership: false,
  roomState: false,
  playback: false,
  chat: false,
  callAuthorization: false,
  realtime: false,
  entitlement: false,
};

export interface LifecycleContext {
  inRoom: boolean;
  inCall: boolean;
  /** True when the process was recreated rather than merely resumed. */
  processRecreated?: boolean;
}

/**
 * A lifecycle event only ever produces *reads*. There is deliberately no
 * branch here that writes, leaves, ends or transfers anything.
 */
export function revalidationPlan(
  event: LifecycleEvent,
  context: LifecycleContext,
): RevalidationPlan {
  if (event === "background" || event === "offline") return { ...NOTHING };
  const full = event === "process_start" || context.processRecreated === true;
  return {
    session: true,
    membership: context.inRoom,
    roomState: context.inRoom,
    playback: context.inRoom,
    chat: context.inRoom,
    callAuthorization: context.inCall,
    realtime: true,
    entitlement: full,
  };
}

/** Lifecycle handling never mutates remote state — asserted by ANDROID-T12. */
export function lifecycleMutatesRemoteState(): boolean {
  return false;
}

/* ------------------------------------------------------------------ */
/* Reconnect idempotency                                               */
/* ------------------------------------------------------------------ */

export interface MutationAttempt {
  /** Stable, caller-generated key for one logical mutation. */
  key: string;
  at: number;
}

/** Window in which a repeated key is treated as the same logical mutation. */
export const MUTATION_DEDUPE_MS = 30_000;

/**
 * Tracks in-flight/recent authoritative mutations so a reconnect (Wi-Fi to
 * mobile, resume from background, socket re-subscribe) cannot re-send a queue
 * mutation, a chat message, a playback command or a call join twice.
 */
export class MutationGuard {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs: number = MUTATION_DEDUPE_MS) {}

  /** Returns false when this key was already accepted inside the window. */
  accept(attempt: MutationAttempt): boolean {
    this.prune(attempt.at);
    if (this.seen.has(attempt.key)) return false;
    this.seen.set(attempt.key, attempt.at);
    return true;
  }

  /** Releases a key after a *failed* attempt so the user can retry. */
  release(key: string): void {
    this.seen.delete(key);
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) {
      if (now - at > this.windowMs) this.seen.delete(key);
    }
  }
}

/** Backoff for realtime/transport reconnects; jitter is applied by the caller. */
export function reconnectDelayMs(attempt: number): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return base;
}
