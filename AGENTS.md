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
