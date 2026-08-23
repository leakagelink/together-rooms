/** Central query-key registry so cache invalidation stays consistent. */
export const queryKeys = {
  rooms: {
    mine: () => ["rooms", "mine"] as const,
    detail: (roomId: string) => ["rooms", "detail", roomId] as const,
    members: (roomId: string) => ["rooms", "detail", roomId, "members"] as const,
    invites: (roomId: string) => ["rooms", "detail", roomId, "invites"] as const,
  },
  chat: {
    messages: (roomId: string) => ["rooms", "detail", roomId, "messages"] as const,
    reactions: (roomId: string) => ["rooms", "detail", roomId, "reactions"] as const,
  },
  playback: {
    state: (roomId: string) => ["rooms", "detail", roomId, "playback"] as const,
  },
  queue: {
    snapshot: (roomId: string) => ["rooms", "detail", roomId, "queue"] as const,
    settings: (roomId: string) => ["rooms", "detail", roomId, "queue", "settings"] as const,
  },
  study: {
    resources: (roomId: string) => ["rooms", "detail", roomId, "resources"] as const,
    notes: (roomId: string) => ["rooms", "detail", roomId, "notes"] as const,
    tasks: (roomId: string) => ["rooms", "detail", roomId, "tasks"] as const,
    timer: (roomId: string) => ["rooms", "detail", roomId, "timer"] as const,
    settings: (roomId: string) => ["rooms", "detail", roomId, "study-settings"] as const,
    summary: (roomId: string) => ["rooms", "detail", roomId, "study-summary"] as const,
  },
  playlists: {
    mine: () => ["playlists", "mine"] as const,
    items: (playlistId: string) => ["playlists", playlistId, "items"] as const,
  },

  account: {
    profile: (userId: string | undefined) => ["account", "profile", userId] as const,
    settings: (userId: string | undefined) => ["user_settings", userId] as const,
    privacy: (userId: string | undefined) => ["privacy_settings", userId] as const,
    entitlement: (userId: string | undefined) => ["account", "entitlement", userId] as const,
    deletion: (userId: string | undefined) => ["account", "deletion", userId] as const,
  },
  staff: {
    context: (userId: string | undefined) => ["staff", "context", userId] as const,
    overview: () => ["staff", "overview"] as const,
    reports: (filters: unknown) => ["staff", "reports", filters] as const,
    report: (reportId: string) => ["staff", "report", reportId] as const,
    roles: () => ["staff", "roles"] as const,
    // Removed-message plaintext is never given a query key: it is fetched
    // imperatively and held in component state so it cannot land in the cache.
  },
} as const;
