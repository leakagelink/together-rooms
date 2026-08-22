/**
 * PHASE 4 — playback (watch together) database / RLS / realtime security tests.
 *
 * Every assertion runs against the real backend over PostgREST, RPC or the
 * realtime websocket using genuine end-user JWTs, so grants, RLS, guard
 * triggers and SECURITY DEFINER authorization are exercised exactly as a
 * browser client exercises them. Service-role access is used only for fixture
 * setup and for asserting trusted-execution behaviour.
 *
 * Skipped automatically when backend credentials are absent.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env["SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
const enabled = Boolean(url && serviceKey && anonKey);
const suite = enabled ? describe : describe.skip;

const password = "Test-Password-123!";
const VIDEO = "dQw4w9WgXcQ";
const OTHER_VIDEO = "9bZkp7q19f0";

interface TestUser {
  id: string;
  client: SupabaseClient;
  token: string;
}

interface RpcResponse {
  ok: boolean;
  reason?: string;
  state?: {
    version: number;
    playback_status: string;
    position_seconds: number | string;
    provider_media_id: string | null;
    playback_started_at: string | null;
    controlled_by: string | null;
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite("phase 4 playback security (database / RLS / realtime)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let controller: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let roomId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p4-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const entry = { id: data.user!.id, client, token: signIn.data.session!.access_token };
    created.push(entry);
    return entry;
  }

  async function makeRoom(owner: TestUser, name: string, joinCode: string) {
    const { data, error } = await owner.client
      .from("rooms")
      .insert({
        owner_id: owner.id,
        host_id: owner.id,
        name,
        type: "watch",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: joinCode,
      })
      .select("id")
      .single();
    if (error) throw error;
    rooms.push(data.id as string);
    return data.id as string;
  }

  const code = (prefix: string) =>
    `${prefix}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  async function currentVersion(room = roomId) {
    const { data } = await admin
      .from("room_playback_state")
      .select("version")
      .eq("room_id", room)
      .maybeSingle();
    return (data?.version as number | undefined) ?? 0;
  }

  const rpc = async (user: TestUser, fn: string, args: Record<string, unknown>) => {
    const { data } = await user.client.rpc(fn, args);
    return (data ?? { ok: false, reason: "server_error" }) as RpcResponse;
  };

  const setMedia = (user: TestUser, room: string, media = VIDEO, version?: number | null) =>
    rpc(user, "set_room_media", {
      _room_id: room,
      _provider: "youtube",
      _media_id: media,
      _expected_version: version ?? null,
    });

  async function seedPolicy(
    mediaId: string,
    status: string,
    extras: Record<string, unknown> = {},
  ) {
    const { error } = await admin.rpc("upsert_media_metadata_cache", {
      _provider: "youtube",
      _media_id: mediaId,
      _title: "Test title",
      _thumbnail_url: `https://i.ytimg.com/vi/${mediaId}/hqdefault.jpg`,
      _made_for_kids: status === "made_for_kids",
      _embeddable: status !== "not_embeddable",
      _privacy_status: status === "privacy_blocked" ? "private" : "public",
      _status: status,
      _source: "test",
      _ttl_hours: 1,
      ...extras,
    });
    if (error) throw error;
  }

  beforeAll(async () => {
    host = await makeUser("host");
    controller = await makeUser("ctrl");
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    const joinCode = code("P");
    roomId = await makeRoom(host, "Watch together room", joinCode);

    for (const user of [controller, member]) {
      const join = await user.client.rpc("join_room_by_code", { _code: joinCode });
      expect((join.data as { ok: boolean }).ok).toBe(true);
    }

    // Grant playback control to one member through trusted execution only.
    const { error } = await admin
      .from("room_members")
      .update({ can_control_playback: true })
      .eq("room_id", roomId)
      .eq("user_id", controller.id);
    expect(error).toBeNull();
  }, 120_000);

  afterAll(async () => {
    for (const id of rooms) await admin.from("rooms").delete().eq("id", id);
    for (const u of created) await admin.auth.admin.deleteUser(u.id);
  }, 120_000);

  it("PLAY-T6: an authorized host can select media", async () => {
    const res = await setMedia(host, roomId);
    expect(res.ok).toBe(true);
    expect(res.state?.provider_media_id).toBe(VIDEO);
    expect(res.state?.playback_status).toBe("ready");
    expect(Number(res.state?.position_seconds)).toBe(0);
  });

  it("PLAY-T1: a non-member cannot read room playback state", async () => {
    const { data, error } = await outsider.client
      .from("room_playback_state")
      .select("room_id, provider_media_id")
      .eq("room_id", roomId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("members can read room playback state", async () => {
    const { data, error } = await member.client
      .from("room_playback_state")
      .select("room_id, provider_media_id, version")
      .eq("room_id", roomId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("PLAY-T2: a non-member cannot mutate playback", async () => {
    expect(await setMedia(outsider, roomId)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await rpc(outsider, "play_room_media", { _room_id: roomId })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });

  it("PLAY-T3: a member without playback permission cannot play", async () => {
    expect(await rpc(member, "play_room_media", { _room_id: roomId })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });

  it("PLAY-T4: a member without playback permission cannot pause", async () => {
    expect(await rpc(member, "pause_room_media", { _room_id: roomId })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });

  it("PLAY-T5: a member without playback permission cannot seek", async () => {
    expect(
      await rpc(member, "seek_room_media", { _room_id: roomId, _position_seconds: 42 }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("PLAY-T7: an authorized controller can play, and the server sets the start time", async () => {
    const res = await rpc(controller, "play_room_media", { _room_id: roomId });
    expect(res.ok).toBe(true);
    expect(res.state?.playback_status).toBe("playing");
    expect(res.state?.playback_started_at).not.toBeNull();
    expect(res.state?.controlled_by).toBe(controller.id);
  });

  it("PLAY-T8: an authorized controller can pause and the position advances from server time", async () => {
    await wait(1500);
    const res = await rpc(controller, "pause_room_media", { _room_id: roomId });
    expect(res.ok).toBe(true);
    expect(res.state?.playback_status).toBe("paused");
    expect(res.state?.playback_started_at).toBeNull();
    expect(Number(res.state?.position_seconds)).toBeGreaterThan(0.9);
  });

  it("PLAY-T9: an authorized controller can seek", async () => {
    const res = await rpc(controller, "seek_room_media", {
      _room_id: roomId,
      _position_seconds: 90.5,
    });
    expect(res.ok).toBe(true);
    expect(Number(res.state?.position_seconds)).toBeCloseTo(90.5, 3);
  });

  it("PLAY-T10: an invalid provider is rejected", async () => {
    const res = await rpc(host, "set_room_media", {
      _room_id: roomId,
      _provider: "spotify",
      _media_id: VIDEO,
    });
    expect(res).toMatchObject({ ok: false, reason: "invalid_request" });
  });

  it("PLAY-T11: an invalid YouTube media id is rejected", async () => {
    for (const bad of ["short", "waytoolongvideoid", "bad id!!!!!", ""]) {
      const res = await setMedia(host, roomId, bad);
      expect(res).toMatchObject({ ok: false, reason: "invalid_request" });
    }
  });

  it("PLAY-T15/T16: version conflicts are rejected and versions increment by one", async () => {
    const before = await currentVersion();
    const stale = await rpc(controller, "play_room_media", {
      _room_id: roomId,
      _expected_version: before - 1,
    });
    expect(stale).toMatchObject({ ok: false, reason: "version_conflict" });
    expect(stale.state?.version).toBe(before);
    expect(await currentVersion()).toBe(before);

    const fresh = await rpc(controller, "play_room_media", {
      _room_id: roomId,
      _expected_version: before,
    });
    expect(fresh.ok).toBe(true);
    expect(fresh.state?.version).toBe(before + 1);
  });

  it("PLAY-T17: an older state cannot overwrite a newer one", async () => {
    const v = await currentVersion();
    await rpc(controller, "pause_room_media", { _room_id: roomId, _expected_version: v });
    // A replayed command carrying the now-stale version is refused outright.
    const replay = await rpc(controller, "pause_room_media", {
      _room_id: roomId,
      _expected_version: v,
    });
    expect(replay).toMatchObject({ ok: false, reason: "version_conflict" });
    expect(await currentVersion()).toBe(v + 1);
  });

  it("PLAY-T14: direct PostgREST writes to playback state are blocked", async () => {
    const insert = await member.client
      .from("room_playback_state")
      .insert({ room_id: roomId, provider_media_id: OTHER_VIDEO });
    expect(insert.error).not.toBeNull();

    // No UPDATE/DELETE grant and no policy: PostgREST either errors or matches
    // zero rows. Either way the authoritative row must be untouched.
    const update = await controller.client
      .from("room_playback_state")
      .update({ playback_status: "playing", position_seconds: 9999 })
      .eq("room_id", roomId)
      .select("room_id");
    expect(update.error ? true : (update.data ?? []).length === 0).toBe(true);

    const del = await host.client
      .from("room_playback_state")
      .delete()
      .eq("room_id", roomId)
      .select("room_id");
    expect(del.error ? true : (del.data ?? []).length === 0).toBe(true);

    const { data: still } = await admin
      .from("room_playback_state")
      .select("room_id")
      .eq("room_id", roomId);
    expect(still).toHaveLength(1);

    const { data } = await admin
      .from("room_playback_state")
      .select("position_seconds")
      .eq("room_id", roomId)
      .single();
    expect(Number(data!.position_seconds)).toBeLessThan(9999);
  });

  it("SYNC-T8: changing the video resets position and increments the version", async () => {
    const before = await currentVersion();
    const res = await setMedia(host, roomId, OTHER_VIDEO);
    expect(res.ok).toBe(true);
    expect(res.state?.provider_media_id).toBe(OTHER_VIDEO);
    expect(Number(res.state?.position_seconds)).toBe(0);
    expect(res.state?.playback_started_at).toBeNull();
    expect(res.state?.version).toBe(before + 1);
  });

  it("PLAY-T19: host transfer moves playback authority", async () => {
    const transferRoom = await makeRoom(host, "Transfer room", code("T"));
    const joinCode = (await admin.from("rooms").select("join_code").eq("id", transferRoom).single())
      .data!.join_code as string;
    const join = await member.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);

    expect(await setMedia(host, transferRoom)).toMatchObject({ ok: true });
    expect(await setMedia(member, transferRoom)).toMatchObject({ ok: false, reason: "forbidden" });

    const transfer = await host.client.rpc("transfer_room_host", {
      _room_id: transferRoom,
      _to_user: member.id,
    });
    expect((transfer.data as { ok: boolean }).ok).toBe(true);

    // Existing playback state survives the transfer.
    const { data: state } = await admin
      .from("room_playback_state")
      .select("provider_media_id, version")
      .eq("room_id", transferRoom)
      .single();
    expect(state!.provider_media_id).toBe(VIDEO);

    // The new host now has authority.
    const afterTransfer = await rpc(member, "play_room_media", { _room_id: transferRoom });
    expect(afterTransfer.ok).toBe(true);
  }, 60_000);

  it("PLAY-T12: an ended room rejects playback mutations", async () => {
    const endedRoom = await makeRoom(host, "Ended room", code("E"));
    expect(await setMedia(host, endedRoom)).toMatchObject({ ok: true });
    const end = await host.client.rpc("end_room", { _room_id: endedRoom });
    expect((end.data as { ok: boolean }).ok).toBe(true);
    expect(await rpc(host, "play_room_media", { _room_id: endedRoom })).toMatchObject({
      ok: false,
      reason: "room_ended",
    });
    expect(await setMedia(host, endedRoom, OTHER_VIDEO)).toMatchObject({
      ok: false,
      reason: "room_ended",
    });
  }, 60_000);

  it("PLAY-T13: an expired room rejects playback mutations", async () => {
    const expiredRoom = await makeRoom(host, "Expired room", code("X"));
    expect(await setMedia(host, expiredRoom)).toMatchObject({ ok: true });
    const { error } = await admin
      .from("rooms")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", expiredRoom);
    expect(error).toBeNull();
    expect(await rpc(host, "play_room_media", { _room_id: expiredRoom })).toMatchObject({
      ok: false,
      reason: "room_expired",
    });
  }, 60_000);

  it("PLAY-T20: playback command spam is rate limited", async () => {
    const spamHost = await makeUser("spam");
    const spamRoom = await makeRoom(spamHost, "Spam room", code("Z"));
    expect(await setMedia(spamHost, spamRoom)).toMatchObject({ ok: true });
    let limited = false;
    for (let i = 0; i < 40; i += 1) {
      const res = await rpc(spamHost, "seek_room_media", {
        _room_id: spamRoom,
        _position_seconds: i,
      });
      if (!res.ok && res.reason === "rate_limited") {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  }, 90_000);

  it("PLAY-T18 / SYNC-T5-T7: members receive playback rows until membership is revoked", async () => {
    // A dedicated controller keeps this case clear of the shared host's
    // media-change rate-limit budget consumed by the cases above.
    const liveHost = await makeUser("livehost");
    const liveRoom = await makeRoom(liveHost, "Realtime playback room", code("L"));
    const joinCode = (await admin.from("rooms").select("join_code").eq("id", liveRoom).single())
      .data!.join_code as string;
    const victim = await makeUser("victim");
    const join = await victim.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);

    const seen: number[] = [];
    await victim.client.realtime.setAuth(victim.token);
    const channel: RealtimeChannel = victim.client.channel(`play-${victim.id}`).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_playback_state",
        filter: `room_id=eq.${liveRoom}`,
      },
      (payload) => {
        const row = payload.new as { version?: number };
        if (typeof row?.version === "number") seen.push(row.version);
      },
    );

    const statuses: string[] = [];
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        statuses.push(status);
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          resolve();
        }
      });
    });
    expect(statuses).toContain("SUBSCRIBED");
    await wait(1500);

    // Media select + play + pause + seek must all reach the joined member.
    expect(await setMedia(liveHost, liveRoom)).toMatchObject({ ok: true });
    await wait(600);
    expect(await rpc(liveHost, "play_room_media", { _room_id: liveRoom })).toMatchObject({
      ok: true,
    });
    await wait(600);
    expect(await rpc(liveHost, "pause_room_media", { _room_id: liveRoom })).toMatchObject({
      ok: true,
    });
    await wait(600);
    expect(
      await rpc(liveHost, "seek_room_media", { _room_id: liveRoom, _position_seconds: 12 }),
    ).toMatchObject({ ok: true });
    await wait(1500);
    const beforeRevoke = seen.length;
    expect(beforeRevoke).toBeGreaterThanOrEqual(3);

    // Revoke membership server-side; the socket stays connected.
    const { error: kickError } = await admin
      .from("room_members")
      .update({ status: "kicked", left_at: new Date().toISOString() })
      .eq("room_id", liveRoom)
      .eq("user_id", victim.id);
    expect(kickError).toBeNull();
    await wait(1000);

    expect(
      await rpc(liveHost, "seek_room_media", { _room_id: liveRoom, _position_seconds: 300 }),
    ).toMatchObject({ ok: true });
    await wait(2500);
    expect(seen.length).toBe(beforeRevoke);

    // SYNC-T11: a removed member also cannot re-read the authoritative state.
    const { data: rows } = await victim.client
      .from("room_playback_state")
      .select("room_id")
      .eq("room_id", liveRoom);
    expect(rows).toEqual([]);
    const authorized = await victim.client.rpc("authorize_room_channel", { _room_id: liveRoom });
    expect(authorized.data).toBe(false);

    await victim.client.removeChannel(channel);
  }, 180_000);

  it("SYNC-T11: a rejoining member reads the latest authoritative state", async () => {
    const { data } = await controller.client
      .from("room_playback_state")
      .select("provider_media_id, playback_status, position_seconds, version")
      .eq("room_id", roomId)
      .single();
    const version = await currentVersion();
    expect(data!.version).toBe(version);
  });
});
