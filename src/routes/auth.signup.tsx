import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
import { signUpSchema } from "@/lib/validation";

const TITLE = "Create your account — SyncTogether";
const DESCRIPTION = "Create a SyncTogether account and start your first private room.";

export const Route = createFileRoute("/auth/signup")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: "/auth/signup" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "/auth/signup" }],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/rooms", replace: true });
  }, [loading, user, navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!accepted) {
      setError("Please accept the Terms and Privacy Policy to continue.");
      return;
    }
    const parsed = signUpSchema.safeParse({ email, password, displayName });
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => issue.message);
      setError(issues.join(" ") || "Check your details.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/login`,
        data: { display_name: parsed.data.displayName },
      },
    });
    setSubmitting(false);
    if (signUpError) {
      setError(errorMessage(signUpError));
      return;
    }
    void track("signup_completed");
    if (data.session) {
      navigate({ to: "/rooms" });
      return;
    }
    setSentTo(parsed.data.email);
  }

  if (sentTo) {
    return (
      <AuthCard title="Check your email" description={`We sent a confirmation link to ${sentTo}.`}>
        <p className="text-sm text-muted-foreground">
          Confirm your email address, then sign in. The link expires for your security.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link to="/auth/login">Back to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Your rooms are private and invite-only by default."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            autoComplete="nickname"
            required
            maxLength={60}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
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
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 10 characters, with upper case, lower case and a number.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="terms"
            checked={accepted}
            onCheckedChange={(v) => setAccepted(v === true)}
            aria-describedby="terms-label"
          />
          <Label id="terms-label" htmlFor="terms" className="text-sm leading-snug font-normal">
            I agree to the Terms of Service and Privacy Policy.
          </Label>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/auth/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
