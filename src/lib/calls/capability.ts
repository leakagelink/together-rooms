/**
 * PHASE 8 — camera/microphone capability and permission handling.
 *
 * Permissions are requested ONLY from an explicit user action (start a call,
 * join with microphone, enable camera). Nothing here runs at app startup and
 * nothing here is called during module evaluation or render.
 */
export type CallDeviceFailure =
  | "unsupported"
  | "insecure_context"
  | "permission_denied"
  | "not_found"
  | "in_use"
  | "unknown";

export interface CallDeviceResult {
  stream: MediaStream | null;
  failure: CallDeviceFailure | null;
}

/** True when this browser can do real-time media at all. */
export function supportsRealtimeMedia(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { mediaDevices?: MediaDevices };
  return Boolean(nav.mediaDevices?.getUserMedia) && typeof window.RTCPeerConnection === "function";
}

/** getUserMedia requires a secure context (https, or localhost in dev). */
export function isSecureMediaContext(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true;
}

/** Maps a DOMException from getUserMedia onto a stable failure code. */
export function classifyMediaError(error: unknown): CallDeviceFailure {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission_denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not_found";
  if (name === "NotReadableError" || name === "AbortError") return "in_use";
  return "unknown";
}

/** User-facing recovery guidance; never blames the user, never leaks device names. */
export function deviceFailureMessage(failure: CallDeviceFailure): string {
  switch (failure) {
    case "unsupported":
      return "This browser can't do live calls. Try the latest Chrome, Safari or Firefox.";
    case "insecure_context":
      return "Live calls need a secure (https) connection.";
    case "permission_denied":
      return "Microphone/camera access is blocked. Allow it in your browser's site settings, then rejoin.";
    case "not_found":
      return "No microphone or camera was found on this device. You can still join in listen-only mode.";
    case "in_use":
      return "Another app is using your microphone or camera. Close it and try again.";
    default:
      return "We couldn't start your microphone or camera. Try again.";
  }
}

/**
 * Requests exactly the tracks the call needs. Camera is only ever requested
 * for a video call and only when the user turned it on.
 */
export async function requestCallMedia(options: {
  audio: boolean;
  video: boolean;
}): Promise<CallDeviceResult> {
  if (!supportsRealtimeMedia()) return { stream: null, failure: "unsupported" };
  if (!isSecureMediaContext()) return { stream: null, failure: "insecure_context" };
  if (!options.audio && !options.video) return { stream: null, failure: null };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: options.audio,
      video: options.video ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
    return { stream, failure: null };
  } catch (error) {
    return { stream: null, failure: classifyMediaError(error) };
  }
}

/** Stops every track; the only way media capture ends on this device. */
export function releaseStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  }
}
