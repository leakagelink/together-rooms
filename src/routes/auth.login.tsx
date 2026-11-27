import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { takePendingDestination } from "@/lib/android/deep-link";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
import { signInSchema } from "@/lib/validation";

const TITLE = "Sign in — SyncTogether";
const DESCRIPTION = "Sign in to your SyncTogether account to open your private rooms.";

export const Route = createFileRoute("/auth/login")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: "/auth/login" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "/auth/login" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    // Only a revalidated, same-origin path is ever resumed (no open redirect).
    const pending = takePendingDestination();
    navigate({ to: pending ?? "/rooms", replace: true });
  }, [loading, user, navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword(parsed.data);
    setSubmitting(false);
    if (signInError) {
      setError(errorMessage(signInError));
      return;
    }
    void track("login_completed");
    navigate({ to: takePendingDestination() ?? "/rooms" });
  }

  return (
    <AuthCard title="Welcome back" description="Sign in to your SyncTogether account.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground">
        <Link to="/auth/forgot-password" className="hover:text-foreground">
          Forgot your password?
        </Link>
        <span>
          New here?{" "}
          <Link to="/auth/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </span>
      </div>
    </AuthCard>
  );
}
