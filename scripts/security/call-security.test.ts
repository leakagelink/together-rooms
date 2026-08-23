/**
 * PHASE 8 — real-time voice & video: security and lifecycle tests.
 *
 * CALL-T1 … T15         — authorization, membership, blocks, direct-write bypass.
 * CALL-LIFECYCLE-T1 … T5 — session end, expiry, revocation, room close, reuse.
 *
 * Everything runs against the real backend with genuine end-user JWTs so
 * grants, RLS, guard triggers and SECURITY DEFINER authorization are exercised
 * exactly as a browser exercises them. Service-role access is used only to
 * build fixtures and to assert facts a client must never be able to observe.
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
  relay_allowed?: boolean;
  ttl_seconds?: number;
  expires_at?: string;
  existing?: boolean;
  already_ended?: boolean;
  session?: unknown;
  participants?: unknown[];
  control_mode?: string;
  admission?: string;
  max_participants?: number;
  max_voice_participants?: number;
  max_video_participants?: number;
  signals?: unknown[];
  [key: string]: unknown;
}

suite("phase 8 calls (security / lifecycle)", () => {
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
    const email = `p8-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
    const code = `C${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data, error } = await owner.client
      .from("rooms")
      .insert({
        owner_id: owner.id,
        host_id: owner.id,
        name: "Call room",
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

  /** Ends any live session so each test starts from a clean room. */
  async function clearSessions(room = roomId) {
    await admin
      .from("room_call_sessions")
      .update({ session_status: "ended", ended_at: new Date().toISOString() })
      .eq("room_id", room)
      .in("session_status", ["starting", "active"]);
  }

  const startCall = (user: TestUser, mode = "voice", room = roomId) =>
    rpc(user, "start_call_session", { _room_id: room, _call_mode: mode });

  async function liveSession(user: TestUser, mode = "voice"): Promise<string> {
    const started = await startCall(user, mode);
    expect(started.ok).toBe(true);
    return started.session_id!;
  }

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
    // Collaborative start keeps most tests focused on the rule under test.
    const settings = await rpc(host, "set_call_settings", {
      _room_id: roomId,
      _control_mode: "collaborative",
    });
    expect(settings.ok).toBe(true);
  }, 60_000);

  afterEach(async () => {
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

  // --------------------------------------------------------------- security

  it("CALL-T1 an anonymous client cannot read or start a call", async () => {
    const { data: rows } = await anon.from("room_call_sessions").select("id").limit(1);
    expect(rows ?? []).toHaveLength(0);
    const { data } = await anon.rpc("start_call_session" as never, {
      _room_id: roomId,
      _call_mode: "voice",
    } as never);
    expect((data as Rpc | null)?.ok ?? false).toBe(false);
  });

  it("CALL-T2 a joined member can start a call; the row is server-authored", async () => {
    await clearSessions();
    const result = await startCall(member);
    expect(result.ok).toBe(true);
    const { data } = await admin
      .from("room_call_sessions")
      .select("started_by, session_status, call_mode, version, expires_at, max_participants")
      .eq("id", result.session_id!)
      .single();
    expect(data?.started_by).toBe(member.id);
    expect(data?.session_status).toBe("active");
    expect(Number(data?.version)).toBe(0);
    expect(new Date(String(data?.expires_at)).getTime()).toBeGreaterThan(Date.now());
  });

  it("CALL-T3 a non-member cannot start or join a call in the room", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    const start = await startCall(outsider);
    expect(start.ok).toBe(false);
    expect(["forbidden", "not_found"]).toContain(start.reason);
    const join = await rpc(outsider, "join_call_session", { _session_id: sessionId });
    expect(join.ok).toBe(false);
    expect(["forbidden", "not_found"]).toContain(join.reason);
  });

  it("CALL-T4 host_only mode blocks a plain member from starting a call", async () => {
    await clearSessions();
    await rpc(host, "set_call_settings", { _room_id: roomId, _control_mode: "host_only" });
    const denied = await startCall(member);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("forbidden");
    const allowed = await startCall(host);
    expect(allowed.ok).toBe(true);
    await rpc(host, "set_call_settings", { _room_id: roomId, _control_mode: "collaborative" });
  });

  it("CALL-T5 only a moderator can change call settings", async () => {
    const denied = await rpc(member, "set_call_settings", {
      _room_id: roomId,
      _max_voice: 3,
    });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("forbidden");
  });

  it("CALL-T6 direct INSERT into call tables is rejected for clients", async () => {
    const session = await admin
      .from("room_call_sessions")
      .select("id")
      .eq("room_id", roomId)
      .in("session_status", ["starting", "active"])
      .maybeSingle();
    const inserts = await Promise.all([
      member.client
        .from("room_call_sessions")
        .insert({ room_id: roomId, call_mode: "voice", expires_at: new Date().toISOString() } as never),
      member.client.from("room_call_participants").insert({
        session_id: session.data?.id ?? roomId,
        room_id: roomId,
        user_id: member.id,
      } as never),
      member.client.from("call_signals").insert({
        session_id: session.data?.id ?? roomId,
        room_id: roomId,
        sender_id: member.id,
        recipient_id: host.id,
        kind: "offer",
        payload: {},
        expires_at: new Date().toISOString(),
      } as never),
      member.client.from("call_transport_grants").insert({
        session_id: session.data?.id ?? roomId,
        room_id: roomId,
        user_id: member.id,
        token_hash: "x",
        expires_at: new Date().toISOString(),
      } as never),
    ]);
    for (const result of inserts) expect(result.error).not.toBeNull();
  });

  it("CALL-T7 a direct UPDATE/DELETE of a session changes nothing", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    const update = await member.client
      .from("room_call_sessions")
      .update({ session_status: "ended" } as never)
      .eq("id", sessionId)
      .select("id");
    expect(update.data ?? []).toHaveLength(0);
    const del = await member.client
      .from("room_call_sessions")
      .delete()
      .eq("id", sessionId)
      .select("id");
    expect(del.data ?? []).toHaveLength(0);
    const { data } = await admin
      .from("room_call_sessions")
      .select("session_status")
      .eq("id", sessionId)
      .single();
    expect(data?.session_status).toBe("active");
  });


  it("CALL-T8 a member cannot forge another member's mic/camera state", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    expect((await rpc(host, "join_call_session", { _session_id: sessionId })).ok).toBe(true);
    expect((await rpc(member, "join_call_session", { _session_id: sessionId })).ok).toBe(true);

    const forged = await member.client
      .from("room_call_participants")
      .update({ mic_enabled: false } as never)
      .eq("session_id", sessionId)
      .eq("user_id", host.id);
    expect(forged.error).not.toBeNull();

    // The RPC only ever touches the caller's own row.
    expect((await rpc(member, "set_call_media_state", { _session_id: sessionId, _mic: false })).ok).toBe(
      true,
    );
    const { data } = await admin
      .from("room_call_participants")
      .select("user_id, mic_enabled")
      .eq("session_id", sessionId)
      .is("left_at", null);
    const hostRow = (data ?? []).find((r) => r.user_id === host.id);
    const memberRow = (data ?? []).find((r) => r.user_id === member.id);
    expect(hostRow?.mic_enabled).toBe(true);
    expect(memberRow?.mic_enabled).toBe(false);
  });

  it("CALL-T9 blocking prevents the two users from sharing a call", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    expect((await rpc(host, "join_call_session", { _session_id: sessionId })).ok).toBe(true);
    const block = await blocked.client
      .from("user_blocks")
      .insert({ blocker_id: blocked.id, blocked_id: host.id } as never);
    expect(block.error).toBeNull();

    const join = await rpc(blocked, "join_call_session", { _session_id: sessionId });
    expect(join.ok).toBe(false);
    expect(join.reason).toBe("forbidden");

    await admin.from("user_blocks").delete().eq("blocker_id", blocked.id).eq("blocked_id", host.id);
  });

  it("CALL-T10 the participant cap is enforced server-side", async () => {
    await clearSessions();
    await rpc(host, "set_call_settings", { _room_id: roomId, _max_voice: 2 });
    const sessionId = await liveSession(host);
    expect((await rpc(host, "join_call_session", { _session_id: sessionId })).ok).toBe(true);
    expect((await rpc(member, "join_call_session", { _session_id: sessionId })).ok).toBe(true);
    const third = await rpc(blocked, "join_call_session", { _session_id: sessionId });
    expect(third.ok).toBe(false);
    expect(["call_full", "forbidden", "rate_limited"]).toContain(third.reason);
    await rpc(host, "set_call_settings", { _room_id: roomId, _max_voice: 8 });
  });

  it("CALL-T11 a second start returns the existing session rather than a rival one", async () => {
    await clearSessions();
    const first = await startCall(host);
    const second = await startCall(member);
    expect(second.ok).toBe(true);
    expect(second.session_id).toBe(first.session_id);
    expect(second.existing).toBe(true);
    const { count } = await admin
      .from("room_call_sessions")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .in("session_status", ["starting", "active"]);
    expect(count).toBe(1);
  });

  it("CALL-T12 an invalid call mode is rejected", async () => {
    await clearSessions();
    const result = await startCall(host, "hologram");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_request");
  });

  it("CALL-T13 the snapshot is member-only and exposes no credentials", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    await rpc(host, "join_call_session", { _session_id: sessionId });

    const denied = await rpc(outsider, "call_snapshot", { _room_id: roomId });
    expect(denied.ok).toBe(false);

    const snapshot = await rpc(member, "call_snapshot", { _room_id: roomId });
    expect(snapshot.ok).toBe(true);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("token_hash");
  });

  it("CALL-T14 leaving a call only removes the caller", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    await rpc(host, "join_call_session", { _session_id: sessionId });
    await rpc(member, "join_call_session", { _session_id: sessionId });

    expect((await rpc(member, "leave_call_session", { _session_id: sessionId })).ok).toBe(true);
    const { data } = await admin
      .from("room_call_participants")
      .select("user_id, left_at")
      .eq("session_id", sessionId);
    const rows = data ?? [];
    expect(rows.find((r) => r.user_id === member.id)?.left_at).not.toBeNull();
    expect(rows.find((r) => r.user_id === host.id)?.left_at).toBeNull();
  });

  it("CALL-T15 repeated call starts are rate limited", async () => {
    await clearSessions();
    let limited = false;
    for (let i = 0; i < 14; i += 1) {
      await clearSessions();
      const result = await startCall(host);
      if (!result.ok && result.reason === "rate_limited") {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  }, 60_000);

  // -------------------------------------------------------------- lifecycle

  it("CALL-LIFECYCLE-T1 only the starter or a moderator can end the call", async () => {
    await clearSessions();
    const sessionId = await liveSession(member);
    const denied = await rpc(blocked, "end_call_session", { _session_id: sessionId });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("forbidden");
    expect((await rpc(host, "end_call_session", { _session_id: sessionId })).ok).toBe(true);
  });

  it("CALL-LIFECYCLE-T2 ending detaches everyone and revokes every credential", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    await rpc(host, "join_call_session", { _session_id: sessionId });
    await rpc(member, "join_call_session", { _session_id: sessionId });
    expect((await rpc(host, "issue_call_transport_grant", { _session_id: sessionId })).ok).toBe(
      true,
    );

    expect((await rpc(host, "end_call_session", { _session_id: sessionId })).ok).toBe(true);

    const { data: parts } = await admin
      .from("room_call_participants")
      .select("left_at")
      .eq("session_id", sessionId);
    expect((parts ?? []).every((p) => p.left_at !== null)).toBe(true);
    const { data: grants } = await admin
      .from("call_transport_grants")
      .select("revoked_at")
      .eq("session_id", sessionId);
    expect((grants ?? []).every((g) => g.revoked_at !== null)).toBe(true);
    const { count } = await admin
      .from("call_signals")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    expect(count ?? 0).toBe(0);
  });

  it("CALL-LIFECYCLE-T3 ending twice is idempotent and version conflicts are detected", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    const stale = await rpc(host, "end_call_session", {
      _session_id: sessionId,
      _expected_version: 99,
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("version_conflict");
    expect((await rpc(host, "end_call_session", { _session_id: sessionId })).ok).toBe(true);
    const again = await rpc(host, "end_call_session", { _session_id: sessionId });
    expect(again.ok).toBe(true);
    expect(again.already_ended).toBe(true);
  });

  it("CALL-LIFECYCLE-T4 an expired session cannot be joined", async () => {
    await clearSessions();
    const sessionId = await liveSession(host);
    await admin
      .from("room_call_sessions")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() } as never)
      .eq("id", sessionId);
    const join = await rpc(member, "join_call_session", { _session_id: sessionId });
    expect(join.ok).toBe(false);
    expect(["room_ended", "not_found", "expired"]).toContain(join.reason);
  });

  it("CALL-LIFECYCLE-T5 ending the room kills the call for everyone", async () => {
    const room = await makeRoom(host);
    const joined = await rpc(member, "join_room_by_code", { _code: room.code });
    expect(joined.ok).toBe(true);
    await rpc(host, "set_call_settings", { _room_id: room.id, _control_mode: "collaborative" });
    const started = await startCall(host, "voice", room.id);
    expect(started.ok).toBe(true);
    await rpc(host, "join_call_session", { _session_id: started.session_id! });

    expect((await rpc(host, "end_room", { _room_id: room.id })).ok).toBe(true);

    const join = await rpc(member, "join_call_session", { _session_id: started.session_id! });
    expect(join.ok).toBe(false);
    const grant = await rpc(member, "issue_call_transport_grant", {
      _session_id: started.session_id!,
    });
    expect(grant.ok).toBe(false);
  }, 60_000);
});
