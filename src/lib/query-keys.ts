/** Central query-key registry so cache invalidation stays consistent. */
export const queryKeys = {
  rooms: {
    mine: () => ["rooms", "mine"] as const,
    detail: (roomId: string) => ["rooms", "detail", roomId] as const,
    members: (roomId: string) => ["rooms", "detail", roomId, "members"] as const,
    invites: (roomId: string) => ["rooms", "detail", roomId, "invites"] as const,
  },
  account: {
    profile: (userId: string | undefined) => ["account", "profile", userId] as const,
    settings: (userId: string | undefined) => ["user_settings", userId] as const,
    privacy: (userId: string | undefined) => ["privacy_settings", userId] as const,
    entitlement: (userId: string | undefined) => ["account", "entitlement", userId] as const,
    deletion: (userId: string | undefined) => ["account", "deletion", userId] as const,
  },
} as const;
