import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic, Radio, Send, X } from "lucide-react";
import { toast } from "sonner";

import { ChatMessageRow } from "@/components/room/chat-message";
import {
  useVoiceNoteRecorder,
  VoiceNoteRecordingBar,
  type RecordedVoiceNote,
} from "@/components/room/voice-note-recorder";
import { supabase } from "@/integrations/supabase/client";
import { buildVoiceNotePath, VOICE_NOTE_BUCKET, voiceNoteFileFormat } from "@/lib/voice-notes";
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
  sendRoomVoiceNote,
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
  const sendVoice = useServerFn(sendRoomVoiceNote);

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
      const voicePath = byId.get(id)?.sender_id === userId ? byId.get(id)?.voice_path : null;
      const result = await remove({ data: { message_id: id } });
      if (!result.ok) throw new Error(rpcMessage(result.reason));
      // Own voice note: drop the recording right away (an hourly job also cleans up).
      if (voicePath) await supabase.storage.from(VOICE_NOTE_BUCKET).remove([voicePath]);
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

  async function uploadVoiceNote(note: RecordedVoiceNote) {
    const format = voiceNoteFileFormat(note.mime);
    if (!userId || !format) {
      toast.error("Voice notes aren't supported on this device.");
      return;
    }
    const path = buildVoiceNotePath(roomId, userId, crypto.randomUUID(), format.ext);
    try {
      const { error: uploadError } = await supabase.storage
        .from(VOICE_NOTE_BUCKET)
        .upload(path, note.blob, { contentType: format.contentType, upsert: false });
      if (uploadError) throw uploadError;
      const result = await sendVoice({
        data: {
          room_id: roomId,
          voice_path: path,
          duration_ms: note.durationMs,
          parent_message_id: replyTo?.id ?? null,
        },
      });
      if (!result.ok) {
        await supabase.storage.from(VOICE_NOTE_BUCKET).remove([path]);
        throw new Error(rpcMessage(result.reason));
      }
      void track("chat_message_sent");
      setReplyTo(null);
      await invalidate();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const voice = useVoiceNoteRecorder(uploadVoiceNote);
  const recordingVoice = voice.phase === "recording" || voice.phase === "sending";

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
    <section
      className="surface-panel mt-4 flex flex-col overflow-hidden bg-card/70 p-0 backdrop-blur-xl"
      aria-labelledby="chat-heading"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <h2 id="chat-heading" className="text-sm font-black tracking-tight">
          Chat
        </h2>
        <p
          className="flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
          role="status"
        >
          <Radio className={chat.connected ? "size-3 text-primary" : "size-3"} aria-hidden="true" />
          {!chat.authorized
            ? "Live updates unavailable"
            : chat.connected
              ? "Live"
              : "Reconnecting…"}
        </p>
      </header>

      <div className="flex max-h-[58dvh] min-h-64 flex-col-reverse overflow-y-auto px-3 py-4 sm:px-4">
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

      <div className="border-t border-glass-border bg-background/30 p-3 backdrop-blur-xl sm:p-4">
        {replyTo ? (
          <p className="mb-2 flex items-center justify-between gap-2 rounded-2xl border border-border/60 bg-muted/60 py-1.5 pl-3 pr-1 text-xs">
            <span className="truncate">
              Replying to {nameFor(replyTo.sender_id)}: {replyTo.content}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-full"
              aria-label="Cancel reply"
              onClick={() => setReplyTo(null)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </p>
        ) : null}

        {canInteract ? (
          <>
            {/* One pill holds the field and the send affordance so the composer
                reads as a single target on small screens. */}
            {recordingVoice ? (
              <VoiceNoteRecordingBar
                phase={voice.phase}
                elapsedMs={voice.elapsedMs}
                onSend={voice.send}
                onCancel={voice.cancel}
              />
            ) : (
            <div className="glass flex items-end gap-2 rounded-[1.75rem] p-1.5 focus-within:border-primary/60">
              <Textarea
                ref={inputRef}
                aria-label="Message"
                placeholder="Type a message…"
                value={draft}
                maxLength={MAX_MESSAGE_LENGTH}
                rows={1}
                className="max-h-32 min-h-10 resize-none border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {draft.trim().length === 0 ? (
                <Button
                  onClick={() => void voice.start()}
                  disabled={voice.phase === "starting"}
                  aria-label="Record voice note"
                  className="size-10 shrink-0 rounded-full p-0"
                >
                  {voice.phase === "starting" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Mic className="size-4" aria-hidden="true" />
                  )}
                </Button>
              ) : (
                <Button
                  onClick={submit}
                  disabled={sendMutation.isPending}
                  aria-label="Send message"
                  className="size-10 shrink-0 rounded-full p-0"
                >
                  <Send className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
            )}
            <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
              {recordingVoice
                ? "Voice notes can be up to 5 minutes."
                : `${draft.length}/${MAX_MESSAGE_LENGTH} · Enter sends · tap the mic for a voice note.`}
            </p>
          </>
        ) : (
          <p role="status" className="px-1 text-sm text-muted-foreground">
            {disabledReason ?? "You can't post in this room."}
          </p>
        )}
      </div>
    </section>
  );
}
