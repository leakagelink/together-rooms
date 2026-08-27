import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { restorePersistedQueryCache } from "./lib/query-persist";

export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Screens re-open instantly from cache instead of refetching every time.
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  });

export const getRouter = () => {
  const queryClient = createAppQueryClient();
  restorePersistedQueryCache(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Warm the next screen as soon as the user hovers/taps a link.
    defaultPreload: "intent",
    // Query owns freshness; Router should always give it a chance to preload.
    defaultPreloadStaleTime: 0,
    defaultPreloadDelay: 0,
  });

  return router;
};
