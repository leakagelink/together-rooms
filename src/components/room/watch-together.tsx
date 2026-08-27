import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  Trash2,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MediaSearchPanel } from "@/components/room/media-search-panel";
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
import { planPlayerSurface } from "@/lib/player-surface";
import { setPlaybackTrackingRestricted } from "@/lib/analytics";
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
  getIframe?: () => HTMLIFrameElement | null;
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
  /**
   * End-of-track report (music rooms). Carries the authoritative version the
   * device saw, so the database rejects every simultaneous report but one.
   */
  onTrackEnded?: (version: number) => void;
  /** Extra controls rendered under the player, e.g. queue transport. */
  transport?: React.ReactNode;
  /** Overrides the section heading for music rooms. */
  heading?: string;
}

export function WatchTogether({
  roomId,
  userId,
  canControl,
  roomActive,
  onTrackEnded,
  transport,
  heading,
}: WatchTogetherProps) {
  const playback = useRoomPlayback(roomId, userId);
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const applyingRemote = useRef(false);
  const appliedVersion = useRef<number>(-1);
  const loadedVideo = useRef<string | null>(null);
  const lastCorrection = useRef(0);
  const playAttemptAt = useRef(0);
  const gestureRef = useRef(false);

  const [playerReady, setPlayerReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [providerFailure, setProviderFailure] = useState<ProviderError | null>(null);
  const [drifting, setDrifting] = useState(false);
  const [awaitingGesture, setAwaitingGesture] = useState(false);

  const state = playback.state;
  const stateRef = useRef<PlaybackState | null>(null);
  stateRef.current = state;

  const endedRef = useRef(onTrackEnded);
  endedRef.current = onTrackEnded;
  const endedForVersion = useRef(-1);

  const {
    metadata,
    policy,
    isPending: metadataPending,
  } = useProviderMetadata(state?.provider_media_id ?? null);

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

  // ---- fullscreen: prefer the native Fullscreen API. Some embedding contexts
  // (preview iframes without the `fullscreen` permission) reject the request —
  // there we fall back to an in-app theatre mode that fills the viewport.
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) setIsFullscreen(true);
      else if (!theatreRef.current) setIsFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !theatreRef.current) return;
      theatreRef.current = false;
      setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const node = stageRef.current;
    if (!node) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (theatreRef.current) {
      theatreRef.current = false;
      setIsFullscreen(false);
      return;
    }

    const request =
      node.requestFullscreen?.bind(node) ??
      (node as unknown as { webkitRequestFullscreen?: () => Promise<void> })
        .webkitRequestFullscreen?.bind(node);

    const enterTheatre = () => {
      theatreRef.current = true;
      setIsFullscreen(true);
    };

    if (!request) {
      enterTheatre();
      return;
    }
    void Promise.resolve(request()).catch(() => {
      // Blocked (e.g. embedded preview without fullscreen permission).
      enterTheatre();
    });
  }, []);

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
            fs: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              const frame = playerRef.current?.getIframe?.();
              if (frame) {
                frame.setAttribute("allowfullscreen", "");
                frame.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
              }
              setPlayerReady(true);
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

              // End of track: report once per authoritative version. The
              // database resolves simultaneous reports via expected_version.
              if (event.data === YTState.ENDED) {
                if (endedRef.current && endedForVersion.current !== current.version) {
                  endedForVersion.current = current.version;
                  endedRef.current(current.version);
                }
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

  // ---- background playback prevention: pause the local player only,
  //      never mutate the room's authoritative state. Returning to the tab
  //      triggers a normal resync path.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.hidden && playerRef.current) {
        suppress(() => playerRef.current?.pauseVideo());
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [suppress]);

  // ---- Made for Kids: suppress playback analytics while such media is active.
  useEffect(() => {
    setPlaybackTrackingRestricted(Boolean(policy?.tracking_restricted));
    return () => setPlaybackTrackingRestricted(false);
  }, [policy?.tracking_restricted]);

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

  const onPickMedia = useCallback(
    (mediaId: string) => {
      mutate({ kind: "media", mediaId });
    },
    [mutate],
  );

  /** Relative seek from the device's current position, applied room-wide. */
  const onNudge = useCallback(
    (delta: number) => {
      const base = playerRef.current?.getCurrentTime() ?? stateRef.current?.position_seconds ?? 0;
      mutate({ kind: "seek", position: Math.max(0, base + delta) });
    },
    [mutate],
  );

  const busy = mutation.isPending;

  const policyStatus = state?.provider_media_id ? (policy?.status ?? null) : null;

  const surface = planPlayerSurface({
    providerFailure: providerFailure?.message ?? null,
    authorized: playback.authorized,
    playerReady,
    loading: playback.isPending || metadataPending,
    hasMedia: Boolean(state?.provider_media_id),
    connected: playback.connected,
    awaitingGesture,
    policyStatus,
  });

  return (
    <section className="surface-panel mt-8 p-4 sm:p-5" aria-labelledby="watch-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="watch-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Youtube className="size-5" aria-hidden="true" /> {heading ?? "Watch together"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Playback is kept close across devices from the room&apos;s saved state. It is not
            frame-accurate.
          </p>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
          <Badge variant="secondary" role="status">
            {status}
          </Badge>
          <Button variant="outline" size="sm" onClick={onResync}>
            <RefreshCw className="size-4" aria-hidden="true" /> Resync
          </Button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="group mt-4 overflow-hidden rounded-lg border border-border bg-black/90 data-[fs=true]:rounded-none data-[fs=true]:border-0"
        data-fs={isFullscreen}
      >
        <div
          className={
            isFullscreen
              ? "relative h-screen w-full"
              : "relative aspect-video w-full"
          }
        >
          <div ref={containerRef} className="absolute inset-0 size-full" />
          {/*
            Integrity rule: an overlay is only ever rendered while no video is
            loaded in the frame. Notices and the gesture prompt live below.
          */}
          {surface.overlay ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/85 p-4 text-center text-sm text-muted-foreground">
              {surface.overlay}
            </div>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute bottom-3 right-3 z-10 size-9 opacity-80 hover:opacity-100"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="size-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {surface.gesturePrompt ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <div className="min-w-40 flex-1">
            <p className="text-sm font-medium">Ready to sync</p>
            <p className="text-xs text-muted-foreground">
              Your device needs a tap before it can start playing. The room keeps playing for
              everyone else.
            </p>
          </div>
          <Button size="sm" onClick={onTapToSync}>
            <Play className="size-4" aria-hidden="true" /> Tap to Sync &amp; Play
          </Button>
        </div>
      ) : null}

      {surface.notices.map((notice) => (
        <p
          key={notice.id}
          role="status"
          className={
            notice.tone === "warning"
              ? "mt-3 rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground"
              : "mt-3 rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground"
          }
        >
          {notice.message}
        </p>
      ))}

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

      {transport ? <div className="mt-4">{transport}</div> : null}

      {canControl && roomActive ? (
        <div className="mt-4 space-y-4">
          <MediaSearchPanel onPick={onPickMedia} disabled={busy} actionLabel="Play in room" />

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
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
              onClick={() => onNudge(-10)}
            >
              <SkipBack className="size-4" aria-hidden="true" /> −10s
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !state?.provider_media_id}
              onClick={() => onNudge(10)}
            >
              <SkipForward className="size-4" aria-hidden="true" /> +10s
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !state?.provider_media_id}
              onClick={() => mutate({ kind: "seek", position: 0 })}
            >
              <Rewind className="size-4" aria-hidden="true" /> Restart
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
