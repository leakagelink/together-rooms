import { useQuery } from "@tanstack/react-query";

import { PresetAvatar } from "@/components/preset-avatar";
import { supabase } from "@/integrations/supabase/client";
import { AVATAR_BUCKET, avatarObjectPath, isRenderableAvatarUrl } from "@/lib/avatar";
import { avatarPresetId } from "@/lib/avatar-presets";
import { initialsFor } from "@/lib/profile-query";

/**
 * Resolves a profile `avatar_url` to something an <img> can show: stored photos
 * become a short-lived signed URL; https URLs pass through; anything else is dropped.
 */
export function useAvatarSrc(value: string | null | undefined): string | null {
  const objectPath = avatarObjectPath(value);
  const signed = useQuery({
    queryKey: ["avatar-url", objectPath],
    enabled: objectPath !== null,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(objectPath as string, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  if (objectPath) return signed.data ?? null;
  return isRenderableAvatarUrl(value) ? value : null;
}

/** Circular avatar with initials fallback, on the Liquid Sync gradient. */
export function UserAvatar({
  name,
  src,
  size = "md",
  className = "",
}: {
  name: string | null | undefined;
  src?: string | null | undefined;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const resolved = useAvatarSrc(src);
  const preset = avatarPresetId(src);
  const sizes = {
    sm: "size-8 text-[11px]",
    md: "size-10 text-sm",
    lg: "size-14 text-lg",
    xl: "size-24 text-3xl",
  } as const;
  return (
    <span
      aria-hidden="true"
      className={`bg-liquid relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-bold text-primary-foreground ring-2 ring-glass-border ${sizes[size]} ${className}`}
    >
      {preset ? (
        <PresetAvatar id={preset} className="size-full" />
      ) : resolved ? (
        <img src={resolved} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}

/** Bare avatar image for custom layouts; renders `fallback` until a photo resolves. */
export function AvatarImage({
  value,
  className,
  fallback,
}: {
  value: string | null | undefined;
  className: string;
  fallback: React.ReactNode;
}) {
  const resolved = useAvatarSrc(value);
  const preset = avatarPresetId(value);
  if (preset) return <PresetAvatar id={preset} className={className} />;
  if (!resolved) return <>{fallback}</>;
  return <img src={resolved} alt="" className={className} loading="lazy" />;
}
