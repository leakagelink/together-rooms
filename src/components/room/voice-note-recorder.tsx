import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  MAX_VOICE_NOTE_MS,
  VOICE_NOTE_BITRATE,
  clampVoiceNoteDuration,
  formatVoiceDuration,
  pickRecorderMime,
} from "@/lib/voice-notes";

export interface RecordedVoiceNote {
  blob: Blob;
  mime: string;
  durationMs: number;
}

type Phase = "idle" | "starting" | "recording" | "sending";

function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is off. Allow it in your phone settings to send voice notes.";
  }
  if (name === "NotFoundError") return "No microphone was found on this device.";
  if (name === "NotReadableError") return "The microphone is busy in another app.";
  return "Voice notes aren't supported on this device.";
}

/**
 * Hold-free recorder: tap the mic to start, then Send or Cancel. Recording
 * stops on its own at the 5-minute limit and is sent. The microphone is only
 * requested from that tap, and released as soon as recording ends.
 */
export function useVoiceNoteRecorder(onRecorded: (note: RecordedVoiceNote) => Promise<void>) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const sendOnStopRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const release = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      sendOnStopRef.current = false;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      release();
    };
  }, [release]);

  const stop = useCallback((send: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    sendOnStopRef.current = send;
    recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice notes aren't supported on this device.");
      return;
    }
    const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      toast.error("Voice notes aren't supported on this device.");
      return;
    }
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      setPhase("idle");
      toast.error(micErrorMessage(error));
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: VOICE_NOTE_BITRATE });
    recorderRef.current = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      const durationMs = clampVoiceNoteDuration(Date.now() - startedAtRef.current);
      const blob = new Blob(chunksRef.current, { type: mime });
      const send = sendOnStopRef.current;
      release();
      setElapsedMs(0);
      if (!send) {
        setPhase("idle");
        return;
      }
      if (durationMs === null || blob.size === 0) {
        setPhase("idle");
        toast.error("That voice note was too short.");
        return;
      }
      setPhase("sending");
      void onRecordedRef.current({ blob, mime, durationMs }).finally(() => setPhase("idle"));
    });
    startedAtRef.current = Date.now();
    recorder.start(1000);
    setElapsedMs(0);
    setPhase("recording");
    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_VOICE_NOTE_MS) stop(true);
    }, 250);
  }, [phase, release, stop]);

  return { phase, elapsedMs, start, send: () => stop(true), cancel: () => stop(false) };
}

export function VoiceNoteRecordingBar({
  phase,
  elapsedMs,
  onSend,
  onCancel,
}: {
  phase: Phase;
  elapsedMs: number;
  onSend: () => void;
  onCancel: () => void;
}) {
  const sending = phase === "sending";
  return (
    <div className="glass flex items-center gap-2 rounded-[1.75rem] p-1.5" role="status" aria-live="polite">
      <Button
        variant="ghost"
        size="icon"
        className="size-10 shrink-0 rounded-full text-destructive"
        aria-label="Cancel voice note"
        onClick={onCancel}
        disabled={sending}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
      <div className="flex flex-1 items-center gap-2 px-1 text-sm">
        {sending ? (
          <span className="text-muted-foreground">Sending voice note…</span>
        ) : (
          <>
            <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
            <span className="font-semibold tabular-nums">{formatVoiceDuration(elapsedMs)}</span>
            <span className="text-xs text-muted-foreground">
              / {formatVoiceDuration(MAX_VOICE_NOTE_MS)} · Recording
            </span>
          </>
        )}
      </div>
      <Button
        onClick={onSend}
        disabled={sending || phase !== "recording"}
        aria-label="Send voice note"
        className="size-10 shrink-0 rounded-full p-0"
      >
        {sending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
