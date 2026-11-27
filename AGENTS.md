<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## UI architecture
- Theme: `<html>` carries `dark` by default and `src/lib/ui/theme.ts` removes it only for an explicit "light" choice — dark glass is the app's primary identity.
- Glass surfaces come from `@utility` classes in `src/styles.css` (`glass`, `glass-strong`, `glass-selected`, `surface-panel`, `bg-liquid`) with an opaque `@supports` fallback — reuse them instead of per-component blur/color values.

## Profile photos
- Photos live in the private `avatars` bucket under `<userId>/`; `profiles.avatar_url` stores a `storage:avatars/...` reference resolved to signed URLs via `useAvatarSrc` in `src/components/user-avatar.tsx` — workspace blocks public buckets and photos must stay signed-in-only.

## Voice notes
- Room voice notes live in the private `voice-notes` bucket at `<roomId>/<senderId>/<uuid>.<ext>` and are sent only via `send_room_voice_note`; storage rules and the hourly orphan cleanup (`/api/public/voice-notes/cleanup`) depend on that layout and on the message row being the only reference.
