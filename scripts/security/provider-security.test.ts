/**
 * PHASE 4.1 — YouTube provider hardening tests (PROVIDER-T1 … PROVIDER-T9).
 *
 * Runs against the real backend with genuine end-user JWTs. Focus is the
 * provider boundary: media-id validation in SQL, refusal of untrusted
 * metadata, rate limiting of provider selection, isolation of local provider
 * failures from authoritative state, and access control over playback rows.
 *
 * Skipped automatically when backend credentials are absent.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const url = process.env["SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
const enabled = Boolean(url && serviceKey && anonKey);
const suite = enabled ? describe : describe.skip;

const password = "Test-Password-123!";
const VIDEO = "dQw4w9WgXcQ";
const OTHER_VIDEO = "9bZkp7q19f0";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TestUser {
  id: string;
  client: SupabaseClient;
  token: string;
}

interface RpcResponse {
  ok: boolean;
  reason?: string;
  state?: { version: number; provider_media_id: string | null; playback_status: string };
}

suite("phase 4.1 YouTube provider hardening", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let roomId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p41-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  async function makeRoom(owner: TestUser, joinCode: string) {
    const { data, error } = await owner.client
      .from("rooms")
      .insert({
        owner_id: owner.id,
        host_id: owner.id,
        name: "Provider room",
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

  const rpc = async (user: TestUser, fn: string, args: Record<string, unknown>) => {
    const { data } = await user.client.rpc(fn, args);
    return (data ?? { ok: false, reason: "server_error" }) as RpcResponse;
  };

  const setMedia = (
    user: TestUser,
    room: string,
    args: Record<string, unknown> = {},
  ): Promise<RpcResponse> =>
    rpc(user, "set_room_media", {
      _room_id: room,
      _provider: "youtube",
      _media_id: VIDEO,
      _expected_version: null,
      ...args,
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
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    const joinCode = code("V");
    roomId = await makeRoom(host, joinCode);
    const join = await member.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);

    // Seed policy cache for the video used in these tests.
    await seedPolicy(VIDEO, "ok");
    await seedPolicy(OTHER_VIDEO, "ok");
  }, 120_000);

  // Rate limiting is asserted explicitly in PROVIDER-T6; every other test must
  // start from a clean budget so limiter state cannot mask a real assertion.
  afterEach(async () => {
    if (created.length > 0) {
      await admin
        .from("rate_limits")
        .delete()
        .in(
          "user_id",
          created.map((user) => user.id),
        );
    }
  });

  afterAll(async () => {
    for (const room of rooms) await admin.from("rooms").delete().eq("id", room);
    for (const user of created) {
      await user.client.auth.signOut();
      await admin.auth.admin.deleteUser(user.id);
    }
  }, 120_000);

  it("PROVIDER-T2: malformed media ids are rejected in SQL", async () => {
    const bad = [
      "",
      "short",
      "dQw4w9WgXcQextra",
      "dQw4w9WgXc!",
      "../../etc/passwd",
      "<script>x</script>",
      "dQw4w9WgXcQ ",
    ];
    for (const media of bad) {
      const res = await setMedia(host, roomId, { _media_id: media });
      expect(res).toMatchObject({ ok: false, reason: "invalid_request" });
    }
    const nullId = await setMedia(host, roomId, { _media_id: null });
    expect(nullId).toMatchObject({ ok: false, reason: "invalid_request" });
  }, 60_000);

  it("PROVIDER-T3: unsupported providers are rejected", async () => {
    for (const provider of ["spotify", "vimeo", "", "YOUTUBE", "youtube "]) {
      const res = await setMedia(host, roomId, { _provider: provider });
      expect(res).toMatchObject({ ok: false, reason: "invalid_request" });
    }
  }, 60_000);

  it("PROVIDER-T5: caller-supplied metadata is never stored or trusted", async () => {
    const res = await setMedia(host, roomId, {
      _title: "TOTALLY LEGIT BANK LOGIN",
      _thumbnail_url: "https://evil.test/phish.png",
    });
    expect(res).toMatchObject({ ok: true });

    const { data } = await admin
      .from("room_playback_state")
      .select("title, thumbnail_url, provider, provider_media_id")
      .eq("room_id", roomId)
      .single();
    expect(data?.title).toBeNull();
    expect(data?.thumbnail_url).toBeNull();
    expect(data?.provider).toBe("youtube");
    expect(data?.provider_media_id).toBe(VIDEO);
  }, 60_000);

  it("PROVIDER-T4: direct writes to playback state remain blocked", async () => {
    const insert = await host.client
      .from("room_playback_state")
      .insert({ room_id: roomId, provider: "youtube", provider_media_id: OTHER_VIDEO });
    expect(insert.error).not.toBeNull();

    const update = await host.client
      .from("room_playback_state")
      .update({ title: "injected", provider_media_id: OTHER_VIDEO })
      .eq("room_id", roomId)
      .select("room_id");
    expect(update.error ? true : (update.data ?? []).length === 0).toBe(true);

    const del = await host.client
      .from("room_playback_state")
      .delete()
      .eq("room_id", roomId)
      .select("room_id");
    expect(del.error ? true : (del.data ?? []).length === 0).toBe(true);

    const { data } = await admin
      .from("room_playback_state")
      .select("provider_media_id, title")
      .eq("room_id", roomId)
      .single();
    expect(data?.provider_media_id).toBe(VIDEO);
    expect(data?.title).toBeNull();
  }, 60_000);

  it("PROVIDER-T8: a non-member cannot read provider/playback state", async () => {
    const { data, error } = await outsider.client
      .from("room_playback_state")
      .select("room_id, provider_media_id")
      .eq("room_id", roomId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const mutate = await setMedia(outsider, roomId);
    expect(mutate.ok).toBe(false);
    expect(["forbidden", "not_found", "server_error"]).toContain(mutate.reason);
  }, 60_000);

  it("PROVIDER-T6: repeated provider selection is rate limited", async () => {
    const spammer = await makeUser("spam");
    const spamRoom = await makeRoom(spammer, code("W"));
    let limited = false;
    for (let i = 0; i < 20; i += 1) {
      const res = await setMedia(spammer, spamRoom, {
        _media_id: i % 2 === 0 ? VIDEO : OTHER_VIDEO,
      });
      if (!res.ok && res.reason === "rate_limited") {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  }, 120_000);

  it("PROVIDER-T7: a participant's local provider failure cannot change room state", async () => {
    // A viewer whose player fails has no write path at all: no RPC succeeds and
    // no direct write lands, so the room's authoritative row is unchanged.
    const before = await admin
      .from("room_playback_state")
      .select("version, provider_media_id, playback_status")
      .eq("room_id", roomId)
      .single();

    const attempts = await Promise.all([
      rpc(member, "pause_room_media", { _room_id: roomId }),
      rpc(member, "clear_room_media", { _room_id: roomId }),
      rpc(member, "seek_room_media", { _room_id: roomId, _position_seconds: 0 }),
      setMedia(member, roomId, { _media_id: OTHER_VIDEO }),
    ]);
    for (const attempt of attempts) expect(attempt.ok).toBe(false);

    const memberDirect = await member.client
      .from("room_playback_state")
      .update({ playback_status: "paused" })
      .eq("room_id", roomId)
      .select("room_id");
    expect(memberDirect.error ? true : (memberDirect.data ?? []).length === 0).toBe(true);

    const after = await admin
      .from("room_playback_state")
      .select("version, provider_media_id, playback_status")
      .eq("room_id", roomId)
      .single();
    expect(after.data).toEqual(before.data);
  }, 60_000);

  it("PROVIDER-T9: a removed member stops receiving playback rows", async () => {
    const watcher = await makeUser("watcher");
    const joinCode = code("X");
    const watchRoom = await makeRoom(host, joinCode);
    const join = await watcher.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);

    await watcher.client.realtime.setAuth(watcher.token);
    const seen: string[] = [];
    let channel: RealtimeChannel | null = null;
    await new Promise<void>((resolve) => {
      channel = watcher.client
        .channel(`provider-watch:${watchRoom}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_playback_state",
            filter: `room_id=eq.${watchRoom}`,
          },
          (payload) => seen.push(payload.eventType),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR") resolve();
        });
    });
    await wait(1200);

    expect(await setMedia(host, watchRoom)).toMatchObject({ ok: true });
    await wait(1500);
    expect(seen.length).toBeGreaterThanOrEqual(1);

    // Revoke membership server-side; the socket stays open.
    const { error: revokeError } = await admin
      .from("room_members")
      .update({ status: "kicked", left_at: new Date().toISOString() })
      .eq("room_id", watchRoom)
      .eq("user_id", watcher.id);
    expect(revokeError).toBeNull();
    await wait(1200);

    const before = seen.length;
    expect(
      await rpc(host, "seek_room_media", { _room_id: watchRoom, _position_seconds: 42 }),
    ).toMatchObject({ ok: true });
    await wait(2500);
    expect(seen.length).toBe(before);

    // And the removed member can no longer authorize a fresh subscription.
    const { data: allowed } = await watcher.client.rpc("authorize_room_channel", {
      _room_id: watchRoom,
    });
    expect(allowed).toBe(false);

    if (channel) await watcher.client.removeChannel(channel);
  }, 120_000);
});
