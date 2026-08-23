/**
 * PHASE 9 — entitlement, billing and plan-limit security tests.
 *
 * These run against the real backend with genuine end-user JWTs, so grants,
 * RLS, guard triggers and SECURITY DEFINER logic are exercised exactly as a
 * browser client would hit them. The UI is never the boundary: every test
 * calls the table or the RPC directly.
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
}

suite("phase 9 entitlements & billing", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let free: TestUser;
  let premium: TestUser;
  let other: TestUser;
  let staffAdmin: TestUser;

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p9-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
    created.push(entry);
    return entry;
  }

  async function makeRoom(user: TestUser, name: string) {
    const { data, error } = await user.client
      .from("rooms")
      .insert({ owner_id: user.id, name, type: "friends", privacy: "private" })
      .select("id")
      .single();
    if (!error && data) rooms.push(data.id as string);
    return { data, error };
  }

  beforeAll(async () => {
    free = await makeUser("free");
    premium = await makeUser("premium");
    other = await makeUser("other");
    staffAdmin = await makeUser("admin");
    await admin.from("user_roles").insert({ user_id: staffAdmin.id, role: "admin" });

    // Premium is granted the only legitimate way: server-side, via the
    // service role applying a verified billing event.
    await admin.rpc("apply_billing_event", {
      _user_id: premium.id,
      _event_type: "purchase_verified",
      _provider: "google_play",
      _product_id: "premium_monthly_test",
      _purchase_token: `tok-${premium.id}`,
      _event_seq: 2_000_000_000,
      _expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
  }, 120_000);

  afterAll(async () => {
    for (const roomId of rooms) await admin.from("rooms").delete().eq("id", roomId);
    for (const user of created) await admin.auth.admin.deleteUser(user.id);
  }, 120_000);

  /* --------------------------- entitlement reads -------------------------- */

  it("ENT-T1: a new user is free with free limits", async () => {
    const { data } = await free.client.rpc("my_entitlement");
    expect((data as Record<string, unknown>)["premium"]).toBe(false);
    expect((data as Record<string, unknown>)["plan"]).toBe("free");
  });

  it("ENT-T2: a verified purchase makes the user premium", async () => {
    const { data } = await premium.client.rpc("my_entitlement");
    expect((data as Record<string, unknown>)["premium"]).toBe(true);
  });

  it("ENT-T3: users cannot read another user's entitlement row", async () => {
    const { data } = await free.client
      .from("entitlements")
      .select("user_id")
      .eq("user_id", premium.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("ENT-T4: entitlement_snapshot is not callable by signed-in users", async () => {
    const { error } = await free.client.rpc("entitlement_snapshot", { _user_id: free.id });
    expect(error).not.toBeNull();
  });

  /* ------------------------- client write attempts ------------------------ */

  it("ENT-T5: a user cannot insert an entitlement for themselves", async () => {
    const { error } = await free.client
      .from("entitlements")
      .insert({ user_id: free.id, plan: "pro", status: "active", source: "grant" });
    expect(error).not.toBeNull();
  });

  it("ENT-T6: a user cannot update their own entitlement to premium", async () => {
    const { error } = await premium.client
      .from("entitlements")
      .update({ expires_at: new Date(Date.now() + 3650 * 86_400_000).toISOString() })
      .eq("user_id", premium.id);
    expect(error).not.toBeNull();
  });

  it("ENT-T7: a user cannot delete their entitlement to reset limits", async () => {
    const { error } = await premium.client.from("entitlements").delete().eq("user_id", premium.id);
    expect(error).not.toBeNull();
  });

  it("ENT-T8: a user cannot forge a subscription event", async () => {
    const { error } = await free.client.from("subscription_events").insert({
      user_id: free.id,
      event_type: "purchase_verified",
      provider: "google_play",
    });
    expect(error).not.toBeNull();
  });

  it("ENT-T9: subscription events are readable only by their owner", async () => {
    const { data } = await other.client
      .from("subscription_events")
      .select("id")
      .eq("user_id", premium.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("ENT-T10: purchase tokens are never exposed through the history RPC", async () => {
    const { data } = await premium.client.rpc("my_subscription_events", { _limit: 10 });
    expect(JSON.stringify(data)).not.toContain(`tok-${premium.id}`);
  });

  it("ENT-T11: plan limits are read-only for signed-in users", async () => {
    const { error } = await free.client
      .from("plan_limits")
      .update({ limits: { max_active_rooms: 9999 } })
      .eq("plan_key", "free");
    expect(error).not.toBeNull();
  });

  it("ENT-T12: ad config is read-only for signed-in users", async () => {
    const { error } = await free.client
      .from("ad_config")
      .update({ config: { ads_enabled: false } })
      .eq("id", true);
    expect(error).not.toBeNull();
  });

  /* ----------------------- billing event application ---------------------- */

  it("BILL-T1: the same purchase event is applied exactly once", async () => {
    const token = `tok-idem-${Date.now()}`;
    const args = {
      _user_id: other.id,
      _event_type: "purchase_verified",
      _provider: "google_play",
      _product_id: "premium_monthly_test",
      _purchase_token: token,
      _event_seq: 1_900_000_000,
      _expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    const first = await admin.rpc("apply_billing_event", args);
    const second = await admin.rpc("apply_billing_event", args);
    expect((first.data as Record<string, unknown>)["ok"]).toBe(true);
    expect((second.data as Record<string, unknown>)["outcome"]).toBe("duplicate");
  });

  it("BILL-T2: an out-of-order (stale) event never downgrades newer state", async () => {
    const before = await other.client.rpc("my_entitlement");
    await admin.rpc("apply_billing_event", {
      _user_id: other.id,
      _event_type: "expired",
      _provider: "google_play",
      _product_id: "premium_monthly_test",
      _purchase_token: `tok-stale-${Date.now()}`,
      _event_seq: 1_000,
    });
    const after = await other.client.rpc("my_entitlement");
    expect((after.data as Record<string, unknown>)["premium"]).toBe(
      (before.data as Record<string, unknown>)["premium"],
    );
  });

  it("BILL-T3: apply_billing_event is not callable by signed-in users", async () => {
    const { error } = await free.client.rpc("apply_billing_event", {
      _user_id: free.id,
      _event_type: "purchase_verified",
    });
    expect(error).not.toBeNull();
  });

  it("BILL-T4: a newer expiry extends access, an authoritative expiry revokes it", async () => {
    const victim = await makeUser("lapse");
    await admin.rpc("apply_billing_event", {
      _user_id: victim.id,
      _event_type: "purchase_verified",
      _provider: "google_play",
      _product_id: "premium_monthly_test",
      _purchase_token: `tok-lapse-${Date.now()}`,
      _event_seq: 1_500_000_000,
      _expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const active = await victim.client.rpc("my_entitlement");
    expect((active.data as Record<string, unknown>)["premium"]).toBe(true);

    await admin.rpc("apply_billing_event", {
      _user_id: victim.id,
      _event_type: "expired",
      _provider: "google_play",
      _product_id: "premium_monthly_test",
      _purchase_token: `tok-lapse2-${Date.now()}`,
      _event_seq: 1_600_000_000,
      _expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
    const lapsed = await victim.client.rpc("my_entitlement");
    expect((lapsed.data as Record<string, unknown>)["premium"]).toBe(false);
  });

  /* ---------------------------- premium gating ---------------------------- */

  it("GATE-T1: precheck denies premium features to free users", async () => {
    const { data } = await free.client.rpc("entitlement_precheck", { _feature: "premium_capacity" });
    expect(data).toMatchObject({ ok: false, reason: "premium_required" });
  });

  it("GATE-T2: precheck allows premium features to premium users", async () => {
    const { data } = await premium.client.rpc("entitlement_precheck", {
      _feature: "premium_capacity",
    });
    expect((data as Record<string, unknown>)["ok"]).toBe(true);
  });

  it("GATE-T3: a free host cannot raise room capacity past the free cap", async () => {
    const { data: room } = await makeRoom(free, "cap-test");
    const { data } = await free.client.rpc("set_room_capacity", {
      _room_id: room!.id as string,
      _max_members: 50,
    });
    expect(data).toMatchObject({ ok: false, reason: "premium_required" });
  });

  it("GATE-T4: a premium host can raise room capacity", async () => {
    const { data: room } = await makeRoom(premium, "cap-test-premium");
    const { data } = await premium.client.rpc("set_room_capacity", {
      _room_id: room!.id as string,
      _max_members: 50,
    });
    expect((data as Record<string, unknown>)["ok"]).toBe(true);
  });

  it("GATE-T5: capacity cannot be raised by writing the rooms table directly", async () => {
    const { data: room } = await makeRoom(free, "cap-direct");
    await free.client.from("rooms").update({ max_members: 50 }).eq("id", room!.id as string);
    const { data: after } = await admin
      .from("rooms")
      .select("max_members")
      .eq("id", room!.id as string)
      .single();
    expect(after!.max_members).toBeLessThanOrEqual(10);
  });

  it("GATE-T6: a non-host cannot change another room's capacity", async () => {
    const { data: room } = await makeRoom(premium, "cap-foreign");
    const { data } = await other.client.rpc("set_room_capacity", {
      _room_id: room!.id as string,
      _max_members: 40,
    });
    expect((data as Record<string, unknown>)["ok"]).toBe(false);
  });

  /* ------------------------------ staff paths ----------------------------- */

  it("STAFF-T1: a non-staff user cannot grant themselves premium", async () => {
    const { data } = await free.client.rpc("admin_grant_entitlement", {
      _user_id: free.id,
      _reason: "please make me premium",
    });
    expect(data).toMatchObject({ ok: false, reason: "forbidden" });
    const check = await free.client.rpc("my_entitlement");
    expect((check.data as Record<string, unknown>)["premium"]).toBe(false);
  });

  it("STAFF-T2: an admin grant requires a reason and is audited", async () => {
    const target = await makeUser("granted");
    const { data } = await staffAdmin.client.rpc("admin_grant_entitlement", {
      _user_id: target.id,
      _reason: "support goodwill grant for outage",
    });
    expect((data as Record<string, unknown>)["ok"]).toBe(true);

    const snapshot = await target.client.rpc("my_entitlement");
    expect((snapshot.data as Record<string, unknown>)["premium"]).toBe(true);

    const { data: logs } = await admin
      .from("audit_logs")
      .select("action, entity_id")
      .eq("entity_id", target.id);
    expect((logs ?? []).some((row) => String(row.action).includes("entitlement"))).toBe(true);
  });

  it("STAFF-T3: an admin can revoke a granted entitlement", async () => {
    const target = await makeUser("revoked");
    await staffAdmin.client.rpc("admin_grant_entitlement", {
      _user_id: target.id,
      _reason: "temporary grant for testing",
    });
    await staffAdmin.client.rpc("admin_grant_entitlement", {
      _user_id: target.id,
      _reason: "grant no longer applicable",
      _revoke: true,
    });
    const snapshot = await target.client.rpc("my_entitlement");
    expect((snapshot.data as Record<string, unknown>)["premium"]).toBe(false);
  });

  it("STAFF-T4: non-staff cannot read another user's subscription overview", async () => {
    const { data } = await free.client.rpc("admin_subscription_overview", {
      _user_id: premium.id,
    });
    expect(data).toMatchObject({ ok: false, reason: "forbidden" });
  });

  /* ------------------------------ plan limits ----------------------------- */

  it("LIMIT-T1: room creation is limited by the plan, and the limit is server-side", async () => {
    const { data: limits } = await admin
      .from("plan_limits")
      .select("limits")
      .eq("plan_key", "free")
      .single();
    const cap = Number((limits!.limits as Record<string, unknown>)["max_active_rooms"]);
    expect(cap).toBeGreaterThan(0);

    const limited = await makeUser("roomcap");
    let blocked = false;
    for (let i = 0; i < cap + 2; i += 1) {
      const { error } = await makeRoom(limited, `limit-${i}`);
      if (error) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  }, 180_000);
});
