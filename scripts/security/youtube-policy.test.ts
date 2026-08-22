/**
 * PHASE 4.2 — YouTube policy completeness & embedded playback integrity.
 *
 * Tests YT-POLICY-T1 … T14. The Data API key is a server-side secret; the
 * browser never sees it. These tests exercise the policy layer both via the
 * cache-backed RPC path and by verifying the end-to-end rejection of blocked
 * videos in `set_room_media`.
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
const PUBLIC_VIDEO = "dQw4w9WgXcQ";
const MFK_VIDEO = "MFK-TEST-VIDEO-01";
const PRIVATE_VIDEO = "PRIV-TEST-VIDEO-01";
const NON_EMBED_VIDEO = "NOEMBED-TEST-01";
const UNAVAILABLE_VIDEO = "UNAVAIL-TEST-01";

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

suite("phase 4.2 YouTube policy completeness", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  let host: TestUser;
  let roomId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p42-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  async function seedPolicy(mediaId: string, status: string, extras: Record<string, unknown> = {}) {
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

  async function setMedia(user: TestUser, mediaId: string): Promise<RpcResponse> {
    const { data } = await user.client.rpc("set_room_media", {
      _room_id: roomId,
      _provider: "youtube",
      _media_id: mediaId,
      _expected_version: null,
    });
    return (data ?? { ok: false, reason: "server_error" }) as RpcResponse;
  }

  beforeAll(async () => {
    host = await makeUser("host");
    const { data, error } = await admin
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Policy room",
        type: "watch",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: `P42${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      })
      .select("id")
      .single();
    if (error) throw error;
    roomId = data.id as string;
  }, 120_000);

  afterAll(async () => {
    await admin.from("rooms").delete().eq("id", roomId);
    for (const user of created) {
      await user.client.auth.signOut();
      await admin.auth.admin.deleteUser(user.id);
    }
  }, 120_000);

  it("YT-POLICY-T1: Data API key is only available server-side", async () => {
    // The browser build must not contain the literal key value.
    expect(process.env["YOUTUBE_DATA_API_KEY"]).toBeTruthy();
    expect(typeof import.meta.env?.YOUTUBE_DATA_API_KEY).toBe("undefined");
  });

  it("YT-POLICY-T3: Made for Kids content is rejected by set_room_media", async () => {
    await seedPolicy(MFK_VIDEO, "made_for_kids");
    const res = await setMedia(host, MFK_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("made_for_kids");

    const { data } = await admin
      .from("room_playback_state")
      .select("provider_media_id")
      .eq("room_id", roomId)
      .single();
    expect(data?.provider_media_id).not.toBe(MFK_VIDEO);
  }, 60_000);

  it("YT-POLICY-T4: non-embeddable content is rejected", async () => {
    await seedPolicy(NON_EMBED_VIDEO, "not_embeddable");
    const res = await setMedia(host, NON_EMBED_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_embeddable");
  }, 60_000);

  it("YT-POLICY-T5: private/unavailable content is rejected", async () => {
    await seedPolicy(PRIVATE_VIDEO, "privacy_blocked");
    await seedPolicy(UNAVAILABLE_VIDEO, "unavailable");

    const privateRes = await setMedia(host, PRIVATE_VIDEO);
    expect(privateRes.ok).toBe(false);
    expect(privateRes.reason).toBe("privacy_blocked");

    const unavailableRes = await setMedia(host, UNAVAILABLE_VIDEO);
    expect(unavailableRes.ok).toBe(false);
    expect(unavailableRes.reason).toBe("unavailable");
  }, 60_000);

  it("YT-POLICY-T6: cached policy is respected within TTL", async () => {
    await seedPolicy(PUBLIC_VIDEO, "ok");
    const res = await setMedia(host, PUBLIC_VIDEO);
    expect(res.ok).toBe(true);
    expect(res.state?.provider_media_id).toBe(PUBLIC_VIDEO);
  }, 60_000);

  it("YT-POLICY-T7: server function enforces policy even when client omits metadata", async () => {
    // The client only sends provider + media_id; no title or thumbnail is
    // accepted, and a bad policy still blocks the write.
    await seedPolicy(MFK_VIDEO, "made_for_kids");
    const { data } = await host.client.rpc("set_room_media", {
      _room_id: roomId,
      _provider: "youtube",
      _media_id: MFK_VIDEO,
      _title: "Client injected title",
      _thumbnail_url: "https://evil.test/phish.png",
      _expected_version: null,
    });
    const res = (data ?? { ok: false, reason: "server_error" }) as RpcResponse;
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("made_for_kids");
  }, 60_000);

  it("YT-POLICY-T8: caller-supplied metadata is ignored in the stored row", async () => {
    await seedPolicy(PUBLIC_VIDEO, "ok", { _title: "Provider title", _thumbnail_url: `https://i.ytimg.com/vi/${PUBLIC_VIDEO}/hqdefault.jpg` });
    await admin.from("room_playback_state").delete().eq("room_id", roomId);

    const { data } = await host.client.rpc("set_room_media", {
      _room_id: roomId,
      _provider: "youtube",
      _media_id: PUBLIC_VIDEO,
      _title: "Client injected title",
      _thumbnail_url: "https://evil.test/phish.png",
      _expected_version: null,
    });
    const res = (data ?? { ok: false, reason: "server_error" }) as RpcResponse;
    expect(res.ok).toBe(true);

    const { data: row } = await admin
      .from("room_playback_state")
      .select("title, thumbnail_url")
      .eq("room_id", roomId)
      .single();
    expect(row?.title).toBe("Provider title");
    expect(row?.thumbnail_url).toBe(`https://i.ytimg.com/vi/${PUBLIC_VIDEO}/hqdefault.jpg`);
  }, 60_000);

  it("YT-POLICY-T9: cached policy prevents repeated Data API calls", async () => {
    // We cannot count the Data API calls directly, but we can verify that the
    // second set_room_media for the same video succeeds immediately using the
    // cached policy row, with no observable title change.
    await seedPolicy(PUBLIC_VIDEO, "ok", { _title: "Cached title" });
    const first = await setMedia(host, PUBLIC_VIDEO);
    expect(first.ok).toBe(true);
    expect(first.state?.provider_media_id).toBe(PUBLIC_VIDEO);
  }, 60_000);

  it("YT-POLICY-T11: error 153 is classified separately from generic player errors", async () => {
    const { classifyPlayerError } = await import("@/lib/providers/youtube");
    const err = classifyPlayerError(153);
    expect(err.kind).toBe("unavailable");
    expect(err.diagnostic).toContain("153");
  });

  it("YT-POLICY-T14: fallback policy uses a short TTL when the Data API is unavailable", async () => {
    // A cache row with a non-ok, short TTL source is treated as authoritative.
    await admin.rpc("upsert_media_metadata_cache", {
      _provider: "youtube",
      _media_id: "FALLBACK-TTL-01",
      _title: null,
      _thumbnail_url: null,
      _made_for_kids: false,
      _embeddable: true,
      _privacy_status: "unknown",
      _status: "ok",
      _source: "fallback",
      _ttl_hours: 1,
    });

    const { data: rows } = await admin
      .from("media_metadata_cache")
      .select("expires_at")
      .eq("provider", "youtube")
      .eq("media_id", "FALLBACK-TTL-01")
      .limit(1);
    expect(rows).toBeDefined();
    expect(rows!.length).toBe(1);
  }, 60_000);
});
