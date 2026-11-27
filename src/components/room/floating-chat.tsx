import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle } from "lucide-react";

import { RoomChat } from "@/components/room/room-chat";
import type { RoomChatState } from "@/hooks/useRoomChat";
import { summarizeUnread, unreadBadgeLabel } from "@/lib/chat-unread";
import type { RoomMemberEntry } from "@/lib/rooms.functions";
import { cn } from "@/lib/utils";

interface Props {
  roomId: string;
  userId: string | undefined;
  members: RoomMemberEntry[];
  canModerate: boolean;
  canInteract: boolean;
  disabledReason: string | null;
  chat: RoomChatState;
  /** True while the full chat is on screen; those messages count as seen. */
  fullChatVisible: boolean;
  onOpenFullChat: () => void;
}

/**
 * Chat shortcut pinned to the left edge, vertically centred. Tapping it opens
 * a compact chat box (send, reply, voice notes). New messages from others show
 * as a red badge on the shortcut while the chat isn't on screen.
 */
export function FloatingChat({ chat, userId, fullChatVisible, onOpenFullChat, ...chatProps }: Props) {
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const newest = chat.messages[0]?.created_at ?? null;
  const seeing = open || fullChatVisible;

  // First load: everything already in the room counts as seen.
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current || chat.isPending) return;
    initialised.current = true;
    setSeenAt(newest ?? new Date(0).toISOString());
  }, [chat.isPending, newest]);

  useEffect(() => {
    if (seeing && newest && (!seenAt || newest > seenAt)) setSeenAt(newest);
  }, [seeing, newest, seenAt]);

  const unread = seeing ? { count: 0, hasReplyToMe: false } : summarizeUnread(chat.messages, userId, seenAt);
  const hasUnread = unread.count > 0;

  // Portal to <body>: animated page wrappers use transforms, which would pin a
  // fixed element to the page instead of the screen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <>
      {!open ? (
        <div className="fixed left-2 top-1/2 z-40 flex -translate-y-1/2 items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={
              hasUnread
                ? `Open chat box, ${unread.count} new ${unread.count === 1 ? "message" : "messages"}`
                : "Open chat box"
            }
            className={cn(
              "press glass-strong relative grid size-12 place-items-center rounded-full text-foreground shadow-[var(--shadow-glow)]",
              hasUnread && "ring-2 ring-destructive",
            )}
          >
            <MessageCircle className="size-5 text-lavender" aria-hidden="true" />
            {hasUnread ? (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-bold leading-5 text-destructive-foreground"
              >
                {unreadBadgeLabel(unread.count)}
              </span>
            ) : null}
          </button>
          {hasUnread ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="press animate-pulse rounded-full bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground shadow-lg"
              aria-hidden="true"
              tabIndex={-1}
            >
              {unread.hasReplyToMe ? "New reply" : "New message"}
            </button>
          ) : null}
        </div>
      ) : (
        <div
          role="dialog"
          aria-label="Chat box"
          className="fixed left-2 top-1/2 z-40 flex h-[min(30rem,70dvh)] border border-glass-border bg-popover/95 backdrop-blur-2xl w-[min(22rem,calc(100vw-1rem))] -translate-y-1/2 flex-col overflow-hidden rounded-3xl shadow-[var(--shadow-glow)]"
        >
          <RoomChat
            {...chatProps}
            userId={userId}
            chat={chat}
            variant="mini"
            onClose={() => setOpen(false)}
            onExpand={() => {
              setOpen(false);
              onOpenFullChat();
            }}
          />
        </div>
      )}
    </>,
    document.body,
  );
}
