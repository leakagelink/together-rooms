/**
 * PHASE 3.2 — REV-T1..REV-T5 realtime membership revocation investigation.
 *
 * Question under test: if a user holds an open postgres_changes subscription
 * to a room and their membership is then revoked, does the still-connected
 * socket keep delivering room rows?
 *
 * This runs against the live backend with real end-user JWTs. Nothing here is
 * mocked, and the assertions record the OBSERVED behaviour rather than the
 * hoped-for behaviour.
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
const SETTLE_MS = 5000;

interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
  token: string;
}

suite("phase 3.2 realtime membership revocation (REV)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let victim: TestUser;
  let roomId = "";
  let joinCode = "";

  /** Rows the victim's socket delivered, per event type. */
  const seen = { insert: [] as string[], update: [] as string[], reaction: [] as string[] };
  const statuses: string[] = [];
  let victimChannel: ReturnType<SupabaseClient["channel"]> | null = null;

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `rev-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const entry = { id: data.user!.id, email, client, token: signIn.data.session!.access_token };
    created.push(entry);
    return entry;
  }

  async function send(user: TestUser, room: string, content: string) {
    const { data } = await user.client.rpc("send_room_message", {
      _room_id: room,
      _content: content,
    });
    return data as { ok: boolean; reason?: string; message_id?: string };
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    host = await makeUser("host");
    victim = await makeUser("victim");

    joinCode = `V${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Revocation room",
        type: "friends",
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

    const join = await victim.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);
  }, 90_000);

  afterAll(async () => {
    if (victimChannel) await victim.client.removeChannel(victimChannel);
    for (const id of rooms) await admin.from("rooms").delete().eq("id", id);
    for (const u of created) await admin.auth.admin.deleteUser(u.id);
  }, 90_000);

  it("REV-T1: an active member can subscribe and receives room rows", async () => {
    await victim.client.realtime.setAuth(victim.token);
    victimChannel = victim.client
      .channel(`rev-${victim.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (p) => {
          const row = p.new as { id?: string };
          if (row?.id) seen.insert.push(row.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (p) => {
          const row = p.new as { id?: string };
          if (row?.id) seen.update.push(row.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_reactions",
          filter: `room_id=eq.${roomId}`,
        },
        (p) => {
          const row = (p.new ?? {}) as { id?: string };
          if (row?.id) seen.reaction.push(row.id);
        },
      );

    await new Promise<void>((resolve) => {
      victimChannel!.subscribe((status) => {
        statuses.push(status);
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          resolve();
        }
      });
    });
    expect(statuses).toContain("SUBSCRIBED");
    // Give the replication listener a moment to register the bindings.
    await wait(1500);

    const baseline = await send(host, roomId, "pre-revocation message");
    expect(baseline.ok).toBe(true);
    await wait(SETTLE_MS);
    expect(seen.insert).toContain(baseline.message_id);
  }, 60_000);

  it("REV-T2: membership is revoked while the socket stays connected", async () => {
    // Server-authoritative removal, exactly as a moderator kick would do it.
    const { error } = await admin
      .from("room_members")
      .update({ status: "kicked", left_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .eq("user_id", victim.id);
    expect(error).toBeNull();

    // The socket must NOT have been torn down by the test itself.
    expect(statuses.at(-1)).toBe("SUBSCRIBED");

    // Database authorization already refuses a fresh subscription.
    const { data: allowed } = await victim.client.rpc("authorize_room_channel", {
      _room_id: roomId,
    });
    expect(allowed).toBe(false);

    // And REST reads are cut off immediately.
    const { data: rest } = await victim.client
      .from("room_messages")
      .select("id")
      .eq("room_id", roomId);
    expect(rest).toEqual([]);
  }, 60_000);

  it("REV-T3/T4: rows produced after revocation are not delivered to the removed socket", async () => {
    const before = {
      insert: seen.insert.length,
      update: seen.update.length,
      reaction: seen.reaction.length,
    };

    const fresh = await send(host, roomId, "post-revocation message");
    expect(fresh.ok).toBe(true);

    const edited = await host.client.rpc("edit_room_message", {
      _message_id: fresh.message_id!,
      _content: "post-revocation edit",
    });
    expect((edited.data as { ok: boolean }).ok).toBe(true);

    const reacted = await host.client.rpc("toggle_message_reaction", {
      _message_id: fresh.message_id!,
      _reaction: "heart",
    });
    expect((reacted.data as { ok: boolean }).ok).toBe(true);

    await wait(SETTLE_MS);

    expect(seen.insert.slice(before.insert)).toEqual([]);
    expect(seen.update.slice(before.update)).toEqual([]);
    expect(seen.reaction.slice(before.reaction)).toEqual([]);
  }, 60_000);

  it("REV-T5: a removed member cannot re-establish an authorized subscription", async () => {
    const rejoinRows: string[] = [];
    const rejoinStatuses: string[] = [];

    const { data: allowed } = await victim.client.rpc("authorize_room_channel", {
      _room_id: roomId,
    });
    expect(allowed).toBe(false);

    // Even bypassing the app's authorization gate, the transport delivers nothing.
    await victim.client.realtime.setAuth(victim.token);
    const channel = victim.client
      .channel(`rev-reconnect-${victim.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` },
        (p) => {
          const row = (p.new ?? {}) as { id?: string };
          if (row?.id) rejoinRows.push(row.id);
        },
      );
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        rejoinStatuses.push(status);
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          resolve();
        }
      });
    });

    const after = await send(host, roomId, "post-reconnect message");
    expect(after.ok).toBe(true);
    await wait(SETTLE_MS);
    await victim.client.removeChannel(channel);

    expect(rejoinRows).toEqual([]);
  }, 60_000);
});
