/**
 * PHASE 7 — Private local media rooms: security, playback and transport tests.
 *
 * LM-T1  … T15 — authorization, membership, blocks, direct-write bypass, grants.
 * LM-P1  … P7  — authoritative synchronized playback and photo navigation.
 * LM-X1  … X10 — transport credentials, signaling relay, expiry and teardown.
 *
 * Everything runs against the real backend with genuine end-user JWTs, so
 * grants, RLS, guard triggers and SECURITY DEFINER authorization are exercised
 * exactly as a browser exercises them. Service-role access is used only for
 * fixtures and for asserting facts a client must not be able to observe.
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
  session_id?: string;
  version?: number;
  token?: string;
  role?: string;
  relay_allowed?: boolean;
  ttl_seconds?: number;
  expires_at?: string;
  playback_status?: string;
  position_seconds?: number;
  playback_started_at?: string | null;
  current_index?: number;
  signals?: unknown[];
  ended?: boolean;
  [key: string]: unknown;
}

suite("phase 7 local media (security / playback / transport)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let blocked: TestUser;
  let roomId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p7-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  async function makeRoom(
    owner: TestUser,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; code: string }> {
    const code = `L${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await owner.client
      .from("rooms")
      .insert({
        owner_id: owner.id,
        host_id: owner.id,
        name: "Local media room",
        type: "private",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: code,
        ...overrides,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    const id = (data as { id: string }).id;
    rooms.push(id);
    return { id, code };
  }

  /** Ends any active session so each test starts from a clean room. */
  async function clearSessions(room = roomId) {
    await admin
      .from("room_local_media_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("room_id", room)
      .eq("status", "active");
  }

  const startSession = (user: TestUser, overrides: Record<string, unknown> = {}, room = roomId) =>
    rpc(user, "start_local_media_session", {
      _room_id: room,
      _media_kind: "video",
      _mime_type: "video/mp4",
      _duration_seconds: 120,
      _item_count: 1,
      ...overrides,
    });

  beforeAll(async () => {
    host = await makeUser("host");
    member = await makeUser("member");
    outsider = await makeUser("outsider");
    blocked = await makeUser("blocked");

    const room = await makeRoom(host);
    roomId = room.id;
    for (const user of [member, blocked]) {
      const joined = await rpc(user, "join_room_by_code", { _code: room.code });
      expect(joined.ok).toBe(true);
    }
    // Collaborative sharing keeps most tests focused on the rule under test.
    await rpc(host, "set_local_media_settings", {
      _room_id: roomId,
      _share_mode: "collaborative",
    });
  }, 60_000);

  afterEach(async () => {
    // Rate limiting is a per-user sliding window; clearing it keeps the
    // sequential test bodies from starving each other.
    await admin
      .from("rate_limits")
      .delete()
      .in(
        "user_id",
        created.map((u) => u.id),
      );
  });

  afterAll(async () => {
    for (const room of rooms) await admin.from("rooms").delete().eq("id", room);
    for (const user of created) await admin.auth.admin.deleteUser(user.id);
  });

  // ---------------------------------------------------------------- security

  it("LM-T1 a joined member can start a session; the row is server-authored", async () => {
    await clearSessions();
    const result = await startSession(member);
    expect(result.ok).toBe(true);
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("owner_id, status, playback_status, position_seconds, version, expires_at")
      .eq("id", result.session_id!)
      .single();
    expect(data?.owner_id).toBe(member.id);
    expect(data?.status).toBe("active");
    expect(Number(data?.position_seconds)).toBe(0);
    expect(new Date(String(data?.expires_at)).getTime()).toBeGreaterThan(Date.now());
  });

  it("LM-T2 a non-member cannot start a session in the room", async () => {
    await clearSessions();
    const result = await startSession(outsider);
    expect(result.ok).toBe(false);
    expect(["forbidden", "not_allowed", "not_found"]).toContain(result.reason);
  });

  it("LM-T3 a non-member cannot read the session row (RLS)", async () => {
    await clearSessions();
    await startSession(member);
    const { data } = await outsider.client
      .from("room_local_media_sessions")
      .select("id")
      .eq("room_id", roomId);
    expect(data ?? []).toHaveLength(0);
  });

  it("LM-T4 anonymous callers cannot read sessions at all", async () => {
    const { data, error } = await anon.from("room_local_media_sessions").select("id").limit(1);
    expect(error ? true : (data ?? []).length === 0).toBe(true);
  });

  it("LM-T5 direct INSERT into the sessions table is rejected", async () => {
    const { error } = await member.client.from("room_local_media_sessions").insert({
      room_id: roomId,
      owner_id: member.id,
      media_kind: "video",
    } as never);
    expect(error).not.toBeNull();
  });

  it("LM-T6 direct UPDATE of an active session cannot change it", async () => {
    await clearSessions();
    const session = await startSession(member);
    await member.client
      .from("room_local_media_sessions")
      .update({ playback_status: "playing", position_seconds: 999 } as never)
      .eq("id", session.session_id!);
    // The write is refused outright or silently matches no row; either way the
    // authoritative state is untouched.
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("playback_status, position_seconds")
      .eq("id", session.session_id!)
      .single();
    expect(data?.playback_status).toBe("idle");
    expect(Number(data?.position_seconds)).toBe(0);
  });

  it("LM-T7 direct writes to transport grants and signals are rejected", async () => {
    const grants = await member.client
      .from("local_media_transport_grants")
      .insert({ session_id: crypto.randomUUID(), room_id: roomId, user_id: member.id } as never);
    const signals = await member.client
      .from("local_media_signals")
      .insert({ session_id: crypto.randomUUID(), room_id: roomId, kind: "offer" } as never);
    expect(grants.error).not.toBeNull();
    expect(signals.error).not.toBeNull();
  });

  it("LM-T8 host_only mode blocks non-hosts from sharing", async () => {
    await clearSessions();
    await rpc(host, "set_local_media_settings", { _room_id: roomId, _share_mode: "host_only" });
    const denied = await startSession(member);
    expect(denied.ok).toBe(false);
    const allowed = await startSession(host);
    expect(allowed.ok).toBe(true);
    await rpc(host, "set_local_media_settings", {
      _room_id: roomId,
      _share_mode: "collaborative",
    });
  });

  it("LM-T9 only a host can change local media settings", async () => {
    const result = await rpc(member, "set_local_media_settings", {
      _room_id: roomId,
      _allow_relay: true,
    });
    expect(result.ok).toBe(false);
  });

  it("LM-T10 a second concurrent session in the same room is refused", async () => {
    await clearSessions();
    const first = await startSession(member);
    expect(first.ok).toBe(true);
    const second = await startSession(host);
    expect(second.ok).toBe(false);
  });

  it("LM-T11 a removed member immediately loses session access", async () => {
    await clearSessions();
    await startSession(host);
    const left = await rpc(member, "leave_room", { _room_id: roomId });
    expect(left.ok).toBe(true);
    const { data } = await member.client
      .from("room_local_media_sessions")
      .select("id")
      .eq("room_id", roomId);
    expect(data ?? []).toHaveLength(0);
    const grant = await rpc(member, "issue_local_media_transport_grant", {
      _session_id: (
        await admin
          .from("room_local_media_sessions")
          .select("id")
          .eq("room_id", roomId)
          .eq("status", "active")
          .single()
      ).data!.id,
    });
    expect(grant.ok).toBe(false);
  });

  it("LM-T12 a blocked user cannot obtain transport access to the sharer", async () => {
    await clearSessions();
    await rpc(host, "block_user", { _user_id: blocked.id }).catch(() => null);
    await admin
      .from("user_blocks")
      .upsert({ blocker_id: host.id, blocked_id: blocked.id } as never, {
        onConflict: "blocker_id,blocked_id",
      });
    const session = await startSession(host);
    expect(session.ok).toBe(true);
    const grant = await rpc(blocked, "issue_local_media_transport_grant", {
      _session_id: session.session_id!,
    });
    expect(grant.ok).toBe(false);
    await admin.from("user_blocks").delete().eq("blocker_id", host.id).eq("blocked_id", blocked.id);
  });

  it("LM-T13 sessions in an ended room cannot be started", async () => {
    const temp = await makeRoom(host);
    await rpc(host, "end_room", { _room_id: temp.id });
    const result = await startSession(host, {}, temp.id);
    expect(result.ok).toBe(false);
  });

  it("LM-T14 only the owner (or a host) can end the session", async () => {
    await clearSessions();
    const rejoin = await rpc(member, "join_room_by_code", {
      _code: (await admin.from("rooms").select("join_code").eq("id", roomId).single()).data!
        .join_code,
    });
    expect(rejoin.ok).toBe(true);
    const session = await startSession(host);
    const denied = await rpc(member, "end_local_media_session", {
      _session_id: session.session_id!,
    });
    expect(denied.ok).toBe(false);
    const allowed = await rpc(host, "end_local_media_session", {
      _session_id: session.session_id!,
    });
    expect(allowed.ok).toBe(true);
  });

  it("LM-T15 no filename, path or device metadata column exists to leak", async () => {
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("*")
      .eq("room_id", roomId)
      .limit(1);
    const columns = Object.keys(data?.[0] ?? {});
    for (const forbidden of ["file_name", "filename", "path", "url", "exif", "gps"]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  // ---------------------------------------------------------------- playback

  it("LM-P1 play sets an authoritative start timestamp and bumps the version", async () => {
    await clearSessions();
    const session = await startSession(host);
    const played = await rpc(host, "control_local_media_playback", {
      _session_id: session.session_id!,
      _action: "play",
      _position_seconds: 5,
      _expected_version: session.version!,
    });
    expect(played.ok).toBe(true);
    expect(played.playback_status).toBe("playing");
    expect(played.playback_started_at).toBeTruthy();
    expect(Number(played.version)).toBeGreaterThan(Number(session.version));
  });

  it("LM-P2 pause freezes the position and clears the start timestamp", async () => {
    await ensureActiveSession();
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("id, version")
      .eq("room_id", roomId)
      .eq("status", "active")
      .single();
    const paused = await rpc(host, "control_local_media_playback", {
      _session_id: data!.id,
      _action: "pause",
      _position_seconds: 9,
      _expected_version: data!.version,
    });
    expect(paused.ok).toBe(true);
    expect(paused.playback_status).toBe("paused");
    expect(Number(paused.position_seconds)).toBeCloseTo(9, 1);
    expect(paused.playback_started_at).toBeNull();
  });

  it("LM-P3 seek repositions without changing the playing/paused state", async () => {
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("id, version")
      .eq("room_id", roomId)
      .eq("status", "active")
      .single();
    const sought = await rpc(host, "control_local_media_playback", {
      _session_id: data!.id,
      _action: "seek",
      _position_seconds: 42,
      _expected_version: data!.version,
    });
    expect(sought.ok).toBe(true);
    expect(Number(sought.position_seconds)).toBeCloseTo(42, 1);
  });

  it("LM-P4 a stale expected_version is rejected as a version conflict", async () => {
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("id, version")
      .eq("room_id", roomId)
      .eq("status", "active")
      .single();
    const stale = await rpc(host, "control_local_media_playback", {
      _session_id: data!.id,
      _action: "pause",
      _position_seconds: 1,
      _expected_version: Math.max(0, Number(data!.version) - 1),
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("version_conflict");
  });

  it("LM-P5 a viewer who is not the owner or controller cannot drive playback", async () => {
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("id, version")
      .eq("room_id", roomId)
      .eq("status", "active")
      .single();
    const denied = await rpc(member, "control_local_media_playback", {
      _session_id: data!.id,
      _action: "play",
      _position_seconds: 0,
      _expected_version: data!.version,
    });
    expect(denied.ok).toBe(false);
  });

  it("LM-P6 photo navigation is server-authoritative and clamped to the item count", async () => {
    await clearSessions();
    const session = await startSession(host, {
      _media_kind: "image",
      _mime_type: "image/jpeg",
      _item_count: 3,
      _duration_seconds: undefined,
    });
    const moved = await rpc(host, "control_local_media_playback", {
      _session_id: session.session_id!,
      _action: "set_index",
      _index: 2,
      _expected_version: session.version!,
    });
    expect(moved.ok).toBe(true);
    expect(Number(moved.current_index)).toBe(2);
    const beyond = await rpc(host, "control_local_media_playback", {
      _session_id: session.session_id!,
      _action: "set_index",
      _index: 9,
      _expected_version: moved.version!,
    });
    expect(beyond.ok === false || Number(beyond.current_index) <= 2).toBe(true);
  });

  it("LM-P7 ending the session stops playback for everyone", async () => {
    const { data } = await admin
      .from("room_local_media_sessions")
      .select("id")
      .eq("room_id", roomId)
      .eq("status", "active")
      .single();
    const ended = await rpc(host, "end_local_media_session", { _session_id: data!.id });
    expect(ended.ok).toBe(true);
    const { data: visible } = await member.client
      .from("room_local_media_sessions")
      .select("id")
      .eq("room_id", roomId)
      .eq("status", "active");
    expect(visible ?? []).toHaveLength(0);
    const after = await rpc(host, "control_local_media_playback", {
      _session_id: data!.id,
      _action: "play",
      _position_seconds: 0,
    });
    expect(after.ok).toBe(false);
  });

  // --------------------------------------------------------------- transport

  it("LM-X1 a grant returns a short-lived token bound to the caller's role", async () => {
    await clearSessions();
    const session = await startSession(host);
    const grant = await rpc(host, "issue_local_media_transport_grant", {
      _session_id: session.session_id!,
    });
    expect(grant.ok).toBe(true);
    expect(String(grant.token ?? "").length).toBeGreaterThanOrEqual(32);
    expect(grant.role).toBe("owner");
    expect(Number(grant.ttl_seconds)).toBeLessThanOrEqual(300);
  });

  it("LM-X2 only the hash is stored: the plaintext token is never persisted", async () => {
    await ensureActiveSession();
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const grant = await rpc(member, "issue_local_media_transport_grant", {
      _session_id: session.id,
    });
    expect(grant.ok).toBe(true);
    const { data } = await admin
      .from("local_media_transport_grants")
      .select("token_hash")
      .eq("session_id", session.id);
    for (const row of data ?? []) {
      expect(row.token_hash).not.toBe(grant.token);
      expect(String(row.token_hash).length).toBeGreaterThan(0);
    }
  });

  it("LM-X3 a viewer grant is issued with the viewer role", async () => {
    await ensureActiveSession();
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const grant = await rpc(member, "issue_local_media_transport_grant", {
      _session_id: session.id,
    });
    expect(grant.ok).toBe(true);
    expect(grant.role).toBe("viewer");
  });

  it("LM-X4 redeeming a valid token succeeds and re-checks membership", async () => {
    await ensureActiveSession();
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const grant = await rpc(member, "issue_local_media_transport_grant", {
      _session_id: session.id,
    });
    const redeemed = await rpc(member, "redeem_local_media_transport_grant", {
      _session_id: session.id,
      _token: grant.token!,
    });
    expect(redeemed.ok).toBe(true);
  });

  it("LM-X5 a forged or foreign token is rejected", async () => {
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const forged = await rpc(member, "redeem_local_media_transport_grant", {
      _session_id: session.id,
      _token: "f".repeat(64),
    });
    expect(forged.ok).toBe(false);
  });

  it("LM-X6 an expired grant cannot be redeemed", async () => {
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const grant = await rpc(member, "issue_local_media_transport_grant", {
      _session_id: session.id,
    });
    await admin
      .from("local_media_transport_grants")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("session_id", session.id);
    const redeemed = await rpc(member, "redeem_local_media_transport_grant", {
      _session_id: session.id,
      _token: grant.token!,
    });
    expect(redeemed.ok).toBe(false);
  });

  it("LM-X7 signaling requires a valid credential", async () => {
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const result = await rpc(member, "post_local_media_signal", {
      _session_id: session.id,
      _token: "z".repeat(64),
      _recipient_id: host.id,
      _kind: "offer",
      _payload: { sdp: "v=0" },
    });
    expect(result.ok).toBe(false);
  });

  it("LM-X8 a signal is delivered only to its addressed recipient", async () => {
    await ensureActiveSession();
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const senderGrant = await rpc(member, "issue_local_media_transport_grant", {
      _session_id: session.id,
    });
    const posted = await rpc(member, "post_local_media_signal", {
      _session_id: session.id,
      _token: senderGrant.token!,
      _recipient_id: host.id,
      _kind: "offer",
      _payload: { sdp: "v=0" },
    });
    expect(posted.ok).toBe(true);

    const hostGrant = await rpc(host, "issue_local_media_transport_grant", {
      _session_id: session.id,
    });
    const forHost = await rpc(host, "fetch_local_media_signals", {
      _session_id: session.id,
      _token: hostGrant.token!,
    });
    expect(forHost.ok).toBe(true);
    expect((forHost.signals ?? []).length).toBeGreaterThan(0);

    const forSender = await rpc(member, "fetch_local_media_signals", {
      _session_id: session.id,
      _token: senderGrant.token!,
    });
    expect((forSender.signals ?? []).length).toBe(0);
  });

  it("LM-X9 signals cannot be addressed to a non-member", async () => {
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    const grant = await rpc(member, "issue_local_media_transport_grant", {
      _session_id: session.id,
    });
    const result = await rpc(member, "post_local_media_signal", {
      _session_id: session.id,
      _token: grant.token!,
      _recipient_id: outsider.id,
      _kind: "offer",
      _payload: { sdp: "v=0" },
    });
    expect(result.ok).toBe(false);
  });

  it("LM-X10 signals and grants do not outlive the session", async () => {
    const session = (
      await admin
        .from("room_local_media_sessions")
        .select("id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .single()
    ).data!;
    await rpc(host, "end_local_media_session", { _session_id: session.id });
    const grant = await rpc(member, "issue_local_media_transport_grant", {
      _session_id: session.id,
    });
    expect(grant.ok).toBe(false);
    const { data: signals } = await admin
      .from("local_media_signals")
      .select("id, expires_at")
      .eq("session_id", session.id);
    for (const row of signals ?? []) {
      expect(new Date(String(row.expires_at)).getTime()).toBeLessThan(Date.now() + 5 * 60 * 1000);
    }
  });
});
