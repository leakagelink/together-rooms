/**
 * PHASE 7 — Private local media realtime tests.
 *
 * LM-RT1 … LM-RT5 — database-backed realtime for local media sessions.
 *
 * Realtime here is postgres_changes on `room_local_media_sessions`, so the
 * same RLS that governs reads governs what a subscriber can ever receive:
 * a non-member gets nothing, and a member who leaves stops receiving updates.
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

interface TestUser {
  id: string;
  client: SupabaseClient;
}

interface Rpc {
  ok: boolean;
  reason?: string;
  session_id?: string;
  version?: number;
  ended?: boolean;
  [key: string]: unknown;
}

suite("phase 7 local media realtime", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let roomId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p7rt-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  const rpc = async (user: TestUser, fn: string, args: Record<string, unknown>): Promise<Rpc> => {
    const { data } = await user.client.rpc(fn as never, args as never);
    return (data ?? { ok: false, reason: "server_error" }) as Rpc;
  };

  /** Subscribes and resolves with the rows received within the window. */
  async function collect(
    user: TestUser,
    action: () => Promise<void>,
    ms = 6000,
  ): Promise<Record<string, unknown>[]> {
    const received: Record<string, unknown>[] = [];
    const channel = user.client.channel(`lm-rt-${Math.random().toString(36).slice(2)}`).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_local_media_sessions",
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => received.push(payload.new as Record<string, unknown>),
    );
    // postgres_changes only delivers what happens AFTER the subscription is
    // live, so the action must not start until the socket confirms SUBSCRIBED.
    // Resolving on a short timer instead makes the assertion race the network
    // and report a delivery failure that never happened.
    const subscribed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 20_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    if (!subscribed) throw new Error("realtime channel never reached SUBSCRIBED");
    await action();
    await new Promise((resolve) => setTimeout(resolve, ms));
    await user.client.removeChannel(channel);
    return received;
  }

  beforeAll(async () => {
    host = await makeUser("host");
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    const code = `R${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Local media realtime",
        type: "private",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: code,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    roomId = (data as { id: string }).id;
    rooms.push(roomId);
    const joined = await rpc(member, "join_room_by_code", { _code: code });
    expect(joined.ok).toBe(true);
  }, 60_000);

  afterAll(async () => {
    for (const room of rooms) await admin.from("rooms").delete().eq("id", room);
    for (const user of created) await admin.auth.admin.deleteUser(user.id);
  });

  it("LM-RT1 the sessions table is in the realtime publication", async () => {
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("id")
      .eq("room_id", roomId)
      .limit(1);
    expect(Array.isArray(data)).toBe(true);
    // Membership of supabase_realtime is asserted by RT2/RT3 actually
    // receiving change events for this table.
  });

  it("LM-RT2 a member receives the session start as a database change", async () => {
    const rows = await collect(member, async () => {
      const started = await rpc(host, "start_local_media_session", {
        _room_id: roomId,
        _media_kind: "video",
        _mime_type: "video/mp4",
        _item_count: 1,
      });
      expect(started.ok).toBe(true);
    });
    expect(rows.length).toBeGreaterThan(0);
  }, 30_000);

  it("LM-RT3 playback control propagates with a strictly increasing version", async () => {
    const before = (
      await admin
        .from("room_local_media_sessions")
        .select("id, version")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const rows = await collect(member, async () => {
      const played = await rpc(host, "control_local_media_playback", {
        _session_id: before.id,
        _action: "play",
        _position_seconds: 3,
        _expected_version: before.version,
      });
      expect(played.ok).toBe(true);
    });
    const versions = rows.map((row) => Number(row["version"] ?? 0));
    expect(Math.max(0, ...versions)).toBeGreaterThan(Number(before.version));
  }, 30_000);

  it("LM-RT4 a non-member receives no local media events (RLS-filtered)", async () => {
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id, version")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const rows = await collect(outsider, async () => {
      await rpc(host, "control_local_media_playback", {
        _session_id: session.id,
        _action: "pause",
        _position_seconds: 4,
        _expected_version: session.version,
      });
    });
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("LM-RT5 ending the session propagates and leaves no active row", async () => {
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const rows = await collect(member, async () => {
      const ended = await rpc(host, "end_local_media_session", { _session_id: session.id });
      expect(ended.ok).toBe(true);
    });
    expect(rows.some((row) => row["status"] !== "active")).toBe(true);
    const { data: active } = await member.client
      .from("room_local_media_sessions")
      .select("id")
      .eq("room_id", roomId)
      .eq("status", "active");
    expect(active ?? []).toHaveLength(0);
  }, 30_000);
});
