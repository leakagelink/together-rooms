import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Radio, Send, X } from "lucide-react";
import { toast } from "sonner";

import { ChatMessageRow } from "@/components/room/chat-message";
import { EmptyState, ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRoomChat } from "@/hooks/useRoomChat";
import { track } from "@/lib/analytics";
import {
  MAX_MESSAGE_LENGTH,
  validateMessageContent,
  type ChatMessage,
  type ReactionKey,
} from "@/lib/chat-constants";
import {
  deleteRoomMessage,
  editRoomMessage,
  sendRoomMessage,
  toggleMessageReaction,
} from "@/lib/chat.functions";
import { errorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import type { RoomMemberEntry } from "@/lib/rooms.functions";
import { rpcMessage } from "@/lib/rpc-types";

interface Props {
  roomId: string;
  userId: string | undefined;
  members: RoomMemberEntry[];
  canModerate: boolean;
  /** False when the room ended/expired or the viewer is muted. */
  canInteract: boolean;
  disabledReason: string | null;
}

export function RoomChat({
  roomId,
  userId,
  members,
  canModerate,
  canInteract,
  disabledReason,
}: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chat = useRoomChat(roomId, userId);

  const send = useServerFn(sendRoomMessage);
  const edit = useServerFn(editRoomMessage);
  const remove = useServerFn(deleteRoomMessage);
  const react = useServerFn(toggleMessageReaction);

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.user_id, m.display_name);
    return map;
  }, [members]);

  const byId = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of chat.messages) map.set(m.id, m);
    return map;
  }, [chat.messages]);

  const nameFor = (id: string | null) => (id ? (nameMap.get(id) ?? "Member") : "System");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(roomId) });

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const result = await send({
        data: { room_id: roomId, content: text, parent_message_id: replyTo?.id ?? null },
      });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      return result;
    },
    onSuccess: async () => {
      void track("chat_message_sent");
      setDraft("");
      setReplyTo(null);
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const result = await edit({ data: { message_id: id, content } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await remove({ data: { message_id: id } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const reactMutation = useMutation({
    mutationFn: async ({ id, reaction }: { id: string; reaction: ReactionKey }) => {
      const result = await react({ data: { message_id: id, reaction } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
    },
    onSuccess: () => chat.refreshReactions(),
    onError: (error: Error) => toast.error(error.message),
  });

  function submit() {
    const parsed = validateMessageContent(draft);
    if (!parsed.ok) {
      toast.error("Write something first (max 2,000 characters).");
      return;
    }
    sendMutation.mutate(parsed.text);
  }

  // Oldest first for reading order; the query returns newest first.
  const ordered = [...chat.messages].reverse();

  return (
    <section className="surface-panel mt-8 flex flex-col p-0" aria-labelledby="chat-heading">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h2 id="chat-heading" className="text-lg font-semibold">
          Chat
        </h2>
        <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
          <Radio className={chat.connected ? "size-3 text-primary" : "size-3"} aria-hidden="true" />
          {!chat.authorized
            ? "Live updates unavailable"
            : chat.connected
              ? "Live"
              : "Reconnecting…"}
        </p>
      </header>

      <div className="flex max-h-[60dvh] min-h-64 flex-col-reverse overflow-y-auto p-4">
        {chat.isPending ? (
          <LoadingState label="Loading messages" rows={3} />
        ) : chat.isError ? (
          <ErrorState message={errorMessage(chat.error)} onRetry={chat.refetch} />
        ) : ordered.length === 0 ? (
          <EmptyState title="No messages yet" description="Say hello to start the conversation." />
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {ordered.map((message) => (
                <ChatMessageRow
                  key={message.id}
                  message={message}
                  parent={
                    message.parent_message_id ? byId.get(message.parent_message_id) : undefined
                  }
                  reactions={chat.reactions[message.id] ?? []}
                  currentUserId={userId}
                  nameFor={nameFor}
                  canModerate={canModerate}
                  canInteract={canInteract}
                  onReply={(m) => {
                    setReplyTo(m);
                    inputRef.current?.focus();
                  }}
                  onEdit={(id, content) => editMutation.mutate({ id, content })}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onReact={(id, reaction) => reactMutation.mutate({ id, reaction })}
                />
              ))}
            </ul>
            {chat.hasOlder ? (
              <div className="mb-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={chat.loadOlder}
                  disabled={chat.loadingOlder}
                >
                  {chat.loadingOlder ? "Loading…" : "Load older messages"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="border-t border-border p-4">
        {replyTo ? (
          <p className="mb-2 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
            <span className="truncate">
              Replying to {nameFor(replyTo.sender_id)}: {replyTo.content}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Cancel reply"
              onClick={() => setReplyTo(null)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </p>
        ) : null}

        {canInteract ? (
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              aria-label="Message"
              placeholder="Type a message…"
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={1}
              className="min-h-11 resize-none rounded-2xl bg-muted/50 px-4 py-3"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <Button
              onClick={submit}
              disabled={sendMutation.isPending}
              aria-label="Send message"
              className="size-11 shrink-0 rounded-full p-0 shadow-md"
            >
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {disabledReason ?? "You can't post in this room."}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {draft.length}/{MAX_MESSAGE_LENGTH} · Enter sends, Shift+Enter adds a line.
        </p>

      </div>
    </section>
  );
}
