import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pause, Play, RefreshCw, RotateCcw, Trash2, Youtube } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRoomPlayback } from "@/hooks/useRoomPlayback";
import { useProviderMetadata } from "@/hooks/useProviderMetadata";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage } from "@/lib/rpc-types";
import {
  DRIFT_CHECK_INTERVAL_MS,
  DRIFT_CORRECTION_COOLDOWN_MS,
  DRIFT_CORRECT_SECONDS,
  driftAction,
  expectedPosition,
  syncLabel,
  type PlaybackState,
} from "@/lib/playback-sync";
import {
  AUTOPLAY_GRACE_MS,
  planReconciliation,
  playerEventMayMutate,
  type LocalPlayerSnapshot,
} from "@/lib/playback-device";
import { providerError, type ProviderError } from "@/lib/providers/media-provider";
import { youtubeProvider } from "@/lib/providers/youtube";
import {
  clearRoomMedia,
  pauseRoomMedia,
  playRoomMedia,
  seekRoomMedia,
  setRoomMedia,
} from "@/lib/playback.functions";

/**
 * Feedback-loop and local-failure isolation (see docs/YOUTUBE-POLICY.md):
 *
 * 1. `applyingRemote` is raised before any programmatic seek/play/pause issued
 *    to match authoritative state and lowered on a short timer. Player events
 *    seen while it is raised never produce a mutation.
 * 2. `playerEventMayMutate` additionally requires control permission, an active
 *    room, no pending gesture requirement, and that the event belongs to the
 *    video the room is currently on — so a late event from a replaced video is
 *    discarded.
 * 3. Every mutation carries `expected_version`; the database rejects stale
 *    commands, so a duplicated event cannot double-apply.
 * 4. Drift correction, resync, autoplay fallback and provider errors are all
 *    local: none of them writes to the database, so one participant's device
 *    limits never change what the room is doing.
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
  Player: new (el: HTMLElement, options: Record<string, unknown>) => YouTubePlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/**
 * Loads the official YouTube IFrame Player API exactly once per document.
 * The API script itself must come from www.youtube.com; the *player* is then
 * hosted on youtube-nocookie.com (privacy-enhanced mode) via the `host` option.
 */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("api-init"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("api-load"));
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
  const playAttemptAt = useRef(0);
  const gestureRef = useRef(false);

  const [playerReady, setPlayerReady] = useState(false);
  const [providerFailure, setProviderFailure] = useState<ProviderError | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [drifting, setDrifting] = useState(false);
  const [awaitingGesture, setAwaitingGesture] = useState(false);

  const state = playback.state;
  const stateRef = useRef<PlaybackState | null>(null);
  stateRef.current = state;

  const { metadata, policy, isPending: metadataPending } = useProviderMetadata(
    state?.provider_media_id ?? null,
  );

  const setMedia = useServerFn(setRoomMedia);
  const play = useServerFn(playRoomMedia);
  const pause = useServerFn(pauseRoomMedia);
  const seek = useServerFn(seekRoomMedia);
  const clear = useServerFn(clearRoomMedia);

  const setGesture = useCallback((value: boolean) => {
    gestureRef.current = value;
    setAwaitingGesture(value);
  }, []);

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
        playback.resync("manual_resync");
        toast.message("Someone else changed playback first. Resynced.");
        return;
      }
      toast.error(rpcMessage((result.reason ?? "server_error") as never));
    },
    [playback, queryClient, roomId],
  );

  const mutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "media"; mediaId: string }
        | { kind: "play" }
        | { kind: "pause" }
        | { kind: "seek"; position: number }
        | { kind: "clear" },
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

  const snapshot = useCallback((): LocalPlayerSnapshot => {
    const player = playerRef.current;
    const YTState = window.YT?.PlayerState;
    return {
      loadedMediaId: loadedVideo.current,
      currentTime: player?.getCurrentTime() ?? 0,
      playing: Boolean(player && YTState && player.getPlayerState() === YTState.PLAYING),
    };
  }, []);

  /**
   * Applies a purely local reconciliation plan. Called on new authoritative
   * state, on resync and after the user supplies the missing gesture. It never
   * writes: `planReconciliation` can only produce local player steps.
   */
  const applyPlan = useCallback(
    (target: PlaybackState | null) => {
      const player = playerRef.current;
      if (!player) return;
      const plan = planReconciliation(target, snapshot(), playback.now());
      if (plan.steps.length === 0) return;

      suppress(() => {
        for (const step of plan.steps) {
          switch (step.kind) {
            case "clear":
              loadedVideo.current = null;
              setProviderFailure(null);
              player.pauseVideo();
              break;
            case "load":
              loadedVideo.current = step.mediaId;
              setProviderFailure(null);
              if (step.autoplay) player.loadVideoById(step.mediaId, step.position);
              else player.cueVideoById(step.mediaId, step.position);
              break;
            case "seek":
              player.seekTo(step.position, true);
              break;
            case "play":
              player.playVideo();
              break;
            case "pause":
              player.pauseVideo();
              break;
          }
        }
      });

      if (plan.requiresPlayback) playAttemptAt.current = Date.now();
      else setGesture(false);
    },
    [playback, setGesture, snapshot, suppress],
  );

  const applyPlanRef = useRef(applyPlan);
  applyPlanRef.current = applyPlan;

  // ---- player bootstrap (client-only, official IFrame API, nocookie host)
  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    void loadYouTubeApi()
      .then((YT) => {
        if (cancelled || playerRef.current) return;
        playerRef.current = new YT.Player(el, {
          host: youtubeProvider.embedHost,
          width: "100%",
          height: "100%",
          playerVars: {
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            controls: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (!cancelled) setPlayerReady(true);
            },
            onError: (event: { data: unknown }) => {
              if (cancelled) return;
              const failure = youtubeProvider.classifyPlayerError(event.data);
              // Sanitized diagnostic only — never the raw provider payload.
              console.warn("[playback] provider error", failure.diagnostic);
              setProviderFailure(failure);
            },
            onStateChange: (event: { data: number }) => {
              const current = stateRef.current;
              const YTState = window.YT?.PlayerState;
              if (!YTState || !current) return;

              // Autoplay refusal shows up as "not playing" after we asked to
              // play. Handled locally; never a mutation.
              if (
                event.data === YTState.PLAYING &&
                gestureRef.current &&
                current.playback_status === "playing"
              ) {
                setGesture(false);
              }

              if (
                !playerEventMayMutate({
                  canControl,
                  roomActive,
                  applyingRemote: applyingRemote.current,
                  awaitingGesture: gestureRef.current,
                  eventMediaId: loadedVideo.current,
                  authoritativeMediaId: current.provider_media_id,
                })
              ) {
                return;
              }

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
      .catch((error: Error) => {
        if (cancelled) return;
        setProviderFailure(
          providerError(
            "player_init_failed",
            error.message === "api-load" ? "api:load" : "api:init",
          ),
        );
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
    if (!playerReady || !state) return;
    if (state.version <= appliedVersion.current) return; // out-of-order / duplicate
    appliedVersion.current = state.version;
    applyPlanRef.current(state);
  }, [playerReady, state]);

  // ---- autoplay detection: one bounded check, never a retry loop
  useEffect(() => {
    if (!playerReady || state?.playback_status !== "playing") {
      if (state && state.playback_status !== "playing") setGesture(false);
      return;
    }
    const timer = setTimeout(() => {
      const local = snapshot();
      if (
        playAttemptAt.current > 0 &&
        Date.now() - playAttemptAt.current >= AUTOPLAY_GRACE_MS &&
        !local.playing
      ) {
        setGesture(true);
      }
    }, AUTOPLAY_GRACE_MS + 100);
    return () => clearTimeout(timer);
  }, [playerReady, setGesture, snapshot, state]);

  // ---- bounded drift correction: local seeks only, never a database write
  useEffect(() => {
    if (!playerReady) return;
    const id = setInterval(() => {
      const player = playerRef.current;
      const current = stateRef.current;
      if (!player || !current || current.playback_status !== "playing" || gestureRef.current) {
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

  /** Manual resync: refresh authoritative state + clock, then reconcile locally. */
  const onResync = useCallback(() => {
    playback.resync("manual_resync");
    appliedVersion.current = -1;
    setProviderFailure(null);
    applyPlanRef.current(stateRef.current);
  }, [playback]);

  /** The user-gesture path. Recalculates position before playing. */
  const onTapToSync = useCallback(() => {
    setGesture(false);
    appliedVersion.current = -1;
    playAttemptAt.current = Date.now();
    applyPlanRef.current(stateRef.current);
    playerRef.current?.playVideo();
  }, [setGesture]);

  const status = syncLabel({
    authorized: playback.authorized,
    connected: playback.connected,
    syncing: drifting || !playerReady,
  });

  const controllerLabel = useMemo(() => {
    if (!state?.controlled_by) return "Nobody has controlled playback yet";
    return state.controlled_by === userId
      ? "You control playback"
      : "A host or controller is in charge";
  }, [state?.controlled_by, userId]);

  const onSubmitUrl = (event: React.FormEvent) => {
    event.preventDefault();
    const id = youtubeProvider.parseReference(urlInput);
    if (!id) {
      toast.error(providerError("invalid_id", "parse").message);
      return;
    }
    setUrlInput("");
    mutate({ kind: "media", mediaId: id });
  };

  const busy = mutation.isPending;

  const overlay = (() => {
    if (providerFailure) return providerFailure.message;
    if (!playback.authorized) return "You no longer have access to this room's playback.";
    if (!playerReady) return "Starting the player…";
    if (playback.isPending || metadataPending) return "Loading playback state…";
    if (!state?.provider_media_id) return "No video selected yet.";
    if (!playback.connected) return "Connection lost — trying to reconnect…";
    return null;
  })();

  const policyStatus = state?.provider_media_id ? policy?.status ?? null : null;

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
          <Button variant="outline" size="sm" onClick={onResync}>
            <RefreshCw className="size-4" aria-hidden="true" /> Resync
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-muted/40">
        <div className="relative aspect-video w-full">
          <div ref={containerRef} className="absolute inset-0 size-full" />
          {overlay ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/85 p-4 text-center text-sm text-muted-foreground">
              {overlay}
            </div>
          ) : null}
          {!overlay && awaitingGesture ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 p-4 text-center">
              <p className="text-sm font-medium">Ready to sync</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Your device needs a tap before it can start playing. The room keeps playing for
                everyone else.
              </p>
              <Button className="pointer-events-auto" size="sm" onClick={onTapToSync}>
                <Play className="size-4" aria-hidden="true" /> Tap to Sync &amp; Play
              </Button>
            </div>
          ) : null}
          {policyStatus && policyStatus !== "ok" ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 p-4 text-center">
              <p className="text-sm font-medium">This video can&apos;t be played here</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                {policyStatus === "made_for_kids"
                  ? "The video is marked Made for Kids and cannot be shared in this room."
                  : policyStatus === "not_embeddable"
                    ? "The owner has disabled embedding for this video."
                    : "The video is unavailable, private, or restricted."}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {state?.provider_media_id ? (
        <p className="mt-3 text-sm">
          <span className="font-medium">{metadata?.title ?? "Loading video details…"}</span>{" "}
          <span className="text-muted-foreground">
            · {state.playback_status} · v{state.version}
            {metadata?.source === "fallback" ? " · title unavailable from YouTube" : ""}
            {policy?.made_for_kids ? " · Made for Kids" : ""}
            {policy?.privacy_status ? ` · ${policy.privacy_status}` : ""}
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
