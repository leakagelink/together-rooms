import { UserCog } from "lucide-react";

import { BlockUserButton } from "@/components/block-user-button";
import { ReportDialog } from "@/components/report-dialog";
import { EmptyState } from "@/components/state-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RoomMemberEntry } from "@/lib/rooms.functions";
import type { PresenceStatus } from "@/lib/realtime/events";

interface Props {
  members: RoomMemberEntry[];
  presence: Record<string, PresenceStatus>;
  currentUserId: string | undefined;
  roomId: string;
  canTransferHost: boolean;
  onTransferHost: (userId: string) => void;
  transferPending: boolean;
}

const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
};

export function RoomMembersPanel({
  members,
  presence,
  currentUserId,
  roomId,
  canTransferHost,
  onTransferHost,
  transferPending,
}: Props) {
  if (members.length === 0) {
    return (
      <EmptyState title="No members yet" description="Share the join code to bring people in." />
    );
  }

  return (
    <ul className="space-y-2">
      {members.map((member) => {
        const isSelf = member.user_id === currentUserId;
        const status: PresenceStatus = presence[member.user_id] ?? "offline";
        return (
          <li
            key={member.user_id}
            className="surface-panel flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{isSelf ? "You" : member.display_name}</span>
                {member.username ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    @{member.username}
                  </span>
                ) : null}
                <Badge variant={status === "online" ? "default" : "secondary"}>
                  {PRESENCE_LABEL[status]}
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                {member.role} · {member.status}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canTransferHost &&
              !isSelf &&
              member.status === "joined" &&
              member.role !== "host" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={transferPending}
                  onClick={() => onTransferHost(member.user_id)}
                >
                  <UserCog className="size-4" aria-hidden="true" /> Make host
                </Button>
              ) : null}
              {!isSelf ? (
                <>
                  <ReportDialog
                    targetType="user"
                    targetUserId={member.user_id}
                    targetRoomId={roomId}
                  />
                  <BlockUserButton userId={member.user_id} />
                </>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
