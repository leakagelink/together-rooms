import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { CHAT_PAGE_SIZE, type ChatMessage, type ChatReaction } from "@/lib/chat-constants";
import { queryKeys } from "@/lib/query-keys";

/**
 * Projection is explicit and narrow. `original_content` no longer exists on
 * this table at all — removed plaintext lives in the staff-only
 * `message_moderation_archive`, so neither SELECT nor REPLICA IDENTITY FULL
 * realtime payloads can leak it.
 */
const MESSAGE_COLUMNS =
  "id, room_id, sender_id, parent_message_id, content, content_type, status, system_code, edited_at, deleted_at, created_at";

/** How many rows a reconnect catch-up may pull. Bounded on purpose. */
const CATCHUP_LIMIT = 200;

export interface ChatCursor {
  created_at: string;
  id: string;
}

export interface ChatPage {
  /** Newest-first slice of room history. */
  messages: ChatMessage[];
  next: ChatCursor | null;
}

/** Cursor pagination over (created_at DESC, id DESC), matching the table index. */
async function fetchPage(roomId: string, cursor: ChatCursor | null): Promise<ChatPage> {
  let query = supabase
    .from("room_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHAT_PAGE_SIZE);

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  const messages = (data ?? []) as unknown as ChatMessage[];
  const last = messages.at(-1);
  return {
    messages,
    next:
      messages.length === CHAT_PAGE_SIZE && last
        ? { created_at: last.created_at, id: last.id }
        : null,
  };
}

type ChatData = InfiniteData<ChatPage, ChatCursor | null>;

export interface RoomChatState {
  messages: ChatMessage[];
  reactions: Record<string, ChatReaction[]>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  refetch: () => void;
  /** Realtime transport state for the room_messages postgres_changes stream. */
  connected: boolean;
  authorized: boolean;
  refreshReactions: () => void;
}

/**
 * Database-backed room chat.
 *
 * History is read through RLS-protected SELECTs with cursor pagination; live
 * updates arrive over Supabase postgres_changes (INSERT/UPDATE on
 * room_messages and any change on message_reactions), filtered per row by the
 * same RLS policies. No Broadcast and no Presence are used anywhere: every
 * message a client renders exists as a database row first.
 *
 * Subscription lifecycle: the channel is created once per (roomId, userId).
 * Handlers read mutable state through refs, so new messages never invalidate
 * the effect and never tear down the socket. On every (re)SUBSCRIBED
 * transition a bounded catch-up query backfills anything inserted while the
 * socket was down. All merges are keyed by primary key, so a row delivered
 * twice renders once.
 */
export function useRoomChat(roomId: string, userId: string | undefined): RoomChatState {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [reactions, setReactions] = useState<Record<string, ChatReaction[]>>({});
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useInfiniteQuery<ChatPage, Error, ChatData, readonly unknown[], ChatCursor | null>({
    queryKey: queryKeys.chat.messages(roomId),
    queryFn: ({ pageParam }) => fetchPage(roomId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.next,
    enabled: Boolean(roomId && userId),
  });

  const messages = query.data?.pages.flatMap((p) => p.messages) ?? [];
  const ids = messages.map((m) => m.id).join(",");

  /** Newest known row timestamp — the catch-up watermark. Held in a ref so the
   *  realtime effect never depends on message content. */
  const watermark = useRef<string | null>(null);
  const newest = messages[0]?.created_at ?? null;
  if (newest && (!watermark.current || newest > watermark.current)) watermark.current = newest;

  const loadReactions = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      setReactions({});
      return;
    }
    const { data, error } = await supabase
      .from("message_reactions")
      .select("id, message_id, user_id, reaction")
      .in("message_id", messageIds);
    if (error) return;
    const grouped: Record<string, ChatReaction[]> = {};
    for (const row of (data ?? []) as unknown as ChatReaction[]) {
      (grouped[row.message_id] ??= []).push(row);
    }
    setReactions(grouped);
  }, []);

  // One batched reaction query per loaded message set — never one per message.
  useEffect(() => {
    void loadReactions(ids ? ids.split(",") : []);
  }, [ids, loadReactions]);

  const refreshReactions = useCallback(() => {
    void loadReactions(ids ? ids.split(",") : []);
  }, [ids, loadReactions]);

  /** Ref indirection keeps the realtime effect independent of loaded ids. */
  const refreshReactionsRef = useRef(refreshReactions);
  refreshReactionsRef.current = refreshReactions;

  const mergeMessages = useCallback(
    (rows: ChatMessage[]) => {
      if (rows.length === 0) return;
      queryClient.setQueryData<ChatData>(queryKeys.chat.messages(roomId), (prev) => {
        if (!prev) return prev;
        const known = new Set(prev.pages.flatMap((p) => p.messages.map((m) => m.id)));
        const updates = new Map(rows.map((r) => [r.id, r]));
        // Update-in-place for rows we already hold (edits, soft deletes).
        const pages = prev.pages.map((p) => ({
          ...p,
          messages: p.messages.map((m) => {
            const hit = updates.get(m.id);
            return hit ? { ...m, ...hit } : m;
          }),
        }));
        // Everything genuinely new goes on the newest page, de-duplicated by id.
        const fresh = rows.filter((r) => !known.has(r.id));
        if (fresh.length === 0) return { ...prev, pages };
        const [first, ...rest] = pages;
        if (!first) return { ...prev, pages };
        const merged = [...fresh, ...first.messages].sort((a, b) =>
          a.created_at === b.created_at
            ? b.id.localeCompare(a.id)
            : a.created_at < b.created_at
              ? 1
              : -1,
        );
        return { ...prev, pages: [{ ...first, messages: merged }, ...rest] };
      });
      for (const row of rows) {
        if (!watermark.current || row.created_at > watermark.current) {
          watermark.current = row.created_at;
        }
      }
    },
    [queryClient, roomId],
  );

  const mergeRef = useRef(mergeMessages);
  mergeRef.current = mergeMessages;

  /**
   * Reconnect reconciliation: pull anything at or after the watermark instead
   * of trusting socket replay. Bounded by CATCHUP_LIMIT; if the gap is larger
   * we fall back to a full refetch of the newest page.
   */
  const catchUp = useCallback(async () => {
    const since = watermark.current;
    if (!since) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(roomId) });
      return;
    }
    const { data, error } = await supabase
      .from("room_messages")
      .select(MESSAGE_COLUMNS)
      .eq("room_id", roomId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(CATCHUP_LIMIT);
    if (error) return;
    const rows = (data ?? []) as unknown as ChatMessage[];
    if (rows.length >= CATCHUP_LIMIT) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(roomId) });
      return;
    }
    mergeRef.current(rows);
    refreshReactionsRef.current();
  }, [queryClient, roomId]);

  const catchUpRef = useRef(catchUp);
  catchUpRef.current = catchUp;

  const scheduleReactionRefresh = useCallback(() => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => refreshReactionsRef.current(), 250);
  }, []);

  const scheduleReactionRefreshRef = useRef(scheduleReactionRefresh);
  scheduleReactionRefreshRef.current = scheduleReactionRefresh;

  // Realtime effect: depends only on identity of the room + viewer, so a new
  // message can never recreate the channel.
  useEffect(() => {
    if (!roomId || !userId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    void (async () => {
      // Server-side gate: the database decides whether this user may observe
      // the room stream at all. Row payloads are additionally RLS-filtered.
      const { data: allowed, error } = await supabase.rpc("authorize_room_channel", {
        _room_id: roomId,
      });
      if (cancelled) return;
      if (error || allowed !== true) {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);

      channel = supabase
        .channel(`room-chat:${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") {
              void queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(roomId) });
              return;
            }
            mergeRef.current([payload.new as unknown as ChatMessage]);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "message_reactions",
            filter: `room_id=eq.${roomId}`,
          },
          () => scheduleReactionRefreshRef.current(),
        )
        .subscribe((status) => {
          if (cancelled) return;
          const live = status === "SUBSCRIBED";
          setConnected(live);
          // Fires on the first subscribe and again after every reconnect.
          if (live) void catchUpRef.current();
        });
    })();

    // App resume / network restoration: reconcile without touching the socket.
    const onWake = () => {
      if (document.visibilityState === "visible") void catchUpRef.current();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      setConnected(false);
      setAuthorized(false);
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [roomId, userId, queryClient]);

  return {
    messages,
    reactions,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    hasOlder: Boolean(query.hasNextPage),
    loadingOlder: query.isFetchingNextPage,
    loadOlder: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
    connected,
    authorized,
    refreshReactions,
  };
}
