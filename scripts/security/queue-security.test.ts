/**
 * PHASE 5 — collaborative music queue security tests (QUEUE-T1 … T15).
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
const TRACK_A = "Q5TRACKA001";
const TRACK_B = "Q5TRACKB002";
const TRACK_C = "Q5TRACKC003";
const TRACK_D = "Q5TRACKD004";
const UNVERIFIED = "Q5NOCACHE05";
const EXPIRED = "Q5EXPIRED06";
const TRACKS = [TRACK_A, TRACK_B, TRACK_C, TRACK_D];

interface TestUser {
  id: string;
  client: SupabaseClient;
}

interface Rpc {
  ok: boolean;
  reason?: string;
  item_id?: string;
  status?: string;
  queue_version?: number;
  outcome?: string;
  added?: number;
  skipped?: number;
}

interface QueueItem {
  id: string;
  provider_media_id: string;
  status: string;
  position: number;
}

suite("phase 5 queue security (database / RLS / RPC)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let roomId = "";
  let joinCode = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p5-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  async function makeRoom(owner: TestUser, code: string) {
    const { data, error } = await owner.client
      .from("rooms")
      .insert({
        owner_id: owner.id,
        host_id: owner.id,
        name: "Music room",
        type: "music",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: code,
      })
      .select("id")
      .single();
    if (error) throw error;
    rooms.push(data.id as string);
    return data.id as string;
  }

  async function seedPolicy(mediaId: string, ttlHours = 24) {
    const { error } = await admin.rpc("upsert_media_metadata_cache", {
      _provider: "youtube",
      _media_id: mediaId,
      _title: `Track ${mediaId}`,
      _thumbnail_url: `https://i.ytimg.com/vi/${mediaId}/hqdefault.jpg`,
      _made_for_kids: false,
      _embeddable: true,
      _privacy_status: "public",
      _status: "ok",
      _source: "test",
      _ttl_hours: ttlHours,
    });
    if (error) throw error;
  }

  const rpc = async (user: TestUser, fn: string, args: Record<string, unknown>) => {
    const { data } = await user.client.rpc(fn, args);
    return (data ?? { ok: false, reason: "server_error" }) as Rpc;
  };

  const add = (user: TestUser, media: string, room = roomId) =>
    rpc(user, "add_to_queue", { _room_id: room, _provider: "youtube", _media_id: media });

  async function snapshot(user: TestUser = host): Promise<{
    queue_version: number;
    items: QueueItem[];
  }> {
    const { data } = await user.client.rpc("queue_snapshot", { _room_id: roomId });
    return data as { queue_version: number; items: QueueItem[] };
  }

  async function resetQueue() {
    await admin.from("room_media_queue").delete().eq("room_id", roomId);
    await admin
      .from("room_queue_settings")
      .update({ queue_mode: "collaborative", repeat_mode: "off", shuffle_enabled: false })
      .eq("room_id", roomId);
  }

  beforeAll(async () => {
    host = await makeUser("host");
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    joinCode = `Q${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    roomId = await makeRoom(host, joinCode);
    const join = await member.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);

    for (const track of TRACKS) await seedPolicy(track);
    await seedPolicy(EXPIRED);
    await admin
      .from("media_metadata_cache")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("media_id", EXPIRED);
  }, 180_000);

  afterAll(async () => {
    for (const id of rooms) await admin.from("rooms").delete().eq("id", id);
    for (const u of created) await admin.auth.admin.deleteUser(u.id);
    await admin
      .from("media_metadata_cache")
      .delete()
      .in("media_id", [...TRACKS, EXPIRED]);
  }, 120_000);

  afterEach(async () => {
    for (const u of created) await admin.from("rate_limits").delete().eq("user_id", u.id);
  });

  it("QUEUE-T1: a non-member cannot read the room queue", async () => {
    await resetQueue();
    expect((await add(host, TRACK_A)).ok).toBe(true);

    const { data, error } = await outsider.client
      .from("room_media_queue")
      .select("id")
      .eq("room_id", roomId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("QUEUE-T2: a non-member cannot add to the queue", async () => {
    expect(await add(outsider, TRACK_B)).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("QUEUE-T3: direct client INSERT into room_media_queue is rejected", async () => {
    const { error } = await host.client.from("room_media_queue").insert({
      room_id: roomId,
      provider: "youtube",
      provider_media_id: TRACK_C,
      position: 1,
    });
    expect(error).not.toBeNull();
  });

  it("QUEUE-T4: direct client UPDATE and DELETE on queue rows are rejected", async () => {
    const items = (await snapshot()).items;
    const target = items[0]!;
    const upd = await host.client
      .from("room_media_queue")
      .update({ status: "playing" })
      .eq("id", target.id);
    expect(upd.error).not.toBeNull();
    const del = await host.client.from("room_media_queue").delete().eq("id", target.id);
    expect(del.error).not.toBeNull();
  });

  it("QUEUE-T5: direct client writes to room_queue_settings are rejected", async () => {
    const upd = await host.client
      .from("room_queue_settings")
      .update({ queue_mode: "host_only" })
      .eq("room_id", roomId);
    expect(upd.error).not.toBeNull();
  });

  it("QUEUE-T6: unverified media cannot enter the queue (fail closed)", async () => {
    expect(await add(host, UNVERIFIED)).toMatchObject({
      ok: false,
      reason: "provider_verification_failed",
    });
  });

  it("QUEUE-T7: expired policy cache cannot enter the queue", async () => {
    expect(await add(host, EXPIRED)).toMatchObject({
      ok: false,
      reason: "provider_verification_failed",
    });
  });

  it("QUEUE-T8: duplicate active tracks are rejected", async () => {
    await resetQueue();
    expect((await add(host, TRACK_A)).ok).toBe(true);
    expect(await add(member, TRACK_A)).toMatchObject({ ok: false, reason: "duplicate_item" });
  });

  it("QUEUE-T9: host_only mode blocks member additions", async () => {
    await resetQueue();
    expect((await rpc(host, "set_queue_mode", { _room_id: roomId, _mode: "host_only" })).ok).toBe(
      true,
    );
    expect(await add(member, TRACK_B)).toMatchObject({ ok: false, reason: "forbidden" });
    expect((await add(host, TRACK_B)).ok).toBe(true);
  });

  it("QUEUE-T10: a member cannot change queue mode", async () => {
    expect(
      await rpc(member, "set_queue_mode", { _room_id: roomId, _mode: "collaborative" }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("QUEUE-T11: host_approval mode parks member additions as suggestions", async () => {
    await resetQueue();
    await rpc(host, "set_queue_mode", { _room_id: roomId, _mode: "host_approval" });
    const suggestion = await add(member, TRACK_C);
    expect(suggestion).toMatchObject({ ok: true, status: "suggested" });

    const hostAdd = await add(host, TRACK_D);
    expect(hostAdd).toMatchObject({ ok: true, status: "queued" });

    // A member cannot approve their own suggestion.
    expect(
      await rpc(member, "approve_queue_item", { _item_id: suggestion.item_id! }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect((await rpc(host, "approve_queue_item", { _item_id: suggestion.item_id! })).ok).toBe(
      true,
    );

    const after = (await snapshot()).items.find((i) => i.id === suggestion.item_id);
    expect(after?.status).toBe("queued");
  });

  it("QUEUE-T12: only the adder or a queue manager can remove an item", async () => {
    await resetQueue();
    await rpc(host, "set_queue_mode", { _room_id: roomId, _mode: "collaborative" });
    const mine = await add(member, TRACK_A);
    const hostItem = await add(host, TRACK_B);

    expect(await rpc(member, "remove_from_queue", { _item_id: hostItem.item_id! })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    expect((await rpc(member, "remove_from_queue", { _item_id: mine.item_id! })).ok).toBe(true);
    expect((await rpc(host, "remove_from_queue", { _item_id: hostItem.item_id! })).ok).toBe(true);
  });

  it("QUEUE-T13: reordering and clearing require queue-manager rights", async () => {
    await resetQueue();
    const first = await add(host, TRACK_A);
    await add(host, TRACK_B);
    const version = (await snapshot()).queue_version;

    expect(
      await rpc(member, "move_queue_item", {
        _item_id: first.item_id!,
        _target_index: 1,
        _expected_queue_version: version,
      }),
    ).toMatchObject({ ok: false, reason: "forbidden" });

    expect(
      await rpc(member, "clear_queue", { _room_id: roomId, _expected_queue_version: version }),
    ).toMatchObject({ ok: false, reason: "forbidden" });

    const moved = await rpc(host, "move_queue_item", {
      _item_id: first.item_id!,
      _target_index: 1,
      _expected_queue_version: version,
    });
    expect(moved.ok).toBe(true);
    const items = (await snapshot()).items;
    expect(items[1]?.id).toBe(first.item_id);
  });

  it("QUEUE-T14: playback transport is restricted to authorized controllers", async () => {
    await resetQueue();
    await add(host, TRACK_A);
    await add(host, TRACK_B);

    expect(await rpc(member, "start_queue", { _room_id: roomId })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    const started = await rpc(host, "start_queue", { _room_id: roomId });
    expect(started.ok).toBe(true);

    expect(await rpc(member, "advance_queue", { _room_id: roomId, _cause: "next" })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });

  it("QUEUE-T15: queue operations are blocked once the room has ended", async () => {
    const code = `Q${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const tempRoom = await makeRoom(host, code);
    await admin
      .from("rooms")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", tempRoom);
    expect(await add(host, TRACK_C, tempRoom)).toMatchObject({ ok: false, reason: "room_ended" });
  });
});
