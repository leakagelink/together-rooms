/**
 * PHASE 10 — runtime permission model.
 *
 * Nothing here runs at startup. A permission is requested only from the user
 * gesture that needs it (enable microphone, enable camera, pick a file), and a
 * denial degrades exactly one feature: the rest of the product keeps working.
 */

import type { CallDeviceFailure } from "@/lib/calls/capability";

export type AndroidPermission = "camera" | "microphone" | "media_picker" | "notifications";

export type PermissionState = "granted" | "denied" | "permanently_denied" | "unavailable";

export interface PermissionTrigger {
  permission: AndroidPermission;
  /** The explicit user action that may request it. */
  trigger:
    "enable_camera" | "join_call_with_microphone" | "pick_local_media" | "enable_notifications";
  /** Runtime (dangerous) permission on modern Android? */
  runtime: boolean;
  requiredAtStartup: false;
}

/** Declarative map used by the UI and asserted by the Android security tests. */
export const PERMISSION_TRIGGERS: readonly PermissionTrigger[] = [
  { permission: "camera", trigger: "enable_camera", runtime: true, requiredAtStartup: false },
  {
    permission: "microphone",
    trigger: "join_call_with_microphone",
    runtime: true,
    requiredAtStartup: false,
  },
  // The system picker (SAF) grants per-file access; no permission is requested.
  {
    permission: "media_picker",
    trigger: "pick_local_media",
    runtime: false,
    requiredAtStartup: false,
  },
  {
    permission: "notifications",
    trigger: "enable_notifications",
    runtime: true,
    requiredAtStartup: false,
  },
];

/** Features that must keep working when a device permission is refused. */
export const FEATURES_INDEPENDENT_OF_DEVICE_PERMISSIONS = [
  "rooms",
  "invites",
  "chat",
  "watch_together",
  "music",
  "study",
  "playlists",
  "moderation",
  "subscription",
] as const;

export type IndependentFeature = (typeof FEATURES_INDEPENDENT_OF_DEVICE_PERMISSIONS)[number];

export function featureBlockedByPermission(
  feature: IndependentFeature | "voice_call" | "video_call" | "local_media",
  denied: AndroidPermission,
): boolean {
  if (denied === "microphone") return feature === "voice_call" || feature === "video_call";
  if (denied === "camera") return feature === "video_call";
  if (denied === "media_picker") return feature === "local_media";
  return false;
}

export interface PermissionRecovery {
  state: PermissionState;
  message: string;
  /** Show a deep link into Android app settings instead of re-prompting. */
  openSettings: boolean;
  /** Whether asking again can plausibly succeed (never loop otherwise). */
  canRetry: boolean;
}

export function permissionRecovery(
  permission: AndroidPermission,
  state: PermissionState,
): PermissionRecovery {
  const noun =
    permission === "camera" ? "Camera" : permission === "microphone" ? "Microphone" : "Media";
  switch (state) {
    case "granted":
      return { state, message: "", openSettings: false, canRetry: false };
    case "denied":
      return {
        state,
        message: `${noun} access was declined. You can continue without it, or try again.`,
        openSettings: false,
        canRetry: true,
      };
    case "permanently_denied":
      return {
        state,
        message: `${noun} access is blocked. Turn it on in Android app settings, then come back.`,
        openSettings: true,
        canRetry: false,
      };
    case "unavailable":
      return {
        state,
        message: `No ${noun.toLowerCase()} is available on this device. Everything else keeps working.`,
        openSettings: false,
        canRetry: false,
      };
  }
}

/** Maps the existing web capability failure onto the Android permission state. */
export function permissionStateFromFailure(failure: CallDeviceFailure): PermissionState {
  switch (failure) {
    case "permission_denied":
      return "permanently_denied";
    case "not_found":
    case "unsupported":
    case "insecure_context":
      return "unavailable";
    case "in_use":
    case "unknown":
      return "denied";
  }
}
