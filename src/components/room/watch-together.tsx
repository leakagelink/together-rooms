import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pause, Play, RefreshCw, RotateCcw, Trash2, Youtube } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRoomPlayback } from "@/hooks/useRoomPlayback";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";
import {
  DRIFT_CHECK_INTERVAL_MS,
  DRIFT_CORRECTION_COOLDOWN_MS,
  DRIFT_CORRECT_SECONDS,
  driftAction,
  expectedPosition,
  parseYouTubeVideoId,
  syncLabel,
  type PlaybackState,
} from "@/lib/playback-sync";
import {
  clearRoomMedia,
  pauseRoomMedia,
  playRoomMedia,
  seekRoomMedia,
  setRoomMedia,
} from "@/lib/playback.functions";

/**
 * Feedback-loop prevention (documented in docs/YOUTUBE-POLICY.md):
 *
 * 1. `applyingRemote` is raised before any programmatic seek/play/pause we
 *    perform to match authoritative state, and lowered on a short timer. Player
 *    events observed while it is raised are ignored, so a remote update can
 *    never bounce back as a new database mutation.
 * 2. Only a controller's *own* deliberate player events produce mutations, and
 *    only when they disagree with the authoritative status.
 * 3. Every mutation carries `expected_version`; the database rejects stale
 *    commands, so a duplicated event cannot double-apply.
 * 4. Drift correction seeks the local player only — it never writes.
 */

interface YouTubePlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  loadVideoById: (id: string, start?: number) => void;
  cueVideoById: (id: string, start?: number) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    options: Record<string, unknown>,
  ) => YouTubePlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the official YouTube IFrame Player API exactly once per document. */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube API failed to initialize"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube API failed to load"));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export interface WatchTogetherProps {
  roomId: string;
  userId: string | undefined;
  /** Host or a member with can_control_playback. UI gating only — SQL re-checks. */
  canControl: boolean;
  /** False once the room has ended or expired. */
  roomActive: boolean;
}

export function WatchTogether({ roomId, userId, canControl, roomActive }: WatchTogetherProps) {
  const playback = useRoomPlayback(roomId, userId);
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const applyingRemote = useRef(false);
  const appliedVersion = useRef<number>(-1);
  const loadedVideo = useRef<string | null>(null);
  const lastCorrection = useRef(0);

  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [drifting, setDrifting] = useState(false);

  const state = playback.state;
  const stateRef = useRef<PlaybackState | null>(null);
  stateRef.current = state;

  const setMedia = useServerFn(setRoomMedia);
  const play = useServerFn(playRoomMedia);
  const pause = useServerFn(pauseRoomMedia);
  const seek = useServerFn(seekRoomMedia);
  const clear = useServerFn(clearRoomMedia);

  const suppress = useCallback((fn: () => void) => {
    applyingRemote.current = true;
    try {
      fn();
    } finally {
      setTimeout(() => {
        applyingRemote.current = false;
      }, 800);
    }
  }, []);

  /** Applies an RPC result: conflicts refresh from the authoritative state. */
  const applyResult = useCallback(
    (result: { ok: boolean; reason?: string; state?: unknown }) => {
      if (result.ok) {
        if (result.state) {
          queryClient.setQueryData(queryKeys.playback.state(roomId), result.state);
        }
        return;
      }
      if (result.reason === "version_conflict") {
        playback.resync();
        toast.message("Someone else changed playback first. Resynced.");
        return;
      }
      toast.error(rpcMessage((result.reason ?? "server_error") as never));
    },
    [playback, queryClient, roomId],
  );

  const mutation = useMutation({
    mutationFn: async (
      action: { kind: "media"; mediaId: string } | { kind: "play" } | { kind: "pause" } | {
        kind: "seek";
        position: number;
      } | { kind: "clear" },
    ) => {
      const expected_version = stateRef.current?.version ?? null;
      switch (action.kind) {
        case "media":
          return setMedia({
            data: {
              room_id: roomId,
              provider: "youtube",
              media_id: action.mediaId,
              expected_version,
            },
          });
        case "play":
          return play({ data: { room_id: roomId, expected_version } });
        case "pause":
          return pause({ data: { room_id: roomId, expected_version } });
        case "seek":
          return seek({
            data: { room_id: roomId, position_seconds: action.position, expected_version },
          });
        case "clear":
          return clear({ data: { room_id: roomId, expected_version } });
      }
    },
    onSuccess: (result) => applyResult(result as never),
    onError: () => toast.error("Playback command failed."),
  });

  const mutate = mutation.mutate;

  // ---- player bootstrap (client-only, official IFrame API)
  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || playerRef.current) return;
        playerRef.current = new YT.Player(el, {
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onReady: () => {
              if (!cancelled) setPlayerReady(true);
            },
            onError: () => {
              if (!cancelled) setPlayerError("This video can't be played here.");
            },
            onStateChange: (event: { data: number }) => {
              if (applyingRemote.current) return;
              const current = stateRef.current;
              if (!current || !canControl || !roomActive) return;
              const YTState = window.YT?.PlayerState;
              if (!YTState) return;
              if (event.data === YTState.PLAYING && current.playback_status !== "playing") {
                mutate({ kind: "play" });
              } else if (event.data === YTState.PAUSED && current.playback_status === "playing") {
                const position = playerRef.current?.getCurrentTime() ?? current.position_seconds;
                mutate({ kind: "seek", position });
                mutate({ kind: "pause" });
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setPlayerError("The YouTube player couldn't be loaded.");
      });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      setPlayerReady(false);
    };
    // Intentionally mount-once: handlers read the latest values through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- apply authoritative state (version-ordered)
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerReady || !state) return;
    if (state.version <= appliedVersion.current) return; // out-of-order / duplicate
    appliedVersion.current = state.version;

    const media = state.provider_media_id;
    const target = expectedPosition(state, playback.now());

    suppress(() => {
      if (!media) {
        loadedVideo.current = null;
        player.pauseVideo();
        return;
      }
      if (loadedVideo.current !== media) {
        loadedVideo.current = media;
        setPlayerError(null);
        if (state.playback_status === "playing") player.loadVideoById(media, target);
        else player.cueVideoById(media, target);
        return;
      }
      player.seekTo(target, true);
      if (state.playback_status === "playing") player.playVideo();
      else player.pauseVideo();
    });
  }, [playback, playerReady, state, suppress]);

  // ---- bounded drift correction: local seeks only, never a database write
  useEffect(() => {
    if (!playerReady) return;
    const id = setInterval(() => {
      const player = playerRef.current;
      const current = stateRef.current;
      if (!player || !current || current.playback_status !== "playing") {
        setDrifting(false);
        return;
      }
      const target = expectedPosition(current, playback.now());
      const actual = player.getCurrentTime();
      const drift = target - actual;
      if (driftAction(drift) === "none") {
        setDrifting(false);
        return;
      }
      setDrifting(Math.abs(drift) >= DRIFT_CORRECT_SECONDS);
      const since = Date.now() - lastCorrection.current;
      if (since < DRIFT_CORRECTION_COOLDOWN_MS) return;
      lastCorrection.current = Date.now();
      suppress(() => player.seekTo(target, true));
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playback, playerReady, suppress]);

  const status = syncLabel({
    authorized: playback.authorized,
    connected: playback.connected,
    syncing: drifting || !playerReady,
  });

  const controllerLabel = useMemo(() => {
    if (!state?.controlled_by) return "Nobody has controlled playback yet";
    return state.controlled_by === userId ? "You control playback" : "A host or controller is in charge";
  }, [state?.controlled_by, userId]);

  const onSubmitUrl = (event: React.FormEvent) => {
    event.preventDefault();
    const id = parseYouTubeVideoId(urlInput);
    if (!id) {
      toast.error("That doesn't look like a YouTube video link.");
      return;
    }
    setUrlInput("");
    mutate({ kind: "media", mediaId: id });
  };

  const busy = mutation.isPending;

  return (
    <section className="surface-panel mt-8 p-5" aria-labelledby="watch-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="watch-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Youtube className="size-5" aria-hidden="true" /> Watch together
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Playback is kept close across devices from the room&apos;s saved state. It is not
            frame-accurate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" role="status">
            {status}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => playback.resync()}>
            <RefreshCw className="size-4" aria-hidden="true" /> Resync
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-muted/40">
        <div className="relative aspect-video w-full">
          <div ref={containerRef} className="absolute inset-0 size-full" />
          {!playerReady || !state?.provider_media_id ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {playerError
                ? playerError
                : !playerReady
                  ? "Starting the player…"
                  : playback.isPending
                    ? "Loading playback state…"
                    : "No video selected yet."}
            </div>
          ) : null}
        </div>
      </div>

      {state?.provider_media_id ? (
        <p className="mt-3 text-sm">
          <span className="font-medium">{state.title ?? "YouTube video"}</span>{" "}
          <span className="text-muted-foreground">
            · {state.playback_status} · v{state.version}
          </span>
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">{controllerLabel}</p>

      {canControl && roomActive ? (
        <div className="mt-4 space-y-3">
          <form onSubmit={onSubmitUrl} className="flex flex-wrap gap-2">
            <label htmlFor="yt-url" className="sr-only">
              YouTube video link
            </label>
            <Input
              id="yt-url"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="Paste a YouTube link"
              className="min-w-48 flex-1"
              inputMode="url"
            />
            <Button type="submit" disabled={busy}>
              Load video
            </Button>
          </form>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !state?.provider_media_id}
              onClick={() => mutate({ kind: "play" })}
            >
              <Play className="size-4" aria-hidden="true" /> Play
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !state?.provider_media_id}
              onClick={() => mutate({ kind: "pause" })}
            >
              <Pause className="size-4" aria-hidden="true" /> Pause
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !state?.provider_media_id}
              onClick={() => {
                const position = playerRef.current?.getCurrentTime() ?? 0;
                mutate({ kind: "seek", position });
              }}
            >
              <RotateCcw className="size-4" aria-hidden="true" /> Sync everyone here
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !state?.provider_media_id}
              onClick={() => mutate({ kind: "clear" })}
            >
              <Trash2 className="size-4" aria-hidden="true" /> Clear
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          {roomActive
            ? "Only the host or a member with playback control can change what's playing."
            : "This room is closed, so playback controls are unavailable."}
        </p>
      )}
    </section>
  );
}
