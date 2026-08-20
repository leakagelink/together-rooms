/**
 * Phase 2.1 security integration tests.
 *
 * These run against the real backend through PostgREST/RPC with genuine user
 * JWTs, so they exercise grants + RLS + guard triggers exactly as a browser
 * client would. They are skipped automatically when service credentials are
 * not present (e.g. CI without backend access).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env["SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
const enabled = Boolean(url && serviceKey && anonKey);

const suite = enabled ? describe : describe.skip;

const password = "Test-Password-123!";

suite("phase 2.1 database security", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const users: { id: string; email: string; client: SupabaseClient }[] = [];
  let roomId = "";
  let joinCode = "";

  async function makeUser(tag: string) {
    const email = `p21-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const entry = { id: data.user!.id, email, client };
    users.push(entry);
    return entry;
  }

  let host: (typeof users)[number];
  let member: (typeof users)[number];
  let outsider: (typeof users)[number];

  beforeAll(async () => {
    host = await makeUser("host");
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    joinCode = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 8);
    const { data, error } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Security test room",
        type: "friends",
        status: "active",
        privacy: "private",
        max_members: 2,
        join_code: joinCode,
      })
      .select("id")
      .single();
    if (error) throw error;
    roomId = data.id;
  }, 60_000);

  afterAll(async () => {
    if (roomId) await admin.from("rooms").delete().eq("id", roomId);
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }, 60_000);

  it("T0: room creation seeds the host membership through the authorized flow", async () => {
    const { data } = await host.client
      .from("room_members")
      .select("role,status")
      .eq("room_id", roomId)
      .eq("user_id", host.id)
      .single();
    expect(data?.role).toBe("host");
    expect(data?.status).toBe("joined");
  });

  it("T1: non-member cannot directly INSERT an arbitrary room_members row", async () => {
    const { error } = await outsider.client
      .from("room_members")
      .insert({ room_id: roomId, user_id: outsider.id, role: "member", status: "joined" });
    expect(error).not.toBeNull();
  });

  it("T7: join_room_by_code succeeds for a valid joinable room", async () => {
    const { data, error } = await member.client.rpc("join_room_by_code", { _code: joinCode });
    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
  });

  it("T8: direct membership insertion fails while the join RPC succeeds", async () => {
    const { error } = await outsider.client
      .from("room_members")
      .insert({ room_id: roomId, user_id: outsider.id, role: "host", status: "joined", can_moderate: true });
    expect(error).not.toBeNull();
  });

  it("T9: room capacity cannot be exceeded", async () => {
    const { data } = await outsider.client.rpc("join_room_by_code", { _code: joinCode });
    expect(data).toMatchObject({ ok: false, reason: "room_full" });
  });

  it("T2: member cannot promote own role", async () => {
    await member.client
      .from("room_members")
      .update({ role: "host" })
      .eq("room_id", roomId)
      .eq("user_id", member.id);
    const { data } = await member.client
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("user_id", member.id)
      .single();
    expect(data?.role).toBe("member");
  });

  for (const column of ["can_moderate", "can_invite", "can_control_playback"] as const) {
    it(`member cannot enable ${column}`, async () => {
      await member.client
        .from("room_members")
        .update({ [column]: true })
        .eq("room_id", roomId)
        .eq("user_id", member.id);
      const { data } = await member.client
        .from("room_members")
        .select(column)
        .eq("room_id", roomId)
        .eq("user_id", member.id)
        .single();
      expect(data?.[column]).toBe(false);
    });
  }

  it("T6: member cannot delete membership or self-write status", async () => {
    await member.client
      .from("room_members")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", member.id);
    await member.client
      .from("room_members")
      .update({ status: "left" })
      .eq("room_id", roomId)
      .eq("user_id", member.id);
    const { data } = await member.client
      .from("room_members")
      .select("status")
      .eq("room_id", roomId)
      .eq("user_id", member.id)
      .single();
    expect(data?.status).toBe("joined");
  });

  it("T12: only members are authorized for the private room channel", async () => {
    const asMember = await member.client.rpc("authorize_room_channel", { _room_id: roomId });
    const asOutsider = await outsider.client.rpc("authorize_room_channel", { _room_id: roomId });
    expect(asMember.data).toBe(true);
    expect(asOutsider.data).toBe(false);
  });

  it("T10: an ended room cannot be joined", async () => {
    const code = `E${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 8);
    const { data: room } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Ended room",
        type: "friends",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: code,
      })
      .select("id")
      .single();
    await host.client.rpc("end_room", { _room_id: room!.id });
    const { data } = await outsider.client.rpc("join_room_by_code", { _code: code });
    expect(data).toMatchObject({ ok: false, reason: "room_ended" });
    await admin.from("rooms").delete().eq("id", room!.id);
  });

  it("T10b: an expired room cannot be joined", async () => {
    const code = `X${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 8);
    const { data: room } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Expiring room",
        type: "friends",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: code,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .select("id")
      .single();
    await admin
      .from("rooms")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", room!.id);
    const { data } = await outsider.client.rpc("join_room_by_code", { _code: code });
    expect(data).toMatchObject({ ok: false, reason: "room_expired" });
    await admin.from("rooms").delete().eq("id", room!.id);
  });

  it("T11: a single-use invite cannot be redeemed twice", async () => {
    const code = `I${Math.random().toString(36).slice(2, 8).toUpperCase()}`.slice(0, 8);
    const { data: room } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Invite room",
        type: "friends",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: code,
      })
      .select("id")
      .single();
    const tokenHash = "b".repeat(64);
    const created = await host.client.rpc("create_room_invite", {
      _room_id: room!.id,
      _token_hash: tokenHash,
      _max_uses: 1,
      _expires_in_hours: 24,
    });
    expect(created.data).toMatchObject({ ok: true });
    const first = await outsider.client.rpc("redeem_room_invite", { _token_hash: tokenHash });
    expect(first.data).toMatchObject({ ok: true });
    const second = await member.client.rpc("redeem_room_invite", { _token_hash: tokenHash });
    expect(second.data).toMatchObject({ ok: false, reason: "invalid_invite" });
    await admin.from("rooms").delete().eq("id", room!.id);
  });

  it("T13/T14: host leave transfers hosting, final leave ends the room", async () => {
    const leave = await host.client.rpc("leave_room", { _room_id: roomId });
    expect(leave.data).toMatchObject({ ok: true, outcome: "host_transferred" });
    const { data: room } = await admin.from("rooms").select("owner_id").eq("id", roomId).single();
    expect(room?.owner_id).toBe(member.id);
    const last = await member.client.rpc("leave_room", { _room_id: roomId });
    expect(last.data).toMatchObject({ ok: true, outcome: "room_ended" });
    const { data: ended } = await admin.from("rooms").select("status").eq("id", roomId).single();
    expect(ended?.status).toBe("ended");
  });
});
