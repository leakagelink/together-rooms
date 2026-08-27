import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

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

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Warm the next screen as soon as the user hovers/taps a link.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 60_000,
    defaultPreloadDelay: 30,
  });

  return router;
};
