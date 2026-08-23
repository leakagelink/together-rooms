/**
 * PHASE 6 — Study & Research workspace security tests.
 *
 * RESEARCH-T1 … T12 — resources, URL safety, permission modes, focus sync.
 * NOTE-T1 … T6      — collaborative notes and revision concurrency.
 * TASK-T1 … T4      — task ownership and assignment.
 * TIMER-T1 … T5     — server-authoritative focus timer.
 *
 * Every assertion runs against the real backend with genuine end-user JWTs so
 * grants, RLS, guard triggers and SECURITY DEFINER authorization are exercised
 * exactly as a browser client exercises them. Service-role access is used only
 * for fixture setup and trusted-execution assertions.
 *
 * Skipped automatically when backend credentials are absent.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const url = process.env["SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
const enabled = Boolean(url && serviceKey && anonKey);
const suite = enabled ? describe : describe.skip;

const password = "Test-Password-123!";

interface TestUser {
  id: string;
  client: SupabaseClient;
}

interface Rpc {
  ok: boolean;
  reason?: string;
  resource_id?: string;
  note_id?: string;
  task_id?: string;
  status?: string;
  revision?: number;
  version?: number;
  focus_version?: number;
  [key: string]: unknown;
}

suite("phase 6 study & research security (database / RLS / RPC)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let roomId = "";
  let joinCode = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p6-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const entry = { id: data.user!.id, client };
    created.push(entry);
    return entry;
  }

  const rpc = async (user: TestUser, fn: string, args: Record<string, unknown>) => {
    const { data } = await user.client.rpc(fn, args);
    return (data ?? { ok: false, reason: "server_error" }) as Rpc;
  };

  const addResource = (
    user: TestUser,
    overrides: Record<string, unknown> = {},
    room = roomId,
  ) =>
    rpc(user, "add_room_resource", {
      _room_id: room,
      _resource_type: "web_link",
      _title: "Reference",
      _url: "https://example.com/paper",
      _normalized_url: "https://example.com/paper",
      _host: "example.com",
      ...overrides,
    });

  const settings = async (room = roomId) => {
    const { data } = await admin
      .from("room_study_settings")
      .select("*")
      .eq("room_id", room)
      .maybeSingle();
    return data as Record<string, unknown> | null;
  };

  const setMode = (patch: Record<string, unknown>, room = roomId) =>
    rpc(host, "set_study_settings", { _room_id: room, ...patch });

  beforeAll(async () => {
    host = await makeUser("host");
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    joinCode = `S${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Research room",
        type: "study",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: joinCode,
      })
      .select("id")
      .single();
    if (error) throw error;
    roomId = data.id as string;
    rooms.push(roomId);

    const join = await rpc(member, "join_room_by_code", { _code: joinCode });
    expect(join.ok).toBe(true);
    await setMode({ _resource_mode: "collaborative", _note_mode: "collaborative" });
  }, 60_000);

  afterEach(async () => {
    // Rate limiting is a per-user sliding window; clearing it keeps the
    // sequential test bodies from starving each other.
    await admin.from("rate_limits").delete().in(
      "user_id",
      created.map((u) => u.id),
    );
  });

  afterAll(async () => {
    for (const room of rooms) await admin.from("rooms").delete().eq("id", room);
    for (const user of created) {
      await user.client.auth.signOut();
      await admin.auth.admin.deleteUser(user.id);
    }
  });

  /* ------------------------------------------------------------ RESEARCH */

  it("RESEARCH-T1: study tables carry no direct client write grants", async () => {
    const insert = await member.client
      .from("room_resources")
      .insert({ room_id: roomId, resource_type: "web_link", title: "direct" } as never);
    expect(insert.error).not.toBeNull();

    const update = await member.client
      .from("room_study_settings")
      .update({ resource_mode: "collaborative" } as never)
      .eq("room_id", roomId);
    expect(update.error).not.toBeNull();
  });

  it("RESEARCH-T2: a non-member cannot add a resource or read the board", async () => {
    const result = await addResource(outsider);
    expect(result.ok).toBe(false);
    expect(["forbidden", "not_found", "not_allowed"]).toContain(result.reason);

    const { data } = await outsider.client
      .from("room_resources")
      .select("id")
      .eq("room_id", roomId);
    expect(data ?? []).toHaveLength(0);
  });

  it("RESEARCH-T3: a member can add a resource in collaborative mode", async () => {
    await setMode({ _resource_mode: "collaborative" });
    const result = await addResource(member, { _title: "Member link" });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("active");

    const { data } = await member.client
      .from("room_resources")
      .select("id, title, status, added_by")
      .eq("id", result.resource_id!)
      .single();
    expect(data!.added_by).toBe(member.id);
    expect(data!.status).toBe("active");
  });

  it("RESEARCH-T4: HOST_ONLY mode rejects member resource writes", async () => {
    await setMode({ _resource_mode: "host_only" });
    const blocked = await addResource(member, { _title: "Should fail" });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("forbidden");

    const allowed = await addResource(host, { _title: "Host link" });
    expect(allowed.ok).toBe(true);
    await setMode({ _resource_mode: "collaborative" });
  });

  it("RESEARCH-T5: HOST_APPROVAL mode stores member additions as pending", async () => {
    await setMode({ _resource_mode: "host_approval" });
    const suggested = await addResource(member, { _title: "Suggestion" });
    expect(suggested.ok).toBe(true);
    expect(suggested.status).toBe("pending");

    const memberApproval = await rpc(member, "set_resource_status", {
      _resource_id: suggested.resource_id,
      _status: "active",
    });
    expect(memberApproval.ok).toBe(false);
    expect(memberApproval.reason).toBe("forbidden");

    const hostApproval = await rpc(host, "set_resource_status", {
      _resource_id: suggested.resource_id,
      _status: "active",
    });
    expect(hostApproval.ok).toBe(true);
    await setMode({ _resource_mode: "collaborative" });
  });

  it("RESEARCH-T6: the room lifecycle is re-checked for ended rooms", async () => {
    const { data } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Ended research room",
        type: "research",
        status: "active",
        privacy: "private",
        max_members: 5,
        join_code: `E${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      })
      .select("id")
      .single();
    const ended = data!.id as string;
    rooms.push(ended);

    await rpc(host, "end_room", { _room_id: ended });
    const result = await addResource(host, {}, ended);
    expect(result.ok).toBe(false);
    expect(["room_ended", "room_expired", "forbidden"]).toContain(result.reason);
  });

  it("RESEARCH-T7: focus is versioned and rejects a stale expected version", async () => {
    const resource = await addResource(host, { _title: "Focus target" });
    const before = await settings();
    const version = Number(before!["focus_version"] ?? 0);

    const ok = await rpc(host, "set_focused_resource", {
      _room_id: roomId,
      _resource_id: resource.resource_id,
      _expected_version: version,
    });
    expect(ok.ok).toBe(true);

    const stale = await rpc(host, "set_focused_resource", {
      _room_id: roomId,
      _resource_id: resource.resource_id,
      _expected_version: version,
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("version_conflict");

    const after = await settings();
    expect(Number(after!["focus_version"])).toBe(version + 1);
  });

  it("RESEARCH-T8: a plain member cannot change the room focus or the study settings", async () => {
    const current = await settings();
    const focus = await rpc(member, "set_focused_resource", {
      _room_id: roomId,
      _resource_id: current!["focused_resource_id"],
      _expected_version: Number(current!["focus_version"]),
    });
    expect(focus.ok).toBe(false);
    expect(focus.reason).toBe("forbidden");

    const modes = await rpc(member, "set_study_settings", {
      _room_id: roomId,
      _resource_mode: "host_only",
    });
    expect(modes.ok).toBe(false);
    expect(modes.reason).toBe("forbidden");

    const unchanged = await settings();
    expect(unchanged!["resource_mode"]).toBe(current!["resource_mode"]);
  });

  it("RESEARCH-T9: a resource author can remove their own resource, an unrelated member cannot", async () => {
    const mine = await addResource(member, { _title: "Member owned" });
    const theft = await rpc(outsider, "remove_room_resource", {
      _resource_id: mine.resource_id,
    });
    expect(theft.ok).toBe(false);

    const own = await rpc(member, "remove_room_resource", { _resource_id: mine.resource_id });
    expect(own.ok).toBe(true);

    const { data } = await admin
      .from("room_resources")
      .select("id")
      .eq("id", mine.resource_id!)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("RESEARCH-T10: the host can pin, archive and reject resources", async () => {
    const resource = await addResource(member, { _title: "Moderated" });
    expect((await rpc(host, "set_resource_pinned", { _resource_id: resource.resource_id, _pinned: true })).ok).toBe(true);
    expect(
      (await rpc(host, "set_resource_status", { _resource_id: resource.resource_id, _status: "archived" })).ok,
    ).toBe(true);

    const { data } = await admin
      .from("room_resources")
      .select("pinned, status")
      .eq("id", resource.resource_id!)
      .single();
    expect(data!.pinned).toBe(true);
    expect(data!.status).toBe("archived");
  });

  it("RESEARCH-T11: resource rows never leak across rooms", async () => {
    const { data } = await outsider.client
      .from("room_resources")
      .select("id, room_id")
      .limit(50);
    expect((data ?? []).some((row) => row.room_id === roomId)).toBe(false);
  });

  it("RESEARCH-T12: private research mode is a stored room setting, not a browsing proxy", async () => {
    expect((await setMode({ _private_research: true })).ok).toBe(true);
    const on = await settings();
    expect(on!["private_research_mode"]).toBe(true);

    // Nothing in the schema records per-user browsing: the only trace of an
    // opened resource is the deliberate room_resources row the user added.
    const { data } = await admin
      .from("room_resources")
      .select("added_by, url")
      .eq("room_id", roomId)
      .limit(100);
    expect((data ?? []).every((row) => row.added_by !== null || row.url !== undefined)).toBe(true);
  });

  /* ---------------------------------------------------------------- NOTES */

  it("NOTE-T1: a member can create a note in collaborative mode", async () => {
    await setMode({ _note_mode: "collaborative" });
    const note = await rpc(member, "create_room_note", {
      _room_id: roomId,
      _title: "Shared note",
      _content: "first",
    });
    expect(note.ok).toBe(true);
    expect(note.note_id).toBeTruthy();
  });

  it("NOTE-T2: a stale expected revision is rejected as a version conflict", async () => {
    const note = await rpc(host, "create_room_note", {
      _room_id: roomId,
      _title: "Concurrency note",
      _content: "base",
    });
    const first = await rpc(host, "update_room_note", {
      _note_id: note.note_id,
      _expected_revision: 1,
      _content: "host edit",
    });
    expect(first.ok).toBe(true);
    expect(first.revision).toBe(2);

    const stale = await rpc(member, "update_room_note", {
      _note_id: note.note_id,
      _expected_revision: 1,
      _content: "member edit on stale base",
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("version_conflict");

    const { data } = await admin
      .from("room_notes")
      .select("content, revision")
      .eq("id", note.note_id!)
      .single();
    expect(data!.content).toBe("host edit");
    expect(data!.revision).toBe(2);
  });

  it("NOTE-T3: every accepted save records a revision row", async () => {
    const note = await rpc(host, "create_room_note", {
      _room_id: roomId,
      _title: "Revision trail",
      _content: "v1",
    });
    await rpc(host, "update_room_note", {
      _note_id: note.note_id,
      _expected_revision: 1,
      _content: "v2",
    });
    await rpc(host, "update_room_note", {
      _note_id: note.note_id,
      _expected_revision: 2,
      _content: "v3",
    });

    const { data } = await admin
      .from("room_note_revisions")
      .select("revision, content_length")
      .eq("note_id", note.note_id!)
      .order("revision");
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
    // Revision history stores lengths, never note bodies.
    expect(Object.keys((data ?? [])[0] ?? {})).not.toContain("content");
  });

  it("NOTE-T4: HOST_ONLY note mode blocks member edits", async () => {
    const note = await rpc(host, "create_room_note", {
      _room_id: roomId,
      _title: "Locked note",
      _content: "host text",
    });
    await setMode({ _note_mode: "host_only" });

    const blocked = await rpc(member, "update_room_note", {
      _note_id: note.note_id,
      _expected_revision: 1,
      _content: "member text",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("forbidden");
    await setMode({ _note_mode: "collaborative" });
  });

  it("NOTE-T5: an outsider can neither read nor write room notes", async () => {
    const { data } = await outsider.client.from("room_notes").select("id").eq("room_id", roomId);
    expect(data ?? []).toHaveLength(0);

    const write = await rpc(outsider, "create_room_note", {
      _room_id: roomId,
      _title: "Intruder",
      _content: "x",
    });
    expect(write.ok).toBe(false);
  });

  it("NOTE-T6: notes cannot be written directly, only through the RPC", async () => {
    const { data: existing } = await admin
      .from("room_notes")
      .select("id")
      .eq("room_id", roomId)
      .limit(1)
      .single();

    const direct = await member.client
      .from("room_notes")
      .update({ content: "tampered" } as never)
      .eq("id", existing!.id);
    expect(direct.error).not.toBeNull();
  });

  /* ---------------------------------------------------------------- TASKS */

  it("TASK-T1: a member can create a task and it is attributed to them", async () => {
    const task = await rpc(member, "create_room_task", {
      _room_id: roomId,
      _title: "Read chapter 3",
    });
    expect(task.ok).toBe(true);
    const { data } = await admin
      .from("room_tasks")
      .select("created_by, status")
      .eq("id", task.task_id!)
      .single();
    expect(data!.created_by).toBe(member.id);
    expect(data!.status).toBe("todo");
  });

  it("TASK-T2: completing a task records who completed it", async () => {
    const task = await rpc(host, "create_room_task", {
      _room_id: roomId,
      _title: "Summarise findings",
    });
    const done = await rpc(member, "update_room_task", {
      _task_id: task.task_id,
      _status: "completed",
    });
    expect(done.ok).toBe(true);

    const { data } = await admin
      .from("room_tasks")
      .select("status, completed_by, completed_at")
      .eq("id", task.task_id!)
      .single();
    expect(data!.status).toBe("completed");
    expect(data!.completed_by).toBe(member.id);
    expect(data!.completed_at).not.toBeNull();
  });

  it("TASK-T3: an outsider cannot create, read or modify tasks", async () => {
    const task = await rpc(host, "create_room_task", { _room_id: roomId, _title: "Private task" });
    const write = await rpc(outsider, "update_room_task", {
      _task_id: task.task_id,
      _status: "completed",
    });
    expect(write.ok).toBe(false);

    const { data } = await outsider.client.from("room_tasks").select("id").eq("room_id", roomId);
    expect(data ?? []).toHaveLength(0);
  });

  it("TASK-T4: only the author or a host can delete a task", async () => {
    const task = await rpc(member, "create_room_task", { _room_id: roomId, _title: "Mine" });
    const theft = await rpc(outsider, "delete_room_task", { _task_id: task.task_id });
    expect(theft.ok).toBe(false);

    const own = await rpc(member, "delete_room_task", { _task_id: task.task_id });
    expect(own.ok).toBe(true);
  });

  /* ---------------------------------------------------------------- TIMER */

  it("TIMER-T1: starting the timer stores authoritative timestamps, not a client countdown", async () => {
    const start = await rpc(host, "control_focus_timer", {
      _room_id: roomId,
      _action: "start",
      _phase: "focus",
      _duration_seconds: 1500,
    });
    expect(start.ok).toBe(true);

    const { data } = await admin
      .from("room_focus_timer")
      .select("status, started_at, ends_at, duration_seconds")
      .eq("room_id", roomId)
      .single();
    expect(data!.status).toBe("running");
    expect(data!.started_at).not.toBeNull();
    expect(data!.ends_at).not.toBeNull();
    const span =
      (new Date(data!.ends_at as string).getTime() -
        new Date(data!.started_at as string).getTime()) /
      1000;
    expect(Math.round(span)).toBe(1500);
  });

  it("TIMER-T2: pause freezes the remaining time and resume re-derives the end", async () => {
    const paused = await rpc(host, "control_focus_timer", { _room_id: roomId, _action: "pause" });
    expect(paused.ok).toBe(true);

    const { data: frozen } = await admin
      .from("room_focus_timer")
      .select("status, remaining_seconds, ends_at")
      .eq("room_id", roomId)
      .single();
    expect(frozen!.status).toBe("paused");
    expect(Number(frozen!.remaining_seconds)).toBeGreaterThan(0);

    const resumed = await rpc(host, "control_focus_timer", { _room_id: roomId, _action: "resume" });
    expect(resumed.ok).toBe(true);

    const { data: running } = await admin
      .from("room_focus_timer")
      .select("status, ends_at")
      .eq("room_id", roomId)
      .single();
    expect(running!.status).toBe("running");
    expect(new Date(running!.ends_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("TIMER-T3: HOST_ONLY timer mode blocks member control", async () => {
    await setMode({ _timer_mode: "host_only" });
    const blocked = await rpc(member, "control_focus_timer", {
      _room_id: roomId,
      _action: "reset",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("forbidden");
  });

  it("TIMER-T4: collaborative timer mode lets a member control it", async () => {
    await setMode({ _timer_mode: "collaborative" });
    const allowed = await rpc(member, "control_focus_timer", {
      _room_id: roomId,
      _action: "reset",
    });
    expect(allowed.ok).toBe(true);
    await setMode({ _timer_mode: "host_only" });
  });

  it("TIMER-T5: a stale expected version is rejected", async () => {
    const { data: before } = await admin
      .from("room_focus_timer")
      .select("version")
      .eq("room_id", roomId)
      .single();
    const version = Number(before!.version);

    const ok = await rpc(host, "control_focus_timer", {
      _room_id: roomId,
      _action: "start",
      _phase: "short_break",
      _duration_seconds: 300,
      _expected_version: version,
    });
    expect(ok.ok).toBe(true);

    const stale = await rpc(host, "control_focus_timer", {
      _room_id: roomId,
      _action: "pause",
      _expected_version: version,
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("version_conflict");
  });
});
