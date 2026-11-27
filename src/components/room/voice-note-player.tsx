import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Pause, Play } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { formatVoiceDuration, VOICE_NOTE_BUCKET } from "@/lib/voice-notes";
import { cn } from "@/lib/utils";

/**
 * Plays a room voice note. The recording stays private: a short-lived signed
 * link is requested only when the listener presses play.
 */
export function VoiceNotePlayer({
  path,
  durationMs,
  mine,
}: {
  path: string;
  durationMs: number;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [positionMs, setPositionMs] = useState(0);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  async function toggle() {
    const existing = audioRef.current;
    if (existing) {
      if (existing.paused) {
        try {
          await existing.play();
        } catch {
          setState("error");
        }
      } else {
        existing.pause();
      }
      return;
    }
    setState("loading");
    const { data, error } = await supabase.storage
      .from(VOICE_NOTE_BUCKET)
      .createSignedUrl(path, 60 * 60);
    if (error || !data?.signedUrl) {
      setState("error");
      return;
    }
    const audio = new Audio(data.signedUrl);
    audio.preload = "auto";
    audio.addEventListener("play", () => setState("playing"));
    audio.addEventListener("pause", () => setState("paused"));
    audio.addEventListener("timeupdate", () => setPositionMs(audio.currentTime * 1000));
    audio.addEventListener("ended", () => {
      setPositionMs(0);
      setState("paused");
    });
    audio.addEventListener("error", () => setState("error"));
    audioRef.current = audio;
    try {
      await audio.play();
    } catch {
      setState("error");
    }
  }

  const progress = Math.min(100, durationMs > 0 ? (positionMs / durationMs) * 100 : 0);
  const playing = state === "playing";
  const shown = playing || positionMs > 0 ? positionMs : durationMs;

  return (
    <div className="flex min-w-48 items-center gap-3 py-0.5">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={state === "loading"}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "press grid size-10 shrink-0 place-items-center rounded-full",
          mine ? "bg-background/25 text-primary-foreground" : "bg-liquid text-primary-foreground",
        )}
      >
        {state === "loading" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : playing ? (
          <Pause className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4 translate-x-px" aria-hidden="true" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className={cn("h-1.5 overflow-hidden rounded-full", mine ? "bg-background/25" : "bg-muted")}
          role="progressbar"
          aria-label="Voice note progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div
            className={cn("h-full rounded-full", mine ? "bg-primary-foreground" : "bg-primary")}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-1 flex items-center gap-1 text-[11px] opacity-80">
          <Mic className="size-3" aria-hidden="true" />
          {state === "error" ? "Couldn't play this voice note" : formatVoiceDuration(shown)}
        </p>
      </div>
    </div>
  );
}
