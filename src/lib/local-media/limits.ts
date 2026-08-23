/**
 * Phase 7 — private local media rooms: conservative, documented limits.
 *
 * Nothing here is a client-side security control: every one of these bounds
 * has a server-side counterpart (rate limits, session expiry, one active
 * session per room). These constants exist so the UI fails early and clearly,
 * and so large media never has to be held in memory.
 */

/** Maximum bytes we will stream through a data channel in one session. */
export const MAX_SESSION_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB

/** Bounded data-channel chunk. Deliberately small enough for every browser. */
export const CHUNK_BYTES = 16 * 1024;

/** Pause reading once this much is queued; resume under the low threshold. */
export const BUFFERED_HIGH_WATER = 4 * 1024 * 1024;
export const BUFFERED_LOW_WATER = 1 * 1024 * 1024;

/** Maximum images in one shared slideshow session. */
export const MAX_IMAGE_ITEMS = 50;

/** Server-authoritative session lifetime (mirrors the database default). */
export const SESSION_MAX_MINUTES = 120;

/** Transport credential lifetime (mirrors the database grant TTL). */
export const GRANT_TTL_SECONDS = 300;

/** Re-issue a credential this long before it expires. */
export const GRANT_REFRESH_MARGIN_SECONDS = 60;

/** Owner heartbeat cadence and the grace period the server enforces. */
export const OWNER_HEARTBEAT_MS = 20_000;
export const OWNER_GRACE_SECONDS = 90;

/** Signaling poll cadence while a session is being established. */
export const SIGNAL_POLL_MS = 1500;

/** How long a stalled connection attempt is allowed to run. */
export const CONNECT_TIMEOUT_MS = 30_000;
