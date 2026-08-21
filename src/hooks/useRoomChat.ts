import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { CHAT_PAGE_SIZE, type ChatMessage, type ChatReaction } from "@/lib/chat-constants";
import { queryKeys } from "@/lib/query-keys";

const MESSAGE_COLUMNS =
  "id, room_id, sender_id, parent_message_id, content, content_type, status, system_code, edited_at, deleted_at, created_at";

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
 * Duplicate protection: realtime rows are merged by primary key, so a row that
 * arrives both from a refetch and from the socket appears once.
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

  const loadReactions = useCallback(
    async (messageIds: string[]) => {
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
    },
    [setReactions],
  );

  // One batched reaction query per loaded message set — never one per message.
  useEffect(() => {
    void loadReactions(ids ? ids.split(",") : []);
  }, [ids, loadReactions]);

  const refreshReactions = useCallback(() => {
    void loadReactions(ids ? ids.split(",") : []);
  }, [ids, loadReactions]);

  const scheduleReactionRefresh = useCallback(() => {
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => void loadReactions(ids ? ids.split(",") : []), 250);
  }, [ids, loadReactions]);

  const upsertMessage = useCallback(
    (row: ChatMessage) => {
      queryClient.setQueryData<ChatData>(queryKeys.chat.messages(roomId), (prev) => {
        if (!prev) return prev;
        const exists = prev.pages.some((p) => p.messages.some((m) => m.id === row.id));
        if (exists) {
          return {
            ...prev,
            pages: prev.pages.map((p) => ({
              ...p,
              messages: p.messages.map((m) => (m.id === row.id ? { ...m, ...row } : m)),
            })),
          };
        }
        const [first, ...rest] = prev.pages;
        if (!first) return prev;
        return {
          ...prev,
          pages: [{ ...first, messages: [row, ...first.messages] }, ...rest],
        };
      });
    },
    [queryClient, roomId],
  );

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
            upsertMessage(payload.new as unknown as ChatMessage);
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
          () => scheduleReactionRefresh(),
        )
        .subscribe((status) => {
          if (!cancelled) setConnected(status === "SUBSCRIBED");
        });
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      setAuthorized(false);
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [roomId, userId, queryClient, upsertMessage, scheduleReactionRefresh]);

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
