/**
 * PHASE 6 — Study & Research realtime tests.
 *
 * RESEARCH-RT1 — a room member's socket receives resource changes.
 * RESEARCH-RT2 — a non-member's socket receives nothing for that room.
 * NOTE-RT1     — note inserts reach members.
 * NOTE-RT2     — note updates (new revisions) reach members.
 * TASK-RT1     — task changes reach members.
 * TIMER-RT1    — focus timer changes reach members.
 *
 * Realtime is database-backed: every assertion below observes rows delivered
 * by postgres_changes under RLS, never a broadcast payload.
 *
 * Skipped automatically when backend credentials are absent.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env["SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
const enabled = Boolean(url && serviceKey && anonKey);
const suite = enabled ? describe : describe.skip;

const password = "Test-Password-123!";
/** How long we wait for a realtime row before declaring it undelivered. */
const SETTLE_MS = 6000;

interface TestUser {
  id: string;
  client: SupabaseClient;
  token: string;
}

interface Rpc {
  ok: boolean;
  reason?: string;
  resource_id?: string;
  note_id?: string;
  task_id?: string;
}

suite("phase 6 study & research realtime (postgres_changes)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let roomId = "";

  const memberSeen = { resources: 0, notes: 0, noteUpdates: 0, tasks: 0, timer: 0 };
  const outsiderSeen = { rows: 0 };
  let memberChannel: ReturnType<SupabaseClient["channel"]> | null = null;
  let outsiderChannel: ReturnType<SupabaseClient["channel"]> | null = null;

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function waitUntil(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error("expected realtime rows were not delivered before the deadline");
      }
      await wait(100);
    }
  }

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p6rt-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const token = signIn.data.session?.access_token;
    if (!token) throw new Error("test user sign-in did not return a realtime token");
    const entry = { id: data.user!.id, client, token };
    created.push(entry);
    return entry;
  }

  const rpc = async (user: TestUser, fn: string, args: Record<string, unknown>) => {
    const { data } = await user.client.rpc(fn, args);
    return (data ?? { ok: false, reason: "server_error" }) as Rpc;
  };

  const addResource = (user: TestUser) => {
    const link = `https://example.org/rt-${Math.random().toString(36).slice(2, 10)}`;
    return rpc(user, "add_room_resource", {
      _room_id: roomId,
      _resource_type: "web_link",
      _title: "Realtime reference",
      _url: link,
      _normalized_url: link,
      _host: "example.org",
    });
  };

  async function subscribe(user: TestUser, onRow: (table: string, eventType: string) => void) {
    await user.client.realtime.setAuth(user.token);
    const channel = user.client
      .channel(`rt-study-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_resources", filter: `room_id=eq.${roomId}` },
        (payload) => onRow("room_resources", payload.eventType),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_notes", filter: `room_id=eq.${roomId}` },
        (payload) => onRow("room_notes", payload.eventType),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_tasks", filter: `room_id=eq.${roomId}` },
        (payload) => onRow("room_tasks", payload.eventType),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_focus_timer", filter: `room_id=eq.${roomId}` },
        (payload) => onRow("room_focus_timer", payload.eventType),
      );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("realtime channel never reached SUBSCRIBED")),
        20_000,
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(timer);
          reject(new Error(`realtime subscription failed: ${status}`));
        }
      });
    });
    return channel;
  }

  beforeAll(async () => {
    host = await makeUser("host");
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    const joinCode = `R${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Realtime research room",
        type: "research",
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

    memberChannel = await subscribe(member, (table, eventType) => {
      if (table === "room_resources") memberSeen.resources += 1;
      if (table === "room_notes") {
        if (eventType === "UPDATE") memberSeen.noteUpdates += 1;
        else memberSeen.notes += 1;
      }
      if (table === "room_tasks") memberSeen.tasks += 1;
      if (table === "room_focus_timer") memberSeen.timer += 1;
    });
    outsiderChannel = await subscribe(outsider, () => {
      outsiderSeen.rows += 1;
    });

    // Drive every surface once, then wait for the expected member-visible rows
    // instead of hoping a fixed delay outlasts replication fan-out.
    const seededResource = await addResource(host);
    expect(seededResource.ok, JSON.stringify(seededResource)).toBe(true);
    const note = await rpc(host, "create_room_note", {
      _room_id: roomId,
      _title: "Realtime note",
      _content: "v1",
    });
    await rpc(host, "update_room_note", {
      _note_id: note.note_id,
      _expected_revision: 1,
      _content: "v2",
    });
    await rpc(host, "create_room_task", { _room_id: roomId, _title: "Realtime task" });
    await rpc(host, "control_focus_timer", {
      _room_id: roomId,
      _action: "start",
      _phase: "focus",
      _duration_seconds: 300,
    });

    await waitUntil(
      () =>
        memberSeen.resources > 0 &&
        memberSeen.notes > 0 &&
        memberSeen.noteUpdates > 0 &&
        memberSeen.tasks > 0 &&
        memberSeen.timer > 0,
    );
  }, 90_000);

  afterAll(async () => {
    if (memberChannel) await member.client.removeChannel(memberChannel);
    if (outsiderChannel) await outsider.client.removeChannel(outsiderChannel);
    for (const room of rooms) await admin.from("rooms").delete().eq("id", room);
    await admin
      .from("rate_limits")
      .delete()
      .in(
        "user_id",
        created.map((u) => u.id),
      );
    for (const user of created) {
      await user.client.auth.signOut();
      await admin.auth.admin.deleteUser(user.id);
    }
  });

  it("RESEARCH-RT1: a member's socket receives resource changes", () => {
    expect(memberSeen.resources).toBeGreaterThan(0);
  });

  it("RESEARCH-RT2: a non-member's socket receives nothing for the room", () => {
    expect(outsiderSeen.rows).toBe(0);
  });

  it("NOTE-RT1: note creation reaches members", () => {
    expect(memberSeen.notes).toBeGreaterThan(0);
  });

  it("NOTE-RT2: note revisions reach members as updates", () => {
    expect(memberSeen.noteUpdates).toBeGreaterThan(0);
  });

  it("TASK-RT1: task changes reach members", () => {
    expect(memberSeen.tasks).toBeGreaterThan(0);
  });

  it("TIMER-RT1: focus timer changes reach members", () => {
    expect(memberSeen.timer).toBeGreaterThan(0);
  });
});
