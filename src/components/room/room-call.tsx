import { useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Radio, Video, VideoOff, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRoomCall } from "@/hooks/useRoomCall";
import { deviceFailureMessage } from "@/lib/calls/capability";
import {
  canEndCall,
  canStartCall,
  connectionLabel,
  gridColumns,
  remainingSeats,
  type CallParticipant,
} from "@/lib/calls/media-state";

interface RoomCallProps {
  roomId: string;
  userId: string | undefined;
  /** Presentation gating only; SQL re-enforces every one of these rules. */
  canModerate: boolean;
  roomActive: boolean;
}

/** Attaches a live MediaStream to a media element without ever buffering it. */
function useStream(ref: React.RefObject<HTMLVideoElement | null>, stream: MediaStream | null) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => null);
    return () => {
      el.srcObject = null;
    };
  }, [ref, stream]);
}

function ParticipantTile({
  label,
  stream,
  muted,
  cameraOn,
  status,
  self,
}: {
  label: string;
  stream: MediaStream | null;
  muted: boolean;
  cameraOn: boolean;
  status?: string;
  self?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useStream(ref, stream);
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-muted/40 aspect-video">
      <video
        ref={ref}
        playsInline
        autoPlay
        muted={Boolean(self)}
        className={cameraOn ? "h-full w-full object-cover" : "hidden"}
      />
      {!cameraOn ? (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-sm font-medium text-primary">
            {label.slice(0, 2).toUpperCase()}
          </span>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-background/70 px-2 py-1 text-xs">
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-1">
          {status ? <span className="text-muted-foreground">{status}</span> : null}
          {muted ? (
            <MicOff className="h-3 w-3 text-muted-foreground" aria-label="Microphone off" />
          ) : (
            <Mic className="h-3 w-3 text-primary" aria-label="Microphone on" />
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * PHASE 8 — private voice & video for a room.
 *
 * Live communication only: nothing is recorded, transcribed or stored. Media
 * travels over encrypted WebRTC between authorized members; signaling goes
 * through authenticated server functions. Every control here is mirrored by a
 * server-side check, so hiding a button is convenience, never security.
 */
export function RoomCall({ roomId, userId, canModerate, roomActive }: RoomCallProps) {
  const call = useRoomCall(roomId, userId, roomActive);
  const {
    session,
    participants,
    settings,
    joined,
    supported,
    localStream,
    remoteStreams,
    peerStates,
  } = call;

  const self = participants.find((p) => p.user_id === userId) ?? null;
  const others: CallParticipant[] = participants.filter((p) => p.user_id !== userId);
  const columns = gridColumns(participants.length || 1);
  const mayStart = canStartCall(settings?.control_mode ?? "host_only", canModerate);

  if (!supported) {
    return (
      <section className="rounded-2xl border border-border p-4">
        <h2 className="text-lg font-semibold">Voice & video</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This browser doesn&apos;t support live calls. Try the latest Chrome, Safari or Firefox.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border p-4" aria-label="Voice and video">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Voice &amp; video</h2>
          {session ? (
            <Badge variant="secondary" className="capitalize">
              {session.call_mode} call
            </Badge>
          ) : null}
          {call.connected ? (
            <Radio className="h-4 w-4 text-primary" aria-label="Live updates connected" />
          ) : null}
        </div>
        {session ? (
          <span className="text-xs text-muted-foreground">
            {participants.length} in call · {remainingSeats(session, participants.length)} seats
            left
          </span>
        ) : null}
      </header>

      {!call.authorized ? (
        <p className="mt-3 text-sm text-destructive">
          You no longer have access to this room&apos;s call.
        </p>
      ) : null}

      {!session ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Start a private, unrecorded call with the people in this room.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void call.start("voice")} disabled={!mayStart || !roomActive}>
              <Mic className="mr-2 h-4 w-4" /> Start voice call
            </Button>
            <Button
              variant="secondary"
              onClick={() => void call.start("video")}
              disabled={!mayStart || !roomActive}
            >
              <Video className="mr-2 h-4 w-4" /> Start video call
            </Button>
          </div>
          {!mayStart ? (
            <p className="text-xs text-muted-foreground">Only hosts can start a call here.</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {joined ? (
              <ParticipantTile
                self
                label="You"
                stream={localStream}
                muted={!call.micEnabled}
                cameraOn={call.cameraEnabled && session.call_mode === "video"}
              />
            ) : null}
            {others.map((participant) => (
              <ParticipantTile
                key={participant.user_id}
                label={participant.user_id.slice(0, 8)}
                stream={remoteStreams[participant.user_id] ?? null}
                muted={!participant.mic_enabled}
                cameraOn={participant.camera_enabled && session.call_mode === "video"}
                status={connectionLabel(
                  peerStates[participant.user_id] ?? participant.connection_state,
                )}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!joined ? (
              <Button onClick={() => void call.join()} disabled={!roomActive}>
                Join call
              </Button>
            ) : (
              <>
                <Button
                  variant={call.micEnabled ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => void call.toggleMic()}
                  aria-pressed={call.micEnabled}
                >
                  {call.micEnabled ? (
                    <Mic className="mr-2 h-4 w-4" />
                  ) : (
                    <MicOff className="mr-2 h-4 w-4" />
                  )}
                  {call.micEnabled ? "Mute" : "Unmute"}
                </Button>
                {session.call_mode === "video" ? (
                  <Button
                    variant={call.cameraEnabled ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => void call.toggleCamera()}
                    aria-pressed={call.cameraEnabled}
                  >
                    {call.cameraEnabled ? (
                      <Video className="mr-2 h-4 w-4" />
                    ) : (
                      <VideoOff className="mr-2 h-4 w-4" />
                    )}
                    {call.cameraEnabled ? "Stop camera" : "Start camera"}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => void call.leave()}>
                  <X className="mr-2 h-4 w-4" /> Leave
                </Button>
              </>
            )}
            {canEndCall(session, userId, canModerate) ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void call.endForEveryone()}
              >
                <PhoneOff className="mr-2 h-4 w-4" /> End for everyone
              </Button>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            Calls are live only — nothing is recorded, transcribed or stored. Media is encrypted in
            transit between participants.
          </p>
        </div>
      )}

      {call.deviceFailure ? (
        <p className="mt-3 text-sm text-destructive">
          {deviceFailureMessage(call.deviceFailure)}
        </p>
      ) : null}
      {call.error ? (
        <p className="mt-2 text-sm text-destructive">We couldn&apos;t do that: {call.error}</p>
      ) : null}
      {self && self.connection_state === "reconnecting" ? (
        <p className="mt-2 text-sm text-muted-foreground">Reconnecting…</p>
      ) : null}
    </section>
  );
}
