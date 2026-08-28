/**
 * Phase 7 — pre-flight permission and capability checks for device sharing.
 *
 * Scope note: this app shares files the user explicitly picks. It does NOT use
 * the camera or microphone anywhere (those Android permissions were removed for
 * Play policy reasons), so the pre-flight never requests them — it only reports
 * that they are not needed. The real gates are: the file picker granted us the
 * bytes, the browser can decode the media, and peer transport is available.
 */

export type CheckId = "files" | "decode" | "transport" | "camera" | "microphone" | "consent";
export type CheckState = "granted" | "blocked" | "pending" | "not-required";

export interface PreflightCheck {
  id: CheckId;
  label: string;
  state: CheckState;
  detail: string;
}

export interface PreflightInput {
  /** Files handed over by the OS picker. Non-empty means access was granted. */
  fileCount: number;
  /** Result of `detectCapability` for the selected media type. */
  decode: "supported" | "maybe" | "unsupported";
  /** WebRTC data channels available in this runtime. */
  transportAvailable: boolean;
  /** The user ticked the "I have the right to share this" confirmation. */
  consented: boolean;
}

export function buildPreflight(input: PreflightInput): PreflightCheck[] {
  return [
    {
      id: "files",
      label: "Device media access",
      state: input.fileCount > 0 ? "granted" : "pending",
      detail:
        input.fileCount > 0
          ? `${input.fileCount} item${input.fileCount === 1 ? "" : "s"} shared with this app by the picker`
          : "Choose media from this device — Android will ask for photo/media access if needed",
    },
    {
      id: "decode",
      label: "Playback support",
      state:
        input.decode === "unsupported"
          ? "blocked"
          : input.decode === "supported"
            ? "granted"
            : "pending",
      detail:
        input.decode === "unsupported"
          ? "This device can't play the selected format — pick another file"
          : input.decode === "supported"
            ? "This device can play the selected media"
            : "Format may not play on every device in the room",
    },
    {
      id: "transport",
      label: "Peer-to-peer transport",
      state: input.transportAvailable ? "granted" : "blocked",
      detail: input.transportAvailable
        ? "Encrypted direct connection is available"
        : "This browser can't open a peer connection, so media can't be delivered",
    },
    {
      id: "camera",
      label: "Camera",
      state: "not-required",
      detail: "Not used by this app and never requested",
    },
    {
      id: "microphone",
      label: "Microphone",
      state: "not-required",
      detail: "Not used by this app and never requested",
    },
    {
      id: "consent",
      label: "Sharing confirmation",
      state: input.consented ? "granted" : "pending",
      detail: input.consented
        ? "You confirmed you may share this media with the room"
        : "Confirm you have the right to share this media",
    },
  ];
}

/**
 * Checks that only warn. An uncertain format ("may not play everywhere") is
 * advisory: the user is allowed to try anyway, so it must not disable the
 * start button — only hard blocks and the required gates do that.
 */
const ADVISORY_CHECKS: CheckId[] = ["decode"];

/** Sharing may start when nothing is blocked and every required check passed. */
export function canStartSharing(checks: PreflightCheck[]): boolean {
  return checks.every(
    (check) =>
      check.state === "granted" ||
      check.state === "not-required" ||
      (check.state === "pending" && ADVISORY_CHECKS.includes(check.id)),
  );
}

/** First reason the user cannot continue, for the button hint. */
export function blockingReason(checks: PreflightCheck[]): string | null {
  const blocked = checks.find((check) => check.state === "blocked");
  if (blocked) return blocked.detail;
  const pending = checks.find(
    (check) => check.state === "pending" && !ADVISORY_CHECKS.includes(check.id),
  );
  return pending ? pending.detail : null;
}

/** Runtime probe: are WebRTC data channels usable here? */
export function detectTransportSupport(
  scope: {
    RTCPeerConnection?: unknown;
  } = globalThis as unknown as { RTCPeerConnection?: unknown },
): boolean {
  return typeof scope.RTCPeerConnection === "function";
}

/**
 * Best-effort read of a Permissions API entry. Never throws and never prompts:
 * browsers that don't expose the query simply report "unknown".
 */
export async function queryPermission(
  name: PermissionName,
  permissions?: { query: (descriptor: { name: PermissionName }) => Promise<{ state: string }> },
): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  const api =
    permissions ?? (globalThis.navigator as Navigator | undefined)?.permissions ?? undefined;
  if (!api?.query) return "unknown";
  try {
    const result = await api.query({ name });
    if (result.state === "granted" || result.state === "denied" || result.state === "prompt") {
      return result.state;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
