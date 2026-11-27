import { initialsFor } from "@/lib/profile-query";

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
      {src ? (
        <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}
