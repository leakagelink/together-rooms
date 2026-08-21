/**
 * PHASE 3.1 — chat database / RLS / realtime security integration tests.
 *
 * These are NOT unit tests. Every assertion below runs against the real
 * backend over PostgREST, RPC or the realtime websocket using genuine end-user
 * JWTs, so grants + RLS + guard triggers are exercised exactly as a browser
 * client would exercise them. Service-role access is used only for fixture
 * setup and for asserting what staff/trusted execution can still see.
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
  token: string;
}

suite("phase 3.1 chat security (database / RLS)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let roomId = "";
  let otherRoomId = "";
  let hostMessageId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p31-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  async function makeRoom(owner: TestUser, name: string, code: string) {
    const { data, error } = await owner.client
      .from("rooms")
      .insert({
        owner_id: owner.id,
        host_id: owner.id,
        name,
        type: "friends",
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

  function code(prefix: string) {
    return `${prefix}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  async function send(user: TestUser, room: string, content: string, parent?: string) {
    const { data } = await user.client.rpc("send_room_message", {
      _room_id: room,
      _content: content,
      ...(parent ? { _parent_message_id: parent } : {}),
    });
    return data as { ok: boolean; reason?: string; message_id?: string };
  }

  beforeAll(async () => {
    host = await makeUser("host");
    member = await makeUser("member");
    outsider = await makeUser("outsider");

    const joinCode = code("R");
    roomId = await makeRoom(host, "Chat security room", joinCode);
    const join = await member.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);

    otherRoomId = await makeRoom(host, "Second room", code("S"));

    const first = await send(host, roomId, "hello from host");
    expect(first.ok).toBe(true);
    hostMessageId = first.message_id!;
  }, 90_000);

  afterAll(async () => {
    for (const id of rooms) await admin.from("rooms").delete().eq("id", id);
    for (const u of created) await admin.auth.admin.deleteUser(u.id);
  }, 90_000);

  it("CHAT-T1: non-member cannot SELECT room messages", async () => {
    const { data, error } = await outsider.client
      .from("room_messages")
      .select("id, content")
      .eq("room_id", roomId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("CHAT-T2: non-member cannot send a message", async () => {
    const res = await send(outsider, roomId, "let me in");
    expect(res).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("CHAT-T3: member cannot impersonate sender_id on insert", async () => {
    const { error } = await member.client.from("room_messages").insert({
      room_id: roomId,
      sender_id: host.id,
      content: "spoofed",
      content_type: "text",
    });
    expect(error).not.toBeNull();
    const { count } = await admin
      .from("room_messages")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .eq("content", "spoofed");
    expect(count).toBe(0);
  });

  it("CHAT-T4: muted member cannot send", async () => {
    const mute = await host.client.rpc("set_member_mute", {
      _room_id: roomId,
      _user_id: member.id,
      _muted: true,
    });
    expect(mute.data).toMatchObject({ ok: true, muted: true });
    const res = await send(member, roomId, "muted attempt");
    expect(res).toMatchObject({ ok: false, reason: "muted" });
    await host.client.rpc("set_member_mute", {
      _room_id: roomId,
      _user_id: member.id,
      _muted: false,
    });
  });

  it("CHAT-T5: ended room rejects messages", async () => {
    const ended = await makeRoom(host, "Ended", code("E"));
    await host.client.rpc("end_room", { _room_id: ended });
    const res = await send(host, ended, "after end");
    expect(res).toMatchObject({ ok: false, reason: "room_ended" });
  });

  it("CHAT-T6: expired room rejects messages", async () => {
    const expired = await makeRoom(host, "Expired", code("X"));
    await admin
      .from("rooms")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", expired);
    const res = await send(host, expired, "after expiry");
    expect(res).toMatchObject({ ok: false, reason: "room_expired" });
  });

  it("CHAT-T7: user cannot edit another user's message", async () => {
    const { data } = await member.client.rpc("edit_room_message", {
      _message_id: hostMessageId,
      _content: "hijacked",
    });
    expect(data).toMatchObject({ ok: false, reason: "forbidden" });
    const { data: row } = await admin
      .from("room_messages")
      .select("content")
      .eq("id", hostMessageId)
      .single();
    expect(row?.content).toBe("hello from host");
  });

  it("CHAT-T8: user cannot change sender_id via PostgREST", async () => {
    const mine = await send(member, roomId, "sender ownership test");
    const { error } = await member.client
      .from("room_messages")
      .update({ sender_id: host.id })
      .eq("id", mine.message_id!);
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("room_messages")
      .select("sender_id")
      .eq("id", mine.message_id!)
      .single();
    expect(data?.sender_id).toBe(member.id);
  });

  it("CHAT-T9: user cannot change room_id via PostgREST", async () => {
    const { error } = await host.client
      .from("room_messages")
      .update({ room_id: otherRoomId })
      .eq("id", hostMessageId);
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("room_messages")
      .select("room_id")
      .eq("id", hostMessageId)
      .single();
    expect(data?.room_id).toBe(roomId);
  });

  it("CHAT-T10: the 15-minute edit window is enforced server-side", async () => {
    const old = await send(host, roomId, "old message");
    await admin
      .from("room_messages")
      .update({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() })
      .eq("id", old.message_id!);
    const { data } = await host.client.rpc("edit_room_message", {
      _message_id: old.message_id!,
      _content: "too late",
    });
    expect(data).toMatchObject({ ok: false, reason: "edit_window_expired" });
  });

  it("CHAT-T11: a deleted message cannot be edited", async () => {
    const msg = await send(host, roomId, "to be deleted");
    const del = await host.client.rpc("delete_room_message", { _message_id: msg.message_id! });
    expect(del.data).toMatchObject({ ok: true, outcome: "removed" });
    const { data } = await host.client.rpc("edit_room_message", {
      _message_id: msg.message_id!,
      _content: "resurrect",
    });
    expect(data).toMatchObject({ ok: false, reason: "message_not_editable" });
  });

  it("CHAT-T12: non-member cannot react", async () => {
    const { data } = await outsider.client.rpc("toggle_message_reaction", {
      _message_id: hostMessageId,
      _reaction: "heart",
    });
    expect(data).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("CHAT-T13: reaction insert works", async () => {
    const { data } = await member.client.rpc("toggle_message_reaction", {
      _message_id: hostMessageId,
      _reaction: "heart",
    });
    expect(data).toMatchObject({ ok: true, outcome: "set" });
    const { data: rows } = await admin
      .from("message_reactions")
      .select("reaction")
      .eq("message_id", hostMessageId)
      .eq("user_id", member.id);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.reaction).toBe("heart");
  });

  it("CHAT-T15: a different reaction replaces the existing one", async () => {
    const { data } = await member.client.rpc("toggle_message_reaction", {
      _message_id: hostMessageId,
      _reaction: "fire",
    });
    expect(data).toMatchObject({ ok: true, outcome: "replaced" });
    const { data: rows } = await admin
      .from("message_reactions")
      .select("reaction")
      .eq("message_id", hostMessageId)
      .eq("user_id", member.id);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.reaction).toBe("fire");
  });

  it("CHAT-T14: the same reaction toggles off", async () => {
    const { data } = await member.client.rpc("toggle_message_reaction", {
      _message_id: hostMessageId,
      _reaction: "fire",
    });
    expect(data).toMatchObject({ ok: true, outcome: "removed" });
    const { data: rows } = await admin
      .from("message_reactions")
      .select("reaction")
      .eq("message_id", hostMessageId)
      .eq("user_id", member.id);
    expect(rows).toEqual([]);
  });

  it("CHAT-T12b: direct PostgREST reaction INSERT stays blocked", async () => {
    const { error } = await member.client.from("message_reactions").insert({
      message_id: hostMessageId,
      room_id: roomId,
      user_id: member.id,
      reaction: "joy",
    });
    expect(error).not.toBeNull();
  });

  it("CHAT-T16: a cross-room reply is rejected", async () => {
    const res = await send(host, otherRoomId, "reply across rooms", hostMessageId);
    expect(res).toMatchObject({ ok: false, reason: "invalid_request" });
  });

  it("CHAT-T17: a normal user cannot create a system message", async () => {
    const { error } = await host.client.from("room_messages").insert({
      room_id: roomId,
      sender_id: null,
      content: "FAKE_SYSTEM",
      content_type: "system",
      system_code: "ROOM_ENDED",
    });
    expect(error).not.toBeNull();
  });

  it("CHAT-T18: a normal member cannot moderate another user's message", async () => {
    const { data } = await member.client.rpc("delete_room_message", {
      _message_id: hostMessageId,
    });
    expect(data).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("CHAT-T19: direct PostgREST DELETE cannot bypass soft-delete", async () => {
    const { error } = await host.client.from("room_messages").delete().eq("id", hostMessageId);
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("room_messages")
      .select("id, status")
      .eq("id", hostMessageId)
      .single();
    expect(data?.status).toBe("active");
  });

  it("CHAT-T20: direct PostgREST INSERT cannot bypass the send RPC", async () => {
    const { error } = await member.client.from("room_messages").insert({
      room_id: roomId,
      sender_id: member.id,
      content: "direct insert",
      content_type: "text",
    });
    expect(error).not.toBeNull();
    const { count } = await admin
      .from("room_messages")
      .select("id", { count: "exact", head: true })
      .eq("content", "direct insert");
    expect(count).toBe(0);
  });

  it("CHAT-T22: ordinary members cannot retrieve removed plaintext", async () => {
    const msg = await send(member, roomId, "secret plaintext payload");
    const removal = await host.client.rpc("delete_room_message", {
      _message_id: msg.message_id!,
    });
    expect(removal.data).toMatchObject({ ok: true, outcome: "removed" });

    // The message row itself carries no content at all any more.
    const { data: visible } = await member.client
      .from("room_messages")
      .select("id, content, status")
      .eq("id", msg.message_id!)
      .single();
    expect(visible?.status).toBe("moderated");
    expect(visible?.content).toBe("");
    expect(JSON.stringify(visible)).not.toContain("secret plaintext payload");

    // The column no longer exists on the readable table.
    const dropped = await member.client
      .from("room_messages")
      .select("original_content")
      .eq("id", msg.message_id!);
    expect(dropped.error).not.toBeNull();

    // The staff-only archive is unreachable for ordinary members and outsiders.
    for (const u of [member, outsider]) {
      const archive = await u.client.from("message_moderation_archive").select("original_content");
      expect(archive.error ?? archive.data).not.toEqual([]);
      expect(archive.data ?? []).toEqual([]);
    }

    // Non-staff cannot use the audited retrieval RPC either.
    const rpc = await member.client.rpc("staff_get_removed_message", {
      _message_id: msg.message_id!,
    });
    expect(rpc.data).toMatchObject({ ok: false, reason: "forbidden" });

    // Trusted/staff-side storage still holds the evidence.
    const { data: archived } = await admin
      .from("message_moderation_archive")
      .select("original_content, removal_kind")
      .eq("message_id", msg.message_id!)
      .single();
    expect(archived?.original_content).toBe("secret plaintext payload");
    expect(archived?.removal_kind).toBe("moderated");
  });

  it("CHAT-T23: Phase 2.1 room_members protections still hold", async () => {
    const insert = await outsider.client
      .from("room_members")
      .insert({ room_id: roomId, user_id: outsider.id, role: "member", status: "joined" });
    expect(insert.error).not.toBeNull();

    await member.client
      .from("room_members")
      .update({ role: "host", can_moderate: true })
      .eq("room_id", roomId)
      .eq("user_id", member.id);
    const { data } = await admin
      .from("room_members")
      .select("role, can_moderate")
      .eq("room_id", roomId)
      .eq("user_id", member.id)
      .single();
    expect(data?.role).toBe("member");
    expect(data?.can_moderate).toBe(false);

    await member.client
      .from("room_members")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", member.id);
    const { count } = await admin
      .from("room_members")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .eq("user_id", member.id);
    expect(count).toBe(1);
  });

  it("CHAT-T21: a non-member receives no realtime rows for the room", async () => {
    const memberRows: string[] = [];
    const outsiderRows: string[] = [];

    const statuses: Record<string, string[]> = {};

    async function listen(user: TestUser, sink: string[]) {
      // Node has no browser session plumbing: hand the socket the user's JWT
      // explicitly so realtime applies that user's RLS, not anon's.
      user.client.realtime.setAuth(user.token);
      const channel = user.client
        .channel(`t21-${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` },
          (payload) => {
            const row = payload.new as { id?: string };
            if (row?.id) sink.push(row.id);
          },
        );
      await new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          (statuses[user.id] ??= []).push(status);
          if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            resolve();
          }
        });
      });
      return channel;
    }

    const a = await listen(member, memberRows);
    const b = await listen(outsider, outsiderRows);

    const sent = await send(host, roomId, "realtime isolation probe");
    expect(sent.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 4000));

    await member.client.removeChannel(a);
    await outsider.client.removeChannel(b);

    expect(statuses[member.id]).toContain("SUBSCRIBED");
    expect(memberRows).toContain(sent.message_id);
    expect(outsiderRows).toEqual([]);
  }, 40_000);
});
