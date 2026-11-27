import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** The signed-in user's own profile row (RLS limits it to their own data). */
export const myProfileQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio, status, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

/** First letters of up to two words, for avatar fallbacks. */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** Friendly first name for greetings, falling back to the email's local part. */
export function greetingName(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const fromProfile = displayName?.trim().split(/\s+/)[0];
  if (fromProfile) return fromProfile;
  const local = email?.split("@")[0]?.trim();
  return local ? local : null;
}
