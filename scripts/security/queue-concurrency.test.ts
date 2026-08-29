/**
 * PHASE 5 — queue concurrency & playlist integrity tests.
 *
 * QUEUE-CONCURRENCY-T1 … T7 cover versioned mutations, simultaneous ENDED
 * reports, ordering integrity and authoritative transitions.
 * PLAYLIST-T1 … T5 cover playlist ownership, isolation and room import.
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
const TRACKS = ["Q5CTRACK001", "Q5CTRACK002", "Q5CTRACK003", "Q5CTRACK004"];
const BAD_TRACK = "Q5CBADTRK05";

interface TestUser {
  id: string;
  client: SupabaseClient;
}

interface Rpc {
  ok: boolean;
  reason?: string;
  item_id?: string;
  playlist_id?: string;
  queue_version?: number;
  outcome?: string;
  added?: number;
  skipped?: number;
  state?: { provider_media_id: string | null; playback_status: string; version: number };
}

interface QueueItem {
  id: string;
  provider_media_id: string;
  status: string;
  position: number;
}

suite("phase 5 queue concurrency & playlists", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let roomId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p5c-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    // Test fixtures create several rooms per user: lift the rewarded-ad room quota.
    await admin.from("user_ad_access").upsert({
      user_id: data.user!.id,
      unlock_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const entry = { id: data.user!.id, client };
    created.push(entry);
    return entry;
  }

  async function seedPolicy(mediaId: string) {
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
      _ttl_hours: 24,
    });
    if (error) throw error;
  }

  const rpc = async (user: TestUser, fn: string, args: Record<string, unknown>) => {
    const { data } = await user.client.rpc(fn, args);
    return (data ?? { ok: false, reason: "server_error" }) as Rpc;
  };

  const add = (user: TestUser, media: string) =>
    rpc(user, "add_to_queue", { _room_id: roomId, _provider: "youtube", _media_id: media });

  async function snapshot(): Promise<{ queue_version: number; items: QueueItem[] }> {
    const { data } = await host.client.rpc("queue_snapshot", { _room_id: roomId });
    return data as { queue_version: number; items: QueueItem[] };
  }

  async function playbackVersion() {
    const { data } = await admin
      .from("room_playback_state")
      .select("version")
      .eq("room_id", roomId)
      .maybeSingle();
    return (data?.version as number | undefined) ?? 0;
  }

  async function resetQueue() {
    await admin.from("room_media_queue").delete().eq("room_id", roomId);
    await admin
      .from("room_queue_settings")
      .update({ queue_mode: "collaborative", repeat_mode: "off", shuffle_enabled: false })
      .eq("room_id", roomId);
    for (const u of created) await admin.from("rate_limits").delete().eq("user_id", u.id);
  }

  async function seedQueue(count: number) {
    await resetQueue();
    const ids: string[] = [];
    for (const media of TRACKS.slice(0, count)) {
      const res = await add(host, media);
      expect(res.ok).toBe(true);
      ids.push(res.item_id!);
    }
    return ids;
  }

  beforeAll(async () => {
    host = await makeUser("host");
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    const joinCode = `C${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Concurrency room",
        type: "music",
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

    const join = await member.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);

    for (const track of TRACKS) await seedPolicy(track);
  }, 180_000);

  afterAll(async () => {
    for (const id of rooms) await admin.from("rooms").delete().eq("id", id);
    for (const u of created) await admin.auth.admin.deleteUser(u.id);
    await admin
      .from("media_metadata_cache")
      .delete()
      .in("media_id", [...TRACKS, BAD_TRACK]);
  }, 120_000);

  afterEach(async () => {
    for (const u of created) await admin.from("rate_limits").delete().eq("user_id", u.id);
  });

  it("QUEUE-CONCURRENCY-T1: a stale queue version is rejected on reorder", async () => {
    const ids = await seedQueue(3);
    const stale = (await snapshot()).queue_version - 1;
    expect(
      await rpc(host, "move_queue_item", {
        _item_id: ids[0]!,
        _target_index: 2,
        _expected_queue_version: stale,
      }),
    ).toMatchObject({ ok: false, reason: "version_conflict" });
  });

  it("QUEUE-CONCURRENCY-T2: reordering renumbers positions without collisions", async () => {
    const ids = await seedQueue(3);
    const version = (await snapshot()).queue_version;
    expect(
      (
        await rpc(host, "move_queue_item", {
          _item_id: ids[2]!,
          _target_index: 0,
          _expected_queue_version: version,
        })
      ).ok,
    ).toBe(true);

    const items = (await snapshot()).items;
    expect(items.map((i) => i.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(new Set(items.map((i) => i.position)).size).toBe(items.length);
    expect([...items].sort((a, b) => a.position - b.position).map((i) => i.id)).toEqual(
      items.map((i) => i.id),
    );
  });

  it("QUEUE-CONCURRENCY-T3: simultaneous ENDED reports advance the queue exactly once", async () => {
    await seedQueue(3);
    expect((await rpc(host, "start_queue", { _room_id: roomId })).ok).toBe(true);
    const first = (await snapshot()).items.find((i) => i.status === "playing")!;
    const version = await playbackVersion();

    const results = await Promise.all([
      rpc(host, "advance_queue", { _room_id: roomId, _expected_version: version, _cause: "ended" }),
      rpc(host, "advance_queue", { _room_id: roomId, _expected_version: version, _cause: "ended" }),
      rpc(host, "advance_queue", { _room_id: roomId, _expected_version: version, _cause: "ended" }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const failed of results.filter((r) => !r.ok)) {
      expect(failed.reason).toBe("version_conflict");
    }

    const playing = (await snapshot()).items.filter((i) => i.status === "playing");
    expect(playing).toHaveLength(1);
    expect(playing[0]!.id).not.toBe(first.id);
  });

  it("QUEUE-CONCURRENCY-T4: repeat_one replays the current track instead of advancing", async () => {
    await seedQueue(3);
    expect((await rpc(host, "set_repeat_mode", { _room_id: roomId, _mode: "repeat_one" })).ok).toBe(
      true,
    );
    expect((await rpc(host, "start_queue", { _room_id: roomId })).ok).toBe(true);
    const current = (await snapshot()).items.find((i) => i.status === "playing")!;

    const res = await rpc(host, "advance_queue", {
      _room_id: roomId,
      _expected_version: await playbackVersion(),
      _cause: "ended",
    });
    expect(res).toMatchObject({ ok: true, outcome: "repeat_one" });
    expect(res.state?.provider_media_id).toBe(current.provider_media_id);
    await rpc(host, "set_repeat_mode", { _room_id: roomId, _mode: "off" });
  });

  it("QUEUE-CONCURRENCY-T5: an exhausted queue ends playback authoritatively", async () => {
    await seedQueue(1);
    expect((await rpc(host, "start_queue", { _room_id: roomId })).ok).toBe(true);
    const res = await rpc(host, "advance_queue", {
      _room_id: roomId,
      _expected_version: await playbackVersion(),
      _cause: "ended",
    });
    expect(res).toMatchObject({ ok: true, outcome: "queue_exhausted" });
    expect(res.state?.playback_status).toBe("ended");
  });

  it("QUEUE-CONCURRENCY-T6: a track whose policy expired is dropped, not played", async () => {
    await resetQueue();
    await seedPolicy(BAD_TRACK);
    const good = await add(host, TRACKS[0]!);
    const bad = await add(host, BAD_TRACK);
    const tail = await add(host, TRACKS[1]!);
    expect(good.ok && bad.ok && tail.ok).toBe(true);

    // Expire the middle track's verification after it was queued.
    await admin
      .from("media_metadata_cache")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("media_id", BAD_TRACK);

    expect((await rpc(host, "start_queue", { _room_id: roomId })).ok).toBe(true);
    const advanced = await rpc(host, "advance_queue", {
      _room_id: roomId,
      _expected_version: await playbackVersion(),
      _cause: "next",
    });
    expect(advanced.ok).toBe(true);
    expect(advanced.state?.provider_media_id).toBe(TRACKS[1]);

    const { data } = await admin
      .from("room_media_queue")
      .select("status")
      .eq("room_id", roomId)
      .eq("provider_media_id", BAD_TRACK)
      .single();
    expect(data?.status).toBe("removed");
  });

  it("QUEUE-CONCURRENCY-T7: concurrent adds of the same track keep one queue entry", async () => {
    await resetQueue();
    const results = await Promise.all([add(host, TRACKS[0]!), add(member, TRACKS[0]!)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);

    const items = (await snapshot()).items.filter((i) => i.provider_media_id === TRACKS[0]);
    expect(items).toHaveLength(1);
  });

  it("PLAYLIST-T1: a playlist is private to its owner", async () => {
    const created = await rpc(host, "create_playlist", { _name: "Road trip" });
    expect(created.ok).toBe(true);

    const mine = await host.client.from("playlists").select("id").eq("id", created.playlist_id!);
    expect(mine.data).toHaveLength(1);

    const theirs = await outsider.client
      .from("playlists")
      .select("id")
      .eq("id", created.playlist_id!);
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
  });

  it("PLAYLIST-T2: only the owner can mutate a playlist", async () => {
    const created = await rpc(host, "create_playlist", { _name: "Owner only" });
    expect(
      await rpc(outsider, "add_playlist_item", {
        _playlist_id: created.playlist_id!,
        _provider: "youtube",
        _media_id: TRACKS[0]!,
      }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect(
      await rpc(outsider, "delete_playlist", { _playlist_id: created.playlist_id! }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("PLAYLIST-T3: direct client writes to playlist tables are rejected", async () => {
    const insert = await host.client
      .from("playlists")
      .insert({ owner_id: host.id, name: "Direct" });
    expect(insert.error).not.toBeNull();

    const items = await host.client.from("playlist_items").insert({
      playlist_id: crypto.randomUUID(),
      provider: "youtube",
      provider_media_id: "x",
      position: 1,
    });
    expect(items.error).not.toBeNull();
  });

  it("PLAYLIST-T4: unverified media cannot be added to a playlist", async () => {
    const created = await rpc(host, "create_playlist", { _name: "Fail closed" });
    expect(
      await rpc(host, "add_playlist_item", {
        _playlist_id: created.playlist_id!,
        _provider: "youtube",
        _media_id: "Q5NOPOLICY1",
      }),
    ).toMatchObject({ ok: false, reason: "provider_verification_failed" });
  });

  it("PLAYLIST-T5: starting a room from a playlist imports verified tracks only", async () => {
    await resetQueue();
    const created = await rpc(host, "create_playlist", { _name: "Party" });
    for (const track of TRACKS.slice(0, 2)) {
      expect(
        (
          await rpc(host, "add_playlist_item", {
            _playlist_id: created.playlist_id!,
            _provider: "youtube",
            _media_id: track,
          })
        ).ok,
      ).toBe(true);
    }

    expect(
      await rpc(member, "start_room_from_playlist", {
        _room_id: roomId,
        _playlist_id: created.playlist_id!,
      }),
    ).toMatchObject({ ok: false, reason: "forbidden" });

    const started = await rpc(host, "start_room_from_playlist", {
      _room_id: roomId,
      _playlist_id: created.playlist_id!,
    });
    expect(started).toMatchObject({ ok: true, added: 2 });
    expect((await snapshot()).items).toHaveLength(2);
  });
});
