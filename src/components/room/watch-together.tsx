import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Rewind,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Trash2,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MediaSearchPanel } from "@/components/room/media-search-panel";
import { ShortsReelPanel, useShortsReel } from "@/components/room/shorts-reel";
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
import {
  AUDIO_MODE_NOTICE,
  BACKGROUND_PAUSE_NOTICE,
  isCompliantPlayerVars,
  planBackgroundEnforcement,
  YOUTUBE_COMPLIANCE_LIMITS,
} from "@/lib/youtube-compliance";
import { setPlaybackTrackingRestricted } from "@/lib/analytics";
import { providerError, type ProviderError } from "@/lib/providers/media-provider";
import { youtubeProvider } from "@/lib/providers/youtube";
import {
  shouldPublishWatchMode,
  toWatchMode,
  type WatchMode,
} from "@/lib/shorts";
import {
  clearRoomMedia,
  pauseRoomMedia,
  playRoomMedia,
  seekRoomMedia,
  setRoomMedia,
  setRoomWatchMode,
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

/** The only player configuration allowed by the YouTube compliance gate. */
const COMPLIANT_PLAYER_VARS = {
  rel: 0,
  playsinline: 1,
  modestbranding: 1,
  controls: 1,
  fs: 1,
} as const;

export interface WatchTogetherProps {
  roomId: string;
  /** Shareable join code shown in the player header so viewers can invite others. */
  roomCode?: string | null | undefined;
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
  /**
   * Music-only presentation. The YouTube frame stays mounted and visible (a
   * policy requirement) but collapses to a mini player so the queue and
   * transport lead the UI. Users can expand the video at any time.
   */
  audioMode?: boolean;
  /**
   * Mini-player queue context (music rooms). `label` summarises the queue,
   * e.g. "Track 3 of 12". The callbacks drive the authoritative queue RPCs
   * so the sharer can change tracks without leaving the mini player.
   */
  queueStatus?: { label: string; live: boolean };
  onPreviousTrack?: () => void;
  onNextTrack?: () => void;
  /** Disables the mini-player controls while a queue mutation is in flight. */
  trackNavBusy?: boolean;
  /**
   * Fires whenever the search/filter panel opens or closes. The room shell uses
   * it to lift the Chat/People/Share tabs right under the video once search
   * collapses.
   */
  onSearchVisibilityChange?: (open: boolean) => void;
}

export function WatchTogether({
  roomId,
  roomCode,
  userId,
  canControl,
  roomActive,
  onTrackEnded,
  transport,
  heading,
  audioMode = false,
  queueStatus,
  onPreviousTrack,
  onNextTrack,
  trackNavBusy = false,
  onSearchVisibilityChange,
}: WatchTogetherProps) {
  const playback = useRoomPlayback(roomId, userId);
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const theatreRef = useRef(false);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const applyingRemote = useRef(false);
  const appliedVersion = useRef<number>(-1);
  const loadedVideo = useRef<string | null>(null);
  const lastCorrection = useRef(0);
  const playAttemptAt = useRef(0);
  const gestureRef = useRef(false);

  const [playerReady, setPlayerReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [providerFailure, setProviderFailure] = useState<ProviderError | null>(null);
  const [drifting, setDrifting] = useState(false);
  const [awaitingGesture, setAwaitingGesture] = useState(false);
  const [backgroundPaused, setBackgroundPaused] = useState(false);

  const state = playback.state;
  const stateRef = useRef<PlaybackState | null>(null);
  stateRef.current = state;

  // Search panel: derived from playback so it is hidden whenever a video is
  // loaded, regardless of mount order. A manual toggle overrides the default
  // until the media changes again.
  const hasMedia = Boolean(state?.provider_media_id);
  /**
   * Shorts Together: framing only. The mode travels on the same authoritative
   * room playback row everyone already subscribes to, so joiners land on the
   * room's current mode, current Short and current playback state.
   */
  const watchMode: WatchMode = toWatchMode(state?.watch_mode);
  const shortsMode = watchMode === "shorts" && !audioMode;
  const [searchOverride, setSearchOverride] = useState<boolean | null>(null);
  const searchOpen = searchOverride ?? !hasMedia;
  // Functional toggle: it always flips the *currently rendered* state, even if
  // an auto-collapse (media change or playback start) reset the override
  // between the render and the click.
  const hasMediaRef = useRef(hasMedia);
  hasMediaRef.current = hasMedia;
  const toggleSearch = useCallback(() => {
    setSearchOverride((previous) => !(previous ?? !hasMediaRef.current));
  }, []);
  const lastMediaRef = useRef<string | null>(state?.provider_media_id ?? null);

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
  const setMode = useServerFn(setRoomWatchMode);

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
        | { kind: "clear" }
        | { kind: "mode"; mode: WatchMode },
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
        case "mode":
          return setMode({ data: { room_id: roomId, watch_mode: action.mode, expected_version } });
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
  const shortsModeRef = useRef(false);
  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement;
      // In Shorts mode the player's own fullscreen hides the app's swipe rail,
      // so we re-target fullscreen to the stage (which contains the official
      // player unchanged) — nothing about the player UI is altered.
      if (
        fs &&
        shortsModeRef.current &&
        stageRef.current &&
        fs !== stageRef.current &&
        stageRef.current.contains(fs)
      ) {
        void Promise.resolve(document.exitFullscreen?.())
          .then(() => stageRef.current?.requestFullscreen?.())
          .catch(() => undefined);
        setIsFullscreen(true);
        return;
      }
      if (fs) setIsFullscreen(true);
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
      (
        node as unknown as { webkitRequestFullscreen?: () => Promise<void> }
      ).webkitRequestFullscreen?.bind(node);

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
        // Compliance gate: never construct a player from a configuration that
        // could hide the video surface or imply audio-only extraction.
        if (!isCompliantPlayerVars(COMPLIANT_PLAYER_VARS)) {
          setProviderFailure(providerError("player_init_failed", "policy:player_vars"));
          return;
        }
        playerRef.current = new YT.Player(el, {
          host: youtubeProvider.embedHost,
          width: "100%",
          height: "100%",
          playerVars: { ...COMPLIANT_PLAYER_VARS, origin: window.location.origin },
          events: {
            onReady: () => {
              if (cancelled) return;
              const frame = playerRef.current?.getIframe?.();
              if (frame) {
                frame.setAttribute("allowfullscreen", "");
                frame.setAttribute(
                  "allow",
                  "autoplay; encrypted-media; fullscreen; picture-in-picture",
                );
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

  // ---- YouTube ToS: no background playback, no audio-only extraction.
  // When the app is backgrounded the local player is paused. This is a LOCAL
  // pause only — the authoritative room state is untouched, so everyone else
  // keeps watching.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      const player = playerRef.current;
      if (!player) return;
      const enforcement = planBackgroundEnforcement({
        visibility: document.visibilityState === "hidden" ? "hidden" : "visible",
        hasMedia: Boolean(stateRef.current?.provider_media_id),
        locallyPlaying: snapshot().playing,
      });
      if (!enforcement.pauseLocally) return;
      suppress(() => player.pauseVideo());
      setBackgroundPaused(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [snapshot, suppress]);

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

  // Drop any manual override whenever the loaded video changes, so the panel
  // falls back to "hidden while playing / shown when empty".
  useEffect(() => {
    const current = state?.provider_media_id ?? null;
    if (current !== lastMediaRef.current) {
      lastMediaRef.current = current;
      setSearchOverride(null);
    }
  }, [state?.provider_media_id]);

  // Playback actually starting collapses the panel too, so a manually opened
  // search never covers the video once it is running. The user can reopen it
  // with the toggle at any time.
  const lastStatusRef = useRef(state?.playback_status ?? null);
  useEffect(() => {
    const status = state?.playback_status ?? null;
    const previous = lastStatusRef.current;
    lastStatusRef.current = status;
    if (status === "playing" && previous !== "playing") setSearchOverride(null);
  }, [state?.playback_status]);

  // Tell the room shell whether the search surface is taking vertical space, so
  // it can pull the Chat/People/Share tabs up right under the video.
  const searchVisible = searchOpen && canControl && roomActive;
  const searchVisibilityRef = useRef(onSearchVisibilityChange);
  searchVisibilityRef.current = onSearchVisibilityChange;
  useEffect(() => {
    searchVisibilityRef.current?.(searchVisible);
  }, [searchVisible]);



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

  /**
   * Shorts reel: an in-app picker over official YouTube search results. Moving
   * between Shorts writes through the same authoritative playback RPC, so every
   * member follows along; only a controller can swipe.
   */
  const shortsReel = useShortsReel(
    shortsMode && canControl && roomActive,
    state?.provider_media_id ?? null,
    onPickMedia,
  );

  /**
   * Vertical swipe / wheel navigation (controllers only).
   *
   * The official player runs inside an iframe, so touch events over the video
   * never reach this document. Navigation therefore listens on thin gutters at
   * the left and right edges of the portrait stage: they sit clear of the
   * player's own controls, add no visual overlay on the video, and never
   * intercept taps on YouTube's UI or ads.
   */
  const swipeStart = useRef<{ y: number; t: number } | null>(null);
  const pointerSwipeStart = useRef<{ id: number; y: number; t: number } | null>(null);
  const wheelAt = useRef(0);
  const navAt = useRef(0);
  const swipeEnabled = shortsMode && canControl && roomActive;

  const navigateShort = useCallback(
    (direction: 1 | -1) => {
      if (!swipeEnabled) return;
      if (shortsReel.items.length === 0) {
        toast.message(
          shortsReel.loading
            ? "Loading Shorts…"
            : "Search Shorts below to swipe between them.",
        );
        return;
      }
      const now = Date.now();
      if (now - navAt.current < 600) return;
      navAt.current = now;
      if (direction === 1) shortsReel.goNext();
      else shortsReel.goPrevious();
    },
    [swipeEnabled, shortsReel],
  );

  const onStageTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (!swipeEnabled) return;
      const touch = event.touches[0];
      if (touch) swipeStart.current = { y: touch.clientY, t: Date.now() };
    },
    [swipeEnabled],
  );
  const onStageTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      if (!swipeEnabled) return;
      const start = swipeStart.current;
      swipeStart.current = null;
      const touch = event.changedTouches[0];
      if (!start || !touch) return;
      const delta = start.y - touch.clientY;
      if (Math.abs(delta) < 40 || Date.now() - start.t > 1200) return;
      navigateShort(delta > 0 ? 1 : -1);
    },
    [swipeEnabled, navigateShort],
  );
  const onStageWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!swipeEnabled || Math.abs(event.deltaY) < 30) return;
      const now = Date.now();
      if (now - wheelAt.current < 600) return;
      wheelAt.current = now;
      navigateShort(event.deltaY > 0 ? 1 : -1);
    },
    [swipeEnabled, navigateShort],
  );

  const onSwipePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!swipeEnabled || event.pointerType === "mouse") return;
      pointerSwipeStart.current = {
        id: event.pointerId,
        y: event.clientY,
        t: Date.now(),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [swipeEnabled],
  );

  const onSwipePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerSwipeStart.current;
      pointerSwipeStart.current = null;
      if (!swipeEnabled || !start || start.id !== event.pointerId) return;
      const delta = start.y - event.clientY;
      if (Math.abs(delta) < 36 || Date.now() - start.t > 1400) return;
      navigateShort(delta > 0 ? 1 : -1);
    },
    [navigateShort, swipeEnabled],
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

  const compact = audioMode && !videoExpanded && !isFullscreen;

  return (
    <section className="surface-panel mt-8 p-4 sm:p-5" aria-labelledby="watch-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="watch-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Youtube className="size-5" aria-hidden="true" /> {heading ?? "Watch together"}
          </h2>
          <button
            type="button"
            onClick={() => {
              const code = roomCode ?? roomId;
              void navigator.clipboard
                .writeText(code)
                .then(() => toast.success("Room ID copied"))
                .catch(() => toast.error("Copy failed"));
            }}
            className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Copy room ID"
            aria-label="Copy room ID"
          >
            <span className="font-sans text-[10px] uppercase tracking-wide">Room</span>
            <span className="truncate tracking-wider">{roomCode ?? roomId}</span>
            <Copy className="size-3 shrink-0" aria-hidden="true" />
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            {audioMode
              ? AUDIO_MODE_NOTICE
              : "Playback is kept close across devices from the room's saved state. It is not frame-accurate."}
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

      {!audioMode ? (
        <div
          className="mt-4 inline-flex rounded-lg border border-border bg-muted/40 p-1"
          role="group"
          aria-label="Watch mode"
        >
          {(["video", "shorts"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={watchMode === mode ? "secondary" : "ghost"}
              aria-pressed={watchMode === mode}
              disabled={!canControl || !roomActive || busy}
              onClick={() => {
                // Loop guard: only a real change is published.
                if (!shouldPublishWatchMode(watchMode, mode)) return;
                mutate({ kind: "mode", mode });
              }}
            >
              {mode === "video" ? "Videos" : "Shorts"}
            </Button>
          ))}
        </div>
      ) : null}


      <div
        ref={stageRef}
        onTouchStart={onStageTouchStart}
        onTouchEnd={onStageTouchEnd}
        onWheel={onStageWheel}

        className={
          isFullscreen
            ? "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-stage"
            : compact
              ? "group mt-4 flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-card p-2"
              : shortsMode
                ? "group mt-4 flex justify-center overflow-hidden rounded-xl border border-border bg-stage"
                : "group mt-4 overflow-hidden rounded-xl border border-border bg-stage"
        }
      >
        {/*
          Shorts framing: a portrait 9:16 box. The official player letterboxes
          inside it, so the real video aspect ratio is preserved — nothing is
          stretched, cropped or re-rendered by the app.
        */}
        <div
          className={
            isFullscreen
              ? shortsMode
                ? "relative aspect-[9/16] h-full max-h-full max-w-full"
                : "relative h-full max-h-full w-full"
              : compact
                ? "relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-stage sm:w-36"
                : shortsMode
                  ? "relative aspect-[9/16] min-w-0 flex-1 max-w-[26rem]"
                  : "relative aspect-video w-full"
          }
        >
          <div ref={containerRef} className="absolute inset-0 size-full" />
          {/*
            Integrity rule: an overlay is only ever rendered while no video is
            loaded in the frame. Notices and the gesture prompt live below.
          */}
          {surface.overlay ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/85 p-2 text-center text-xs text-muted-foreground sm:text-sm">
              {surface.overlay}
            </div>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className={
              compact
                ? "hidden"
                : "absolute bottom-3 right-3 z-10 size-9 opacity-80 hover:opacity-100"
            }
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
        {swipeEnabled && !compact ? (
          <div
            role="presentation"
            aria-label="Shorts navigation"
            onPointerDown={onSwipePointerDown}
            onPointerUp={onSwipePointerUp}
            onPointerCancel={() => {
              pointerSwipeStart.current = null;
            }}
            onWheel={onStageWheel}
            className="flex w-12 shrink-0 self-stretch touch-none select-none flex-col items-center justify-between border-l border-border bg-muted/50 py-3"
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-10 shrink-0"
              onClick={shortsReel.goPrevious}
              disabled={busy || shortsReel.items.length === 0}
              aria-label="Previous Short"
            >
              <ChevronUp className="size-5" aria-hidden="true" />
            </Button>
            <div className="flex flex-1 items-center justify-center" aria-hidden="true">
              <span className="h-12 w-1 rounded-full bg-muted-foreground/40" />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-10 shrink-0"
              onClick={shortsReel.goNext}
              disabled={busy || shortsReel.items.length === 0}
              aria-label="Next Short"
            >
              <ChevronDown className="size-5" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        {compact ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {state?.provider_media_id
                    ? (metadata?.title ?? "Loading track details…")
                    : "Nothing playing yet"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {state?.provider_media_id
                    ? `${state.playback_status}${policy?.made_for_kids ? " · Made for Kids" : ""}`
                    : "Add a track to the queue to start listening together."}
                </p>
                {queueStatus ? (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <span
                      className={
                        queueStatus.live
                          ? "inline-block size-1.5 shrink-0 rounded-full bg-primary"
                          : "inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                      }
                      aria-hidden="true"
                    />
                    {queueStatus.label}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-9 shrink-0"
                onClick={() => setVideoExpanded(true)}
                aria-label="Expand video"
              >
                <Maximize2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="flex items-center gap-1">
              {onPreviousTrack ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  disabled={!canControl || !roomActive || trackNavBusy || busy}
                  onClick={onPreviousTrack}
                  aria-label="Previous track"
                >
                  <SkipBack className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="size-10"
                disabled={!canControl || !roomActive || !state?.provider_media_id || busy}
                onClick={() =>
                  mutate({ kind: state?.playback_status === "playing" ? "pause" : "play" })
                }
                aria-label={state?.playback_status === "playing" ? "Pause" : "Play"}
              >
                {state?.playback_status === "playing" ? (
                  <Pause className="size-5" aria-hidden="true" />
                ) : (
                  <Play className="size-5" aria-hidden="true" />
                )}
              </Button>
              {onNextTrack ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  disabled={!canControl || !roomActive || trackNavBusy || busy}
                  onClick={onNextTrack}
                  aria-label="Next track"
                >
                  <SkipForward className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
              {trackNavBusy ? (
                <span className="ml-1 text-xs text-muted-foreground" role="status">
                  Updating…
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {audioMode && videoExpanded && !isFullscreen ? (
        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={() => setVideoExpanded(false)}>
            <Minimize2 className="size-4" aria-hidden="true" /> Minimise video
          </Button>
        </div>
      ) : null}

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

      {backgroundPaused ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
          <p role="status" className="min-w-40 flex-1 text-xs text-foreground">
            {BACKGROUND_PAUSE_NOTICE}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setBackgroundPaused(false);
              onResync();
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Resume &amp; resync
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

      {state?.provider_media_id && !compact ? (
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

      {canControl && roomActive && shortsMode ? (
        <ShortsReelPanel reel={shortsReel} disabled={busy} />
      ) : null}

      {canControl && roomActive && !shortsMode ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {hasMedia ? "Add another video" : "Pick a video to play"}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleSearch}
              aria-expanded={searchOpen}
              aria-controls="watch-search-panel"
              aria-label={searchOpen ? "Hide search" : "Search or add a video"}
            >
              {searchOpen ? (
                <>
                  <ChevronUp className="size-4" aria-hidden="true" /> Hide search
                </>
              ) : (
                <>
                  <Search className="size-4" aria-hidden="true" /> Search / Add video
                </>
              )}
            </Button>
          </div>

          {searchOpen ? (
            <div id="watch-search-panel">
              <MediaSearchPanel
                onPick={onPickMedia}
                disabled={busy}
                actionLabel={audioMode ? "Play now" : "Play in room"}
              />
            </div>
          ) : null}
        </div>
      ) : null}


      <details className="mt-3 rounded-md border border-border bg-muted/20 p-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          YouTube playback limits
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {YOUTUBE_COMPLIANCE_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </details>

      {transport ? <div className="mt-4">{transport}</div> : null}

      {canControl && roomActive ? (
        <div className="mt-4 space-y-4">
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
