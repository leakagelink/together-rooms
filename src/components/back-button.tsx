import { useLocation, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

export function BackButton({ homePaths = ["/", "/rooms"] }: { homePaths?: string[] }) {
  const router = useRouter();
  const location = useLocation();
  const isHome = homePaths.includes(location.pathname);
  const canGoBack = typeof window !== "undefined" && window.history.length > 1 && !isHome;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Go back"
      className={`shrink-0 rounded-full transition-opacity ${canGoBack ? "opacity-100" : "pointer-events-none opacity-0"}`}
      onClick={() => router.history.back()}
    >
      <ArrowLeft className="size-5" aria-hidden="true" />
    </Button>
  );
}
