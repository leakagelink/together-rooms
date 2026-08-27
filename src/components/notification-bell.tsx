/**
 * Header bell: unread badge plus a compact activity feed.
 *
 * Presentation only — every read/clear action goes through the notification
 * RPCs, which re-check the caller in the database.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  CheckCheck,
  CreditCard,
  Gavel,
  ListMusic,
  MessageSquare,
  Play,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";
import { errorMessage } from "@/lib/errors";
import { resolveNotificationTarget } from "@/lib/notifications/routing";

const ICONS: Record<string, typeof Bell> = {
  chat_message: MessageSquare,
  room_invite: UserPlus,
  member_joined: UserPlus,
  member_left: UserPlus,
  playback: Play,
  queue: ListMusic,
  study: ListMusic,
  moderation: Gavel,
  subscription: CreditCard,
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function NotificationBell() {
  const { items, unreadCount, isPending, markRead, markAllRead, clearAll } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const openNotification = async (notification: AppNotification) => {
    setOpen(false);
    try {
      if (!notification.read_at) await markRead(notification.id);
      const target = resolveNotificationTarget(notification.type, notification.data);
      void navigate(target as never);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-xl"
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
        >
          <Bell className="size-5" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Activity</p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Mark all as read"
              disabled={unreadCount === 0}
              onClick={() => {
                void markAllRead().catch((error) => toast.error(errorMessage(error)));
              }}
            >
              <CheckCheck className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Clear all notifications"
              disabled={items.length === 0}
              onClick={() => {
                void clearAll().catch((error) => toast.error(errorMessage(error)));
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <ScrollArea className="max-h-96">
          {isPending ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No activity yet. Room invites, chat and playback updates will show up here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((notification) => {
                const Icon = ICONS[notification.type] ?? Bell;
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => void openNotification(notification)}
                      className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className="mt-0.5 rounded-lg bg-muted p-1.5">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {notification.title}
                          </span>
                          {notification.read_at ? null : (
                            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                              New
                            </Badge>
                          )}
                        </span>
                        {notification.body ? (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {notification.body}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {timeAgo(notification.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
