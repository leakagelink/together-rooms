import { useState } from "react";
import { Check, MoreHorizontal, Pencil, Reply, Trash2, X } from "lucide-react";

import { ReportDialog } from "@/components/report-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_MESSAGE_LENGTH,
  REACTION_EMOJI,
  REACTION_KEYS,
  REACTION_LABEL,
  canEditMessage,
  summarizeReactions,
  systemMessageLabel,
  type ChatMessage,
  type ChatReaction,
  type ReactionKey,
} from "@/lib/chat-constants";
import { cn } from "@/lib/utils";

interface Props {
  message: ChatMessage;
  parent: ChatMessage | undefined;
  reactions: ChatReaction[];
  currentUserId: string | undefined;
  nameFor: (userId: string | null) => string;
  canModerate: boolean;
  canInteract: boolean;
  onReply: (message: ChatMessage) => void;
  onEdit: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
  onReact: (messageId: string, reaction: ReactionKey) => void;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatMessageRow({
  message,
  parent,
  reactions,
  currentUserId,
  nameFor,
  canModerate,
  canInteract,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (message.content_type === "system") {
    return (
      <li className="my-1.5 flex justify-center">
        <span className="glass rounded-full px-3 py-1 text-[11px] text-muted-foreground">
          {systemMessageLabel(message.system_code)} · {timeLabel(message.created_at)}
        </span>
      </li>
    );
  }

  const mine = Boolean(currentUserId) && message.sender_id === currentUserId;
  const removed = message.status !== "active";
  const summary = summarizeReactions(reactions, currentUserId);
  const editable = canEditMessage(message, currentUserId) && canInteract;

  return (
    <li className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] px-4 py-2.5 text-sm sm:max-w-[70%]",
          mine
            ? "bg-liquid rounded-3xl rounded-br-lg text-primary-foreground"
            : "glass rounded-3xl rounded-bl-lg text-foreground",
          removed && "italic opacity-70",
        )}
      >
        <p className="mb-1 flex items-center gap-2 text-xs opacity-80">
          <span className="font-medium">{mine ? "You" : nameFor(message.sender_id)}</span>
          <time dateTime={message.created_at}>{timeLabel(message.created_at)}</time>
          {message.edited_at && !removed ? <span>(edited)</span> : null}
        </p>

        {parent && !removed ? (
          <p className="mb-1 truncate rounded-md border-l-2 border-current/40 px-2 py-1 text-xs opacity-80">
            Replying to {nameFor(parent.sender_id)}:{" "}
            {parent.status === "active" ? parent.content : "message removed"}
          </p>
        ) : null}

        {removed ? (
          <p>
            {message.status === "moderated"
              ? "This message was removed by a moderator."
              : "This message was deleted."}
          </p>
        ) : editing ? (
          <div className="space-y-2">
            <Textarea
              aria-label="Edit message"
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              className="text-foreground"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onEdit(message.id, draft);
                  setEditing(false);
                }}
              >
                <Check className="size-4" aria-hidden="true" /> Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(false);
                }}
              >
                <X className="size-4" aria-hidden="true" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}
      </div>

      {!removed ? (
        <div className="flex flex-wrap items-center gap-1">
          {summary.map((r) => (
            <button
              key={r.reaction}
              type="button"
              disabled={!canInteract}
              onClick={() => onReact(message.id, r.reaction)}
              aria-pressed={r.mine}
              aria-label={`${REACTION_LABEL[r.reaction]} (${r.count})`}
              className={cn(
                "min-h-9 rounded-full border px-2.5 text-xs",
                r.mine ? "border-primary bg-primary/10" : "border-border",
              )}
            >
              {REACTION_EMOJI[r.reaction]} {r.count}
            </button>
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label="Message actions"
                title="Message actions"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={mine ? "end" : "start"}>
              {canInteract ? (
                <>
                  {REACTION_KEYS.map((key) => (
                    <DropdownMenuItem key={key} onSelect={() => onReact(message.id, key)}>
                      <span aria-hidden="true">{REACTION_EMOJI[key]}</span> {REACTION_LABEL[key]}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => onReply(message)}>
                    <Reply className="size-4" aria-hidden="true" /> Reply
                  </DropdownMenuItem>
                </>
              ) : null}
              {editable ? (
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden="true" /> Edit
                </DropdownMenuItem>
              ) : null}
              {mine || canModerate ? (
                <DropdownMenuItem onSelect={() => onDelete(message.id)}>
                  <Trash2 className="size-4" aria-hidden="true" />{" "}
                  {mine ? "Delete" : "Remove message"}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {!mine ? (
            <ReportDialog
              targetType="message"
              targetMessageId={message.id}
              trigger={
                <Button variant="ghost" size="sm" className="min-h-9 text-xs">
                  Report
                </Button>
              }
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
