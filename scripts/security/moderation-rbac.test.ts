/**
 * PHASE 3.2 — moderation operations & role management RBAC tests.
 *
 * These run against the real backend with genuine end-user JWTs, so the
 * assertions exercise grants, RLS and the SECURITY DEFINER role checks exactly
 * as a browser client would. The staff UI is never the security boundary: each
 * test calls the RPC directly, bypassing any client-side gate.
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
  email: string;
  client: SupabaseClient;
  token: string;
}

suite("phase 3.2 moderation RBAC", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let host: TestUser;
  let reporter: TestUser;
  let moderator: TestUser;
  let staffAdmin: TestUser;
  let roomId = "";
  let reportId = "";
  let removedMessageId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p32-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
    const entry = {
      id: data.user!.id,
      email,
      client,
      token: signIn.data.session!.access_token,
    };
    created.push(entry);
    return entry;
  }

  async function grant(user: TestUser, role: "moderator" | "admin") {
    const { error } = await admin.from("user_roles").insert({ user_id: user.id, role });
    if (error) throw error;
  }

  beforeAll(async () => {
    host = await makeUser("host");
    reporter = await makeUser("reporter");
    moderator = await makeUser("mod");
    staffAdmin = await makeUser("admin");

    await grant(moderator, "moderator");
    await grant(staffAdmin, "admin");

    const joinCode = `M${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { data: room, error } = await host.client
      .from("rooms")
      .insert({
        owner_id: host.id,
        host_id: host.id,
        name: "Moderation fixture room",
        type: "friends",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: joinCode,
      })
      .select("id")
      .single();
    if (error) throw error;
    roomId = room.id as string;
    rooms.push(roomId);

    const join = await reporter.client.rpc("join_room_by_code", { _code: joinCode });
    expect((join.data as { ok: boolean }).ok).toBe(true);

    const sent = await host.client.rpc("send_room_message", {
      _room_id: roomId,
      _content: "offensive fixture content",
    });
    const message = sent.data as { ok: boolean; message_id: string };
    expect(message.ok).toBe(true);
    removedMessageId = message.message_id;

    const report = await reporter.client.rpc("report_message", {
      _message_id: removedMessageId,
      _category: "harassment",
      _details: "fixture report",
    });
    expect(report.data).toMatchObject({ ok: true, outcome: "reported" });
    // report_message deliberately returns no id (the reporter must not be able
    // to correlate reports), so the fixture reads it back with service role.
    const { data: reportRow } = await admin
      .from("user_reports")
      .select("id")
      .eq("target_message_id", removedMessageId)
      .eq("reporter_id", reporter.id)
      .single();
    reportId = reportRow!.id as string;

    // Host removes the message so the archive path has evidence to protect.
    const removal = await host.client.rpc("delete_room_message", {
      _message_id: removedMessageId,
    });
    expect(removal.data).toMatchObject({ ok: true });
  }, 120_000);

  afterAll(async () => {
    for (const id of rooms) await admin.from("rooms").delete().eq("id", id);
    for (const u of created) await admin.auth.admin.deleteUser(u.id);
  }, 120_000);

  it("MOD-T1: a normal user is not staff", async () => {
    const { data } = await reporter.client.rpc("my_staff_context");
    expect(data).toMatchObject({ ok: true, is_staff: false, is_admin: false });
  });

  it("MOD-T2: a moderator is staff but not admin", async () => {
    const { data } = await moderator.client.rpc("my_staff_context");
    expect(data).toMatchObject({ ok: true, is_staff: true, is_admin: false });
  });

  it("MOD-T3: a normal user cannot read the report queue", async () => {
    const { data } = await reporter.client.rpc("staff_report_queue", { _limit: 10, _offset: 0 });
    expect(data).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("MOD-T4: a normal user cannot read report detail or the overview", async () => {
    const detail = await reporter.client.rpc("staff_report_detail", { _report_id: reportId });
    expect(detail.data).toMatchObject({ ok: false, reason: "forbidden" });
    const overview = await reporter.client.rpc("staff_moderation_overview");
    expect(overview.data).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("MOD-T5: a normal user cannot change report status or record actions", async () => {
    const status = await reporter.client.rpc("set_report_status", {
      _report_id: reportId,
      _status: "dismissed",
    });
    expect(status.data).toMatchObject({ ok: false, reason: "forbidden" });

    const action = await reporter.client.rpc("create_moderation_action", {
      _action: "ban",
      _report_id: reportId,
      _room_id: roomId,
      _target_user_id: host.id,
      _reason: "self-service ban attempt",
    });
    expect(action.data).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("MOD-T6: a moderator can read and triage the queue", async () => {
    const queue = await moderator.client.rpc("staff_report_queue", {
      _status: "open",
      _limit: 25,
      _offset: 0,
    });
    const result = queue.data as { ok: boolean; rows: { id: string }[]; total: number };
    expect(result.ok).toBe(true);
    expect(result.rows.some((r) => r.id === reportId)).toBe(true);

    const triaged = await moderator.client.rpc("set_report_status", {
      _report_id: reportId,
      _status: "reviewing",
      _note: "picked up by moderator",
    });
    expect(triaged.data).toMatchObject({ ok: true, status: "reviewing" });
  });

  it("MOD-T7: the queue never leaks removed plaintext", async () => {
    const queue = await moderator.client.rpc("staff_report_queue", { _limit: 25, _offset: 0 });
    expect(JSON.stringify(queue.data)).not.toContain("offensive fixture content");
    const detail = await moderator.client.rpc("staff_report_detail", { _report_id: reportId });
    expect(JSON.stringify(detail.data)).not.toContain("offensive fixture content");
  });

  it("MOD-T8: revealing removed plaintext is staff-only and audited", async () => {
    const denied = await reporter.client.rpc("staff_get_removed_message", {
      _message_id: removedMessageId,
    });
    expect(denied.data).toMatchObject({ ok: false, reason: "forbidden" });

    const allowed = await moderator.client.rpc("staff_get_removed_message", {
      _message_id: removedMessageId,
    });
    expect(allowed.data).toMatchObject({ ok: true, content: "offensive fixture content" });

    const { data: audit } = await admin
      .from("audit_logs")
      .select("action, actor_id")
      .eq("entity_id", removedMessageId)
      .eq("actor_id", moderator.id);
    expect((audit ?? []).length).toBeGreaterThan(0);
  });

  it("MOD-T9: moderation actions are recorded with the acting staff member", async () => {
    const action = await moderator.client.rpc("create_moderation_action", {
      _action: "warn",
      _report_id: reportId,
      _room_id: roomId,
      _target_user_id: host.id,
      _reason: "first warning",
    });
    expect(action.data).toMatchObject({ ok: true });

    const { data: rows } = await admin
      .from("moderation_actions")
      .select("action, actor_id, target_user_id")
      .eq("report_id", reportId);
    expect(rows).toContainEqual({
      action: "warn",
      actor_id: moderator.id,
      target_user_id: host.id,
    });
  });

  it("MOD-T10: role management is admin-only", async () => {
    const modList = await moderator.client.rpc("admin_list_roles");
    expect(modList.data).toMatchObject({ ok: false, reason: "forbidden" });

    const modSearch = await moderator.client.rpc("admin_search_users", { _q: reporter.email });
    expect(modSearch.data).toMatchObject({ ok: false, reason: "forbidden" });

    const selfPromote = await moderator.client.rpc("assign_app_role", {
      _user_id: moderator.id,
      _role: "admin",
    });
    expect(selfPromote.data).toMatchObject({ ok: false, reason: "forbidden" });

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", moderator.id);
    expect((roles ?? []).map((r) => r.role)).not.toContain("admin");
  });

  it("MOD-T11: an admin can grant and revoke moderator", async () => {
    const granted = await staffAdmin.client.rpc("assign_app_role", {
      _user_id: reporter.id,
      _role: "moderator",
    });
    expect(granted.data).toMatchObject({ ok: true });

    const ctx = await reporter.client.rpc("my_staff_context");
    expect(ctx.data).toMatchObject({ ok: true, is_staff: true, is_admin: false });

    const revoked = await staffAdmin.client.rpc("revoke_app_role", {
      _user_id: reporter.id,
      _role: "moderator",
    });
    expect(revoked.data).toMatchObject({ ok: true });

    const after = await reporter.client.rpc("my_staff_context");
    expect(after.data).toMatchObject({ ok: true, is_staff: false });
  });

  it("MOD-T12: an admin cannot revoke their own admin role", async () => {
    const res = await staffAdmin.client.rpc("revoke_app_role", {
      _user_id: staffAdmin.id,
      _role: "admin",
    });
    expect(res.data).toMatchObject({ ok: false });
    const { data } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", staffAdmin.id)
      .eq("role", "admin");
    expect(data).toHaveLength(1);
  });

  it("MOD-T13: user_roles cannot be written directly by any end user", async () => {
    for (const u of [reporter, moderator, staffAdmin]) {
      const insert = await u.client.from("user_roles").insert({ user_id: u.id, role: "admin" });
      expect(insert.error).not.toBeNull();
    }
    const { data } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("user_id", reporter.id)
      .eq("role", "admin");
    expect(data).toEqual([]);
  });

  it("MOD-T14: audit logs and moderation actions are not writable by end users", async () => {
    const auditWrite = await moderator.client
      .from("audit_logs")
      .insert({ action: "forged", entity_type: "report", metadata: {} });
    expect(auditWrite.error).not.toBeNull();

    const actionWrite = await moderator.client
      .from("moderation_actions")
      .insert({ action: "ban", room_id: roomId, target_user_id: host.id });
    expect(actionWrite.error).not.toBeNull();
  });

  it("MOD-T15: bootstrap_first_admin is not callable by end users", async () => {
    for (const u of [reporter, moderator, staffAdmin]) {
      const { error } = await u.client.rpc("bootstrap_first_admin", { _email: u.email });
      expect(error).not.toBeNull();
    }
  });

  it("MOD-T16: queue pagination is bounded and stable", async () => {
    const page = await moderator.client.rpc("staff_report_queue", { _limit: 999, _offset: 0 });
    const result = page.data as { ok: boolean; limit: number; rows: unknown[] };
    expect(result.ok).toBe(true);
    expect(result.limit).toBeLessThanOrEqual(50);
    expect(result.rows.length).toBeLessThanOrEqual(50);
  });
});
