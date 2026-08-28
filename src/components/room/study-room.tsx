import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  Check,
  Compass,
  ExternalLink,
  Eye,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ResearchViewer, type ResearchTarget } from "@/components/room/research-viewer";
import { useRoomStudy, type RoomNote, type RoomResource } from "@/hooks/useRoomStudy";
import { queryKeys } from "@/lib/query-keys";
import { rpcMessage, type RpcReason } from "@/lib/rpc-types";
import {
  addRoomResource,
  controlFocusTimer,
  createRoomNote,
  createRoomTask,
  deleteRoomNote,
  deleteRoomTask,
  getStudySummary,
  removeRoomResource,
  setFocusedResource,
  setResourcePinned,
  setResourceStatus,
  setStudySettings,
  updateRoomNote,
  updateRoomTask,
} from "@/lib/study.functions";
import { checkResourceUrl, displayHost, urlRejectionMessage } from "@/lib/url-safety";
import { openResource, toBrowseUrl } from "@/lib/in-app-browser";
import {
  FOCUS_PRESETS,
  formatDuration,
  phaseLabel,
  remainingSeconds,
  type FocusPhase,
} from "@/lib/study-timer";

interface StudyRoomProps {
  roomId: string;
  userId: string | undefined;
  canControl: boolean;
  roomActive: boolean;
}

type Result = { ok: boolean; reason?: RpcReason } & Record<string, unknown>;

function unwrap(result: Result) {
  if (!result.ok) throw new Error(rpcMessage((result.reason ?? "server_error") as RpcReason));
  return result;
}

/**
 * Phase 6 — the collaborative Study & Research workspace.
 *
 * Everything here is a *reference-first* surface: resources are links the room
 * agreed to look at, and each participant opens them in their own browser. No
 * remote browser control, no scraping, no embedding of sites that did not opt
 * in — YouTube is the only natively embedded provider, and everything else
 * opens externally.
 */
export function StudyRoom({ roomId, userId, canControl, roomActive }: StudyRoomProps) {
  const queryClient = useQueryClient();
  const { connected, settings, timer, resources, notes, tasks, loading } = useRoomStudy(roomId);

  const addResource = useServerFn(addRoomResource);
  const removeResource = useServerFn(removeRoomResource);
  const statusResource = useServerFn(setResourceStatus);
  const pinResource = useServerFn(setResourcePinned);
  const focusResource = useServerFn(setFocusedResource);
  const saveSettings = useServerFn(setStudySettings);
  const newNote = useServerFn(createRoomNote);
  const saveNote = useServerFn(updateRoomNote);
  const dropNote = useServerFn(deleteRoomNote);
  const newTask = useServerFn(createRoomTask);
  const saveTask = useServerFn(updateRoomTask);
  const dropTask = useServerFn(deleteRoomTask);
  const timerControl = useServerFn(controlFocusTimer);
  const summaryFn = useServerFn(getStudySummary);

  const [url, setUrl] = useState("");
  const [resourceTitle, setResourceTitle] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ revision: number; content: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reading, setReading] = useState<ResearchTarget | null>(null);
  const [surfQuery, setSurfQuery] = useState("");
  const [surfing, setSurfing] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  const canAddResources = roomActive && (settings.resource_mode !== "host_only" || canControl);
  const canEditNotes = roomActive && (settings.note_mode !== "host_only" || canControl);
  const canUseTimer = roomActive && (settings.timer_mode !== "host_only" || canControl);

  const activeResources = resources.filter((r) => r.status === "active");
  const pending = resources.filter((r) => r.status === "pending");
  const archived = resources.filter((r) => r.status === "archived");
  const focused = activeResources.find((r) => r.id === settings.focused_resource_id) ?? null;
  const activeNote: RoomNote | null = notes.find((n) => n.id === activeNoteId) ?? null;

  // Local ticking only: the countdown is derived, never written per second.
  useEffect(() => {
    if (timer.status !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer.status]);

  useEffect(() => {
    if (!activeNote) {
      setDraft(null);
      return;
    }
    setDraft((prev) =>
      prev && prev.revision === activeNote.revision
        ? prev
        : { revision: activeNote.revision, content: activeNote.content },
    );
  }, [activeNote]);

  const left = useMemo(() => remainingSeconds(timer, new Date(now)), [timer, now]);

  const invalidate = (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key });

  const addMutation = useMutation({
    mutationFn: async () => {
      const check = checkResourceUrl(url);
      if (!check.ok) throw new Error(urlRejectionMessage(check.reason));
      return unwrap(
        (await addResource({
          data: {
            room_id: roomId,
            resource_type: "web_link",
            title: resourceTitle.trim() || displayHost(check.host),
            url: check.url,
          },
        })) as Result,
      );
    },
    onSuccess: async (result) => {
      setUrl("");
      setResourceTitle("");
      await invalidate(queryKeys.study.resources(roomId));
      toast.success(
        result["status"] === "pending"
          ? "Suggested. A host will review it."
          : "Resource added to the board.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resourceAction = useMutation({
    mutationFn: async (action: () => Promise<Result>) => unwrap(await action()),
    onSuccess: async () => {
      await invalidate(queryKeys.study.resources(roomId));
      await invalidate(queryKeys.study.settings(roomId));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const settingsMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      unwrap((await saveSettings({ data: { room_id: roomId, ...patch } as never })) as Result),
    onSuccess: async () => {
      await invalidate(queryKeys.study.settings(roomId));
      toast.success("Study settings updated.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const noteCreate = useMutation({
    mutationFn: async () =>
      unwrap((await newNote({ data: { room_id: roomId, title: noteTitle.trim() } })) as Result),
    onSuccess: async () => {
      setNoteTitle("");
      await invalidate(queryKeys.study.notes(roomId));
      toast.success("Note created.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const noteSave = useMutation({
    mutationFn: async () => {
      if (!activeNote || !draft) throw new Error("Nothing to save.");
      const result = (await saveNote({
        data: {
          note_id: activeNote.id,
          expected_revision: draft.revision,
          content: draft.content,
        },
      })) as Result;
      if (!result.ok && result.reason === "version_conflict") {
        throw new Error(
          "Someone else saved this note first. Your text is still here — reload the latest version and merge it in.",
        );
      }
      return unwrap(result);
    },
    onSuccess: async () => {
      await invalidate(queryKeys.study.notes(roomId));
      toast.success("Note saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const taskCreate = useMutation({
    mutationFn: async () =>
      unwrap((await newTask({ data: { room_id: roomId, title: taskTitle.trim() } })) as Result),
    onSuccess: async () => {
      setTaskTitle("");
      await invalidate(queryKeys.study.tasks(roomId));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const taskAction = useMutation({
    mutationFn: async (action: () => Promise<Result>) => unwrap(await action()),
    onSuccess: async () => invalidate(queryKeys.study.tasks(roomId)),
    onError: (error: Error) => toast.error(error.message),
  });

  const timerMutation = useMutation({
    mutationFn: async (args: {
      action: "start" | "pause" | "resume" | "reset";
      phase?: FocusPhase;
      duration_seconds?: number;
    }) =>
      unwrap(
        (await timerControl({
          data: { room_id: roomId, expected_version: timer.version, ...args },
        })) as Result,
      ),
    onSuccess: async () => invalidate(queryKeys.study.timer(roomId)),
    onError: (error: Error) => toast.error(error.message),
  });

  const summaryQuery = useQuery({
    queryKey: queryKeys.study.summary(roomId),
    queryFn: async () => (await summaryFn({ data: { room_id: roomId } })) as Result,
  });

  const renderResource = (resource: RoomResource) => (
    <li
      key={resource.id}
      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {resource.pinned ? <Pin className="size-3 text-primary" aria-hidden="true" /> : null}
          {resource.title}
          {focused?.id === resource.id ? <Badge variant="secondary">In focus</Badge> : null}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {resource.resource_type === "youtube" ? "YouTube" : displayHost(resource.host) || "Note"}{" "}
          · added {new Date(resource.created_at).toLocaleString()}
          {resource.added_by === userId ? " · by you" : ""}
        </p>
        {resource.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{resource.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {resource.url ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setReading({
                id: resource.id,
                title: resource.title,
                url: resource.url as string,
                host: resource.host,
              })
            }
          >
            <ExternalLink className="size-4" aria-hidden="true" /> Read
          </Button>
        ) : null}
        {canControl && resource.status === "active" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              resourceAction.mutate(
                async () =>
                  (await focusResource({
                    data: {
                      room_id: roomId,
                      resource_id: resource.id,
                      expected_version: settings.focus_version,
                    },
                  })) as Result,
              )
            }
          >
            <Eye className="size-4" aria-hidden="true" /> Focus
          </Button>
        ) : null}
        {canControl ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              resourceAction.mutate(
                async () =>
                  (await pinResource({
                    data: { resource_id: resource.id, pinned: !resource.pinned },
                  })) as Result,
              )
            }
          >
            <Pin className="size-4" aria-hidden="true" />
            {resource.pinned ? "Unpin" : "Pin"}
          </Button>
        ) : null}
        {(canControl || resource.added_by === userId) && resource.status === "active" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              resourceAction.mutate(
                async () =>
                  (await statusResource({
                    data: { resource_id: resource.id, status: "archived" },
                  })) as Result,
              )
            }
          >
            <Archive className="size-4" aria-hidden="true" /> Archive
          </Button>
        ) : null}
        {canControl || resource.added_by === userId ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              resourceAction.mutate(
                async () =>
                  (await removeResource({ data: { resource_id: resource.id } })) as Result,
              )
            }
          >
            <Trash2 className="size-4" aria-hidden="true" /> Remove
          </Button>
        ) : null}
      </div>
    </li>
  );

  return (
    <section className="surface-panel mt-8 p-5" aria-labelledby="study-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="study-heading" className="text-lg font-semibold">
            Study &amp; Research
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {settings.focus_mode === "host_sync"
              ? "Synchronized Focus — the room follows the host's chosen resource."
              : "Independent Research — everyone browses on their own device."}{" "}
            {connected ? "Live." : "Reconnecting…"}
          </p>
        </div>
        {focused ? (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current focus</p>
            <p className="font-medium">{focused.title}</p>
            {focused.url ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() =>
                  setReading({
                    id: focused.id,
                    title: focused.title,
                    url: focused.url as string,
                    host: focused.host,
                  })
                }
              >
                <ExternalLink className="size-4" aria-hidden="true" /> Read in app
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {settings.private_research_mode ? (
        <p className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Private Research Mode is on: nothing you browse on your own is tracked or shared — only
          resources you deliberately add appear here. This is a room privacy setting, not anonymous
          browsing: it is not a VPN, proxy or incognito browser.
        </p>
      ) : null}

      <Tabs defaultValue="resources" className="mt-5">
        {/* Mobile: the tab strip scrolls inside its own track instead of
            pushing the whole page wider than the viewport. */}
        <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-max min-w-full justify-start">
            <TabsTrigger value="resources">Resources</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="timer">Timer</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            {canControl ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
          </TabsList>
        </div>


        {/* ------------------------------------------------------ resources */}
        <TabsContent value="resources" className="mt-4 space-y-4">
          {/* Surf: search or open any site inside the app's own browser. */}
          <form
            className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const next = toBrowseUrl(surfQuery);
              if (!next) {
                toast.error("Enter a search term or a website address.");
                return;
              }
              if (!isNativeRuntime()) {
                setEmbedUrl(next);
                return;
              }
              setSurfing(true);
              const mode = await openResource(next);
              setSurfing(false);
              if (!mode) toast.error("That address can't be opened.");
            }}
          >
            <div className="min-w-[16rem] flex-1">
              <Label htmlFor="research-surf">Browse the web</Label>
              <Input
                id="research-surf"
                value={surfQuery}
                onChange={(event) => setSurfQuery(event.target.value)}
                placeholder="Search or enter a site — opens inside the app"
                inputMode="url"
              />
            </div>
            <Button type="submit" variant="outline" disabled={surfing || !surfQuery.trim()}>
              <Compass className="size-4" aria-hidden="true" /> Surf
            </Button>
          </form>

          {canAddResources ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addMutation.mutate();
              }}
            >
              <div className="min-w-[16rem] flex-1">
                <Label htmlFor="resource-url">Link</Label>
                <Input
                  id="resource-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/paper"
                  inputMode="url"
                />
              </div>
              <div className="min-w-[12rem] flex-1">
                <Label htmlFor="resource-title">Title (optional)</Label>
                <Input
                  id="resource-title"
                  value={resourceTitle}
                  onChange={(event) => setResourceTitle(event.target.value)}
                  maxLength={200}
                />
              </div>
              <Button type="submit" disabled={addMutation.isPending || !url.trim()}>
                <Plus className="size-4" aria-hidden="true" />
                {settings.resource_mode === "host_approval" && !canControl ? "Suggest" : "Add"}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {roomActive
                ? "Only the host and controllers can add resources in this room."
                : "This room is closed, so the board is read-only."}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading the board…</p>
          ) : activeResources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resources yet.</p>
          ) : (
            <ul className="space-y-2">{activeResources.map(renderResource)}</ul>
          )}

          {pending.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">Suggestions awaiting approval</h3>
              <ul className="mt-2 space-y-2">
                {pending.map((resource) => (
                  <li
                    key={resource.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{resource.title}</p>
                      <p className="text-xs text-muted-foreground">{displayHost(resource.host)}</p>
                    </div>
                    {canControl ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            resourceAction.mutate(
                              async () =>
                                (await statusResource({
                                  data: { resource_id: resource.id, status: "active" },
                                })) as Result,
                            )
                          }
                        >
                          <Check className="size-4" aria-hidden="true" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            resourceAction.mutate(
                              async () =>
                                (await statusResource({
                                  data: { resource_id: resource.id, status: "rejected" },
                                })) as Result,
                            )
                          }
                        >
                          <X className="size-4" aria-hidden="true" /> Reject
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="secondary">Pending</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {archived.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Archived ({archived.length})
              </summary>
              <ul className="mt-2 space-y-2">{archived.map(renderResource)}</ul>
            </details>
          ) : null}
        </TabsContent>

        {/* ---------------------------------------------------------- notes */}
        <TabsContent value="notes" className="mt-4 space-y-4">
          {canEditNotes ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                noteCreate.mutate();
              }}
            >
              <div className="min-w-[16rem] flex-1">
                <Label htmlFor="note-title">New note</Label>
                <Input
                  id="note-title"
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  maxLength={200}
                />
              </div>
              <Button type="submit" disabled={noteCreate.isPending || !noteTitle.trim()}>
                <Plus className="size-4" aria-hidden="true" /> Create
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Notes are host-edited in this room.</p>
          )}

          <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
            <ul className="space-y-1">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => setActiveNoteId(note.id)}
                    className={`w-full rounded-md border p-2 text-left text-sm ${
                      note.id === activeNoteId ? "border-primary" : "border-border"
                    }`}
                  >
                    <span className="block font-medium">{note.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      rev {note.revision} · {new Date(note.updated_at).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
              {notes.length === 0 ? (
                <li className="text-sm text-muted-foreground">No notes yet.</li>
              ) : null}
            </ul>

            {activeNote && draft ? (
              <div className="space-y-2">
                <Textarea
                  value={draft.content}
                  rows={10}
                  disabled={!canEditNotes}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Editing revision {draft.revision}. Saved revision is {activeNote.revision}.
                  {draft.revision !== activeNote.revision
                    ? " Someone else saved a newer revision — copy anything you need, then reload."
                    : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!canEditNotes || noteSave.isPending}
                    onClick={() => noteSave.mutate()}
                  >
                    Save revision {draft.revision + 1}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setDraft({ revision: activeNote.revision, content: activeNote.content })
                    }
                  >
                    <RotateCcw className="size-4" aria-hidden="true" /> Reload latest
                  </Button>
                  {canControl || activeNote.created_by === userId ? (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        const result = (await dropNote({
                          data: { note_id: activeNote.id },
                        })) as Result;
                        if (!result.ok) {
                          toast.error(rpcMessage((result.reason ?? "server_error") as RpcReason));
                          return;
                        }
                        setActiveNoteId(null);
                        await invalidate(queryKeys.study.notes(roomId));
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" /> Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a note to read or edit it.</p>
            )}
          </div>
        </TabsContent>

        {/* ---------------------------------------------------------- tasks */}
        <TabsContent value="tasks" className="mt-4 space-y-4">
          {roomActive ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                taskCreate.mutate();
              }}
            >
              <div className="min-w-[16rem] flex-1">
                <Label htmlFor="task-title">New task</Label>
                <Input
                  id="task-title"
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  maxLength={200}
                />
              </div>
              <Button type="submit" disabled={taskCreate.isPending || !taskTitle.trim()}>
                <Plus className="size-4" aria-hidden="true" /> Add task
              </Button>
            </form>
          ) : null}

          <ul className="space-y-2">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.status.replace("_", " ")}
                    {task.assigned_to === userId ? " · assigned to you" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={task.status}
                    onValueChange={(value) =>
                      taskAction.mutate(
                        async () =>
                          (await saveTask({
                            data: { task_id: task.id, status: value as "todo" },
                          })) as Result,
                      )
                    }
                  >
                    <SelectTrigger className="w-[10rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">To do</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      taskAction.mutate(
                        async () =>
                          (await saveTask({
                            data: {
                              task_id: task.id,
                              ...(task.assigned_to === userId
                                ? { clear_assignee: true }
                                : { assigned_to: userId ?? null }),
                            },
                          })) as Result,
                      )
                    }
                  >
                    {task.assigned_to === userId ? "Unassign me" : "Assign me"}
                  </Button>
                  {canControl || task.created_by === userId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        taskAction.mutate(
                          async () => (await dropTask({ data: { task_id: task.id } })) as Result,
                        )
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
            {tasks.length === 0 ? (
              <li className="text-sm text-muted-foreground">No tasks yet.</li>
            ) : null}
          </ul>
        </TabsContent>

        {/* ---------------------------------------------------------- timer */}
        <TabsContent value="timer" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <p className="font-mono text-4xl tabular-nums">{formatDuration(left)}</p>
            <div className="text-sm text-muted-foreground">
              <p>
                {phaseLabel(timer.phase)} · {timer.status}
              </p>
              <p>{timer.sessions_completed} focus sessions completed in this room.</p>
            </div>
          </div>
          {canUseTimer ? (
            <div className="flex flex-wrap gap-2">
              {FOCUS_PRESETS.map((preset) => (
                <Button
                  key={preset.phase}
                  variant="outline"
                  size="sm"
                  disabled={timerMutation.isPending}
                  onClick={() =>
                    timerMutation.mutate({
                      action: "start",
                      phase: preset.phase,
                      duration_seconds: preset.seconds,
                    })
                  }
                >
                  <Play className="size-4" aria-hidden="true" /> {preset.label}
                </Button>
              ))}
              {timer.status === "running" ? (
                <Button size="sm" onClick={() => timerMutation.mutate({ action: "pause" })}>
                  Pause
                </Button>
              ) : null}
              {timer.status === "paused" ? (
                <Button size="sm" onClick={() => timerMutation.mutate({ action: "resume" })}>
                  Resume
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => timerMutation.mutate({ action: "reset" })}
              >
                <RotateCcw className="size-4" aria-hidden="true" /> Reset
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The host controls the focus timer in this room.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The countdown is derived from the room&apos;s start and end timestamps, so every device
            agrees without writing a tick to the database.
          </p>
        </TabsContent>

        {/* -------------------------------------------------------- summary */}
        <TabsContent value="summary" className="mt-4">
          {summaryQuery.data?.ok ? (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Resources on the board", "resources_active"],
                ["Awaiting approval", "resources_pending"],
                ["Archived", "resources_archived"],
                ["Notes", "notes_total"],
                ["Note revisions", "note_revisions"],
                ["Tasks", "tasks_total"],
                ["Tasks completed", "tasks_completed"],
                ["Focus sessions", "focus_sessions_completed"],
              ].map(([label, key]) => (
                <div key={key} className="rounded-md border border-border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-xl font-semibold">
                    {String(summaryQuery.data?.[key as string] ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              The session summary is built from this room&apos;s own data only.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void summaryQuery.refetch()}
          >
            Refresh summary
          </Button>
        </TabsContent>

        {/* ------------------------------------------------------- settings */}
        {canControl ? (
          <TabsContent value="settings" className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Who can add resources</Label>
                <Select
                  value={settings.resource_mode}
                  onValueChange={(value) => settingsMutation.mutate({ resource_mode: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="host_only">Host only</SelectItem>
                    <SelectItem value="collaborative">Everyone</SelectItem>
                    <SelectItem value="host_approval">Everyone, host approves</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Who can edit notes</Label>
                <Select
                  value={settings.note_mode}
                  onValueChange={(value) => settingsMutation.mutate({ note_mode: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="host_only">Host only</SelectItem>
                    <SelectItem value="collaborative">Everyone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Who can control the timer</Label>
                <Select
                  value={settings.timer_mode}
                  onValueChange={(value) => settingsMutation.mutate({ timer_mode: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="host_only">Host only</SelectItem>
                    <SelectItem value="collaborative">Everyone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Focus mode</Label>
                <Select
                  value={settings.focus_mode}
                  onValueChange={(value) => settingsMutation.mutate({ focus_mode: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="host_sync">Synchronized focus</SelectItem>
                    <SelectItem value="free_navigation">Independent research</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Private Research Mode</p>
                <p className="text-xs text-muted-foreground">
                  No browsing activity is recorded or shared. Not a VPN, proxy or incognito browser.
                </p>
              </div>
              <Switch
                checked={settings.private_research_mode}
                onCheckedChange={(checked) =>
                  settingsMutation.mutate({ private_research: checked })
                }
              />
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      <ResearchViewer
        target={reading}
        onOpenChange={(open) => {
          if (!open) setReading(null);
        }}
        canSaveNotes={canEditNotes}
        onSaveNote={async (title, content) => {
          unwrap((await newNote({ data: { room_id: roomId, title, content } })) as Result);
          await invalidate(queryKeys.study.notes(roomId));
        }}
      />
    </section>
  );
}
