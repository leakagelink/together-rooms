import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronDown, ChevronUp, ListMusic, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { youtubeProvider } from "@/lib/providers/youtube";
import { providerError } from "@/lib/providers/media-provider";
import { moveTargetIndex } from "@/lib/queue-rules";
import { rpcMessage, type RpcReason } from "@/lib/rpc-types";
import {
  addPlaylistItem,
  createPlaylist,
  deletePlaylist,
  movePlaylistItem,
  removePlaylistItem,
} from "@/lib/playlists.functions";

export const Route = createFileRoute("/_authenticated/playlists")({
  head: () => ({
    meta: [
      { title: "Playlists — SyncTogether" },
      {
        name: "description",
        content: "Build shared music playlists and start a room queue from them.",
      },
      { property: "og:title", content: "Playlists — SyncTogether" },
      {
        property: "og:description",
        content: "Build shared music playlists and start a room queue from them.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlaylistsPage,
  errorComponent: () => (
    <AppShell>
      <ErrorState message="Your playlists couldn't be loaded." />
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <EmptyState title="Not found" description="This page doesn't exist." />
    </AppShell>
  ),
});

function PlaylistsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const create = useServerFn(createPlaylist);
  const destroy = useServerFn(deletePlaylist);
  const addItem = useServerFn(addPlaylistItem);
  const removeItem = useServerFn(removePlaylistItem);
  const moveItem = useServerFn(movePlaylistItem);

  const playlists = useQuery({
    queryKey: queryKeys.playlists.mine(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlists")
        .select("id, name, description, visibility, version, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeId = selected ?? playlists.data?.[0]?.id ?? null;
  const active = playlists.data?.find((p) => p.id === activeId) ?? null;

  const items = useQuery({
    queryKey: queryKeys.playlists.items(activeId ?? "none"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlist_items")
        .select("id, provider_media_id, title, thumbnail_url, position")
        .eq("playlist_id", activeId ?? "")
        .order("position", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(activeId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.mine() });
    if (activeId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.items(activeId) });
  };

  const run = useMutation({
    mutationFn: async (fn: () => Promise<{ ok: boolean; reason?: RpcReason }>) => {
      const result = await fn();
      if (!result.ok) throw new Error(rpcMessage(result.reason ?? "server_error"));
      return result;
    },
    onSuccess: refresh,
    onError: (error: Error) => {
      toast.error(error.message);
      refresh();
    },
  });

  const busy = run.isPending;

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Playlists</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Playlists are private to you until you load them into a music room queue.
      </p>

      <form
        className="mt-6 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = name.trim();
          if (!value) return;
          setName("");
          run.mutate(() => create({ data: { name: value } }));
        }}
      >
        <label htmlFor="playlist-name" className="sr-only">
          Playlist name
        </label>
        <Input
          id="playlist-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New playlist name"
          className="min-w-48 flex-1"
          maxLength={80}
        />
        <Button type="submit" disabled={busy}>
          <Plus className="size-4" aria-hidden="true" /> Create
        </Button>
      </form>

      {playlists.isPending ? (
        <LoadingState label="Loading playlists" />
      ) : playlists.isError ? (
        <ErrorState
          message={errorMessage(playlists.error)}
          onRetry={() => void playlists.refetch()}
        />
      ) : playlists.data.length === 0 ? (
        <EmptyState
          title="No playlists yet"
          description="Create one above, then add YouTube tracks to it."
        />
      ) : (
        <div className="mt-6 grid gap-6 md:grid-cols-[240px_1fr]">
          <nav aria-label="Your playlists" className="space-y-2">
            {playlists.data.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => setSelected(playlist.id)}
                className={
                  playlist.id === activeId
                    ? "w-full rounded-lg border border-primary bg-primary/10 p-3 text-left text-sm"
                    : "w-full rounded-lg border border-border p-3 text-left text-sm hover:bg-muted/50"
                }
              >
                <span className="flex items-center gap-2 font-medium">
                  <ListMusic className="size-4" aria-hidden="true" /> {playlist.name}
                </span>
              </button>
            ))}
          </nav>

          <section className="surface-panel p-5" aria-live="polite">
            {!active ? (
              <p className="text-sm text-muted-foreground">Select a playlist.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{active.name}</h2>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setSelected(null);
                      run.mutate(() => destroy({ data: { playlist_id: active.id } }));
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" /> Delete
                  </Button>
                </div>

                <form
                  className="mt-4 flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const mediaId = youtubeProvider.parseReference(link);
                    if (!mediaId) {
                      toast.error(providerError("invalid_id", "parse").message);
                      return;
                    }
                    setLink("");
                    run.mutate(() =>
                      addItem({ data: { playlist_id: active.id, media_id: mediaId } }),
                    );
                  }}
                >
                  <label htmlFor="playlist-link" className="sr-only">
                    YouTube link
                  </label>
                  <Input
                    id="playlist-link"
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    placeholder="Paste a YouTube link"
                    className="min-w-48 flex-1"
                    inputMode="url"
                  />
                  <Button type="submit" disabled={busy}>
                    <Plus className="size-4" aria-hidden="true" /> Add track
                  </Button>
                </form>

                {items.isPending ? (
                  <LoadingState label="Loading tracks" rows={2} />
                ) : items.isError ? (
                  <ErrorState
                    message={errorMessage(items.error)}
                    onRetry={() => void items.refetch()}
                  />
                ) : items.data.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">No tracks yet.</p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {items.data.map((item, index) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card/60 p-2"
                      >
                        {item.thumbnail_url ? (
                          <img
                            src={item.thumbnail_url}
                            alt=""
                            loading="lazy"
                            referrerPolicy="strict-origin-when-cross-origin"
                            className="h-10 w-16 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <div className="h-10 w-16 shrink-0 rounded bg-muted" aria-hidden="true" />
                        )}
                        <p className="min-w-0 flex-1 truncate text-sm">
                          {item.title ?? item.provider_media_id}
                        </p>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Move up"
                          disabled={busy || index === 0}
                          onClick={() =>
                            run.mutate(() =>
                              moveItem({
                                data: {
                                  item_id: item.id,
                                  target_index: moveTargetIndex(index, -1, items.data.length),
                                  expected_version: active.version,
                                },
                              }),
                            )
                          }
                        >
                          <ChevronUp className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Move down"
                          disabled={busy || index === items.data.length - 1}
                          onClick={() =>
                            run.mutate(() =>
                              moveItem({
                                data: {
                                  item_id: item.id,
                                  target_index: moveTargetIndex(index, 1, items.data.length),
                                  expected_version: active.version,
                                },
                              }),
                            )
                          }
                        >
                          <ChevronDown className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remove track"
                          disabled={busy}
                          onClick={() =>
                            run.mutate(() => removeItem({ data: { item_id: item.id } }))
                          }
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
