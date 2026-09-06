/**
 * PHASE 14.2 — opt-in ad diagnostics.
 *
 * Ad problems on a device are invisible without a trace of the decision path.
 * These logs are OFF unless the build sets `VITE_ADS_DEBUG=1` (or it is a dev
 * build), and they never contain user data — only formats, placements, policy
 * reasons and short SDK error tokens.
 */
const enabled = (() => {
  try {
    return (
      import.meta.env.DEV || String(import.meta.env["VITE_ADS_DEBUG"] ?? "") === "1"
    );
  } catch {
    return false;
  }
})();

export function adDebug(event: string, detail?: Record<string, unknown>) {
  if (!enabled) return;
  // eslint-disable-next-line no-console
  console.info(`[ads] ${event}`, detail ?? {});
}

export const adDebugEnabled = enabled;
