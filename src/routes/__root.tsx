import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/hooks/useAuth";
import { setupQueryPersistence } from "@/lib/query-persist";
import { AdRuntimeProvider } from "@/hooks/useAds";
import { Toaster } from "@/components/ui/sonner";
import { PushRegistrar } from "@/components/push-registrar";
import { rememberLastRoute } from "@/lib/android/last-route";
import { hideNativeSplash } from "@/lib/android/splash";
import { SplashOverlay } from "@/components/splash-overlay";
import { applyThemePreference, readStoredTheme } from "@/lib/ui/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#080A12" },
      // YouTube validates the embedding origin; stripping the Referer entirely
      // triggers player error 153. Send the origin (never the full path).
      { name: "referrer", content: "strict-origin-when-cross-origin" },
      { title: "SyncTogether — Watch. Listen. Study. Connect. Together." },
      {
        name: "description",
        content:
          "SyncTogether is a private, invite-only room platform to watch, listen, study and connect with the people you choose.",
      },
      { property: "og:site_name", content: "SyncTogether" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap",
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "SyncTogether",
          applicationCategory: "SocialNetworkingApplication",
          operatingSystem: "Web, Android",
          description:
            "Private, invite-only rooms to watch, listen, study and connect together in real time.",
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    setupQueryPersistence(queryClient);
  }, [queryClient]);

  // The native splash stays up until the remote app has actually painted, so
  // users never see the blank WebView while the origin loads.
  useEffect(() => {
    void hideNativeSplash();
  }, []);

  // Dark glass by default; a saved "light" choice applies on every screen.
  useEffect(() => {
    applyThemePreference(readStoredTheme() ?? "system");
  }, []);

  // Remember where the user was so a cold start can resume there.
  useEffect(() => {
    rememberLastRoute(pathname);
  }, [pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SplashOverlay />
        <PushRegistrar />
        <AdRuntimeProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster position="top-center" />
        </AdRuntimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
