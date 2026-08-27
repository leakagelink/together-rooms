import type { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";

const STORAGE_KEY = "synctogether-query-cache";
const MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * Restores the cached screen data from localStorage so returning users see
 * content immediately instead of a spinner, then keeps it in sync.
 * Only non-sensitive, already client-visible query data is persisted, and
 * anything that errored or is still pending is skipped.
 */
export function setupQueryPersistence(queryClient: QueryClient) {
  if (typeof window === "undefined") return;

  let persister;
  try {
    persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: STORAGE_KEY,
      throttleTime: 1000,
    });
  } catch {
    return;
  }

  const [, promise] = persistQueryClient({
    queryClient,
    persister,
    maxAge: MAX_AGE,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        query.state.status === "success" && query.state.data !== undefined,
    },
  });

  void promise;
}

export function clearPersistedQueryCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
