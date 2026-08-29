/**
 * REWARDED ADS — server-side access, quota and reward integrity.
 *
 * The device can only ever REPORT that an ad finished. Everything that has
 * value (the 24h unlock, the extra-room credit, the 10/day cap and the free
 * room limit) is decided in Postgres, so these tests talk to the RPCs and the
 * tables with real end-user JWTs — never through the UI.
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
}

interface Snapshot {
  ok: boolean;
  rewarded_today: number;
  daily_ad_limit: number;
  ads_remaining_today: number;
  unlock_progress: number;
  unlocked: boolean;
  room_credits: number;
  rooms_created_24h: number;
  can_create_room: boolean;
  reason?: string;
}

suite("rewarded ad access, quota and reward integrity", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  const rooms: string[] = [];

  let user: TestUser;

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `ads-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  async function snapshot(u: TestUser): Promise<Snapshot> {
    const { data, error } = await u.client.rpc("ad_access_snapshot");
    if (error) throw error;
    return data as unknown as Snapshot;
  }

  /** Bypasses the 10-second anti-spam window without touching the reward logic. */
  async function clearRewardCooldown(u: TestUser) {
    await admin
      .from("user_ad_access")
      .update({ last_reward_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("user_id", u.id);
  }

  async function createRoom(u: TestUser, name: string) {
    const result = await u.client
      .from("rooms")
      .insert({
        owner_id: u.id,
        host_id: u.id,
        name,
        type: "watch",
        status: "active",
        privacy: "private",
        max_members: 5,
        join_code: `A${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      })
      .select("id")
      .single();
    if (result.data?.id) rooms.push(result.data.id as string);
    return result;
  }

  beforeAll(async () => {
    user = await makeUser("main");
  }, 60_000);

  afterAll(async () => {
    for (const id of rooms) await admin.from("rooms").delete().eq("id", id);
    for (const entry of created) await admin.auth.admin.deleteUser(entry.id);
  }, 60_000);

  it("ADS-T1: a fresh user starts with no ads watched and one free room", async () => {
    const state = await snapshot(user);
    expect(state.ok).toBe(true);
    expect(state.rewarded_today).toBe(0);
    expect(state.daily_ad_limit).toBe(10);
    expect(state.unlocked).toBe(false);
    expect(state.can_create_room).toBe(true);
  });

  it("ADS-T2: the snapshot is private — a signed-out caller gets nothing", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await anon.rpc("ad_access_snapshot");
    // Either the grant blocks it outright, or the function refuses without a uid.
    if (!error) expect((data as unknown as Snapshot).ok).toBe(false);
  });

  it("ADS-T3: nobody can read another user's ad state", async () => {
    const other = await makeUser("other");
    const { data } = await other.client
      .from("user_ad_access")
      .select("user_id")
      .eq("user_id", user.id);
    expect(data ?? []).toEqual([]);
  });

  it("ADS-T4: the ad state cannot be forged from the client", async () => {
    const far = new Date(Date.now() + 86_400_000).toISOString();
    const insert = await user.client
      .from("user_ad_access")
      .insert({ user_id: user.id, unlock_expires_at: far });
    expect(insert.error).not.toBeNull();
    const update = await user.client
      .from("user_ad_access")
      .update({ unlock_expires_at: far, room_credits: 99 })
      .eq("user_id", user.id);
    // Either the write is rejected outright or it silently affects no row —
    // what matters is that the stored state is unchanged.
    const state = await snapshot(user);
    void update;
    expect(state.unlocked).toBe(false);
    expect(state.room_credits).toBe(0);
  });

  it("ADS-T5: an invalid reward purpose is rejected", async () => {
    const { data } = await user.client.rpc("claim_rewarded_view", { _purpose: "free_everything" });
    expect(data).toMatchObject({ ok: false, reason: "invalid_purpose" });
  });

  it("ADS-T6: rewarded views are rate limited", async () => {
    await user.client.rpc("claim_rewarded_view", { _purpose: "unlock" });
    const { data } = await user.client.rpc("claim_rewarded_view", { _purpose: "unlock" });
    expect(data).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("ADS-T7: three rewarded views unlock everything for 24 hours", async () => {
    const fresh = await makeUser("unlock");
    for (let i = 0; i < 3; i += 1) {
      await clearRewardCooldown(fresh);
      const { data } = await fresh.client.rpc("claim_rewarded_view", { _purpose: "unlock" });
      expect((data as unknown as Snapshot).ok).toBe(true);
    }
    const state = await snapshot(fresh);
    expect(state.unlock_progress).toBe(3);
    expect(state.unlocked).toBe(true);
    expect(state.rewarded_today).toBe(3);
  });

  it("ADS-T8: the daily cap of 10 rewarded views is enforced server-side", async () => {
    const capped = await makeUser("cap");
    await admin.from("user_ad_access").upsert({ user_id: capped.id, rewarded_today: 10 });
    await clearRewardCooldown(capped);
    const { data } = await capped.client.rpc("claim_rewarded_view", { _purpose: "extra_room" });
    expect(data).toMatchObject({ ok: false, reason: "daily_ad_limit_reached" });
    const state = await snapshot(capped);
    expect(state.ads_remaining_today).toBe(0);
    expect(state.room_credits).toBe(0);
  });

  it("ADS-T9: a second room in 24 hours is blocked without a reward", async () => {
    const limited = await makeUser("quota");
    const first = await createRoom(limited, "First room");
    expect(first.error).toBeNull();
    const second = await createRoom(limited, "Second room");
    expect(second.error?.message ?? "").toContain("room_quota_exhausted");
    const state = await snapshot(limited);
    expect(state.rooms_created_24h).toBe(1);
    expect(state.can_create_room).toBe(false);
  });

  it("ADS-T10: one rewarded view buys exactly one extra room", async () => {
    const buyer = await makeUser("credit");
    await createRoom(buyer, "Room one");
    await clearRewardCooldown(buyer);
    const { data } = await buyer.client.rpc("claim_rewarded_view", { _purpose: "extra_room" });
    expect((data as unknown as Snapshot).room_credits).toBe(1);

    const second = await createRoom(buyer, "Room two");
    expect(second.error).toBeNull();
    // The credit is consumed, so a third room needs another ad.
    const after = await snapshot(buyer);
    expect(after.room_credits).toBe(0);
    const third = await createRoom(buyer, "Room three");
    expect(third.error?.message ?? "").toContain("room_quota_exhausted");
  });

  it("ADS-T11: an unlocked user can create rooms without further ads", async () => {
    const unlocked = await makeUser("unlimited");
    await admin.from("user_ad_access").upsert({
      user_id: unlocked.id,
      unlock_progress: 3,
      unlock_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    for (const name of ["A", "B", "C"]) {
      const result = await createRoom(unlocked, `Unlocked ${name}`);
      expect(result.error).toBeNull();
    }
  });

  it("ADS-T12: an expired unlock stops granting access", async () => {
    const expired = await makeUser("expired");
    await admin.from("user_ad_access").upsert({
      user_id: expired.id,
      unlock_progress: 3,
      unlock_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const state = await snapshot(expired);
    expect(state.unlocked).toBe(false);
    expect(state.unlock_progress).toBe(0);
    await createRoom(expired, "Post-expiry room");
    const blocked = await createRoom(expired, "Second post-expiry room");
    expect(blocked.error?.message ?? "").toContain("room_quota_exhausted");
  });

  it("ADS-T13: an ended room no longer consumes the daily free room", async () => {
    const recycler = await makeUser("recycle");
    const first = await createRoom(recycler, "Ends soon");
    expect(first.error).toBeNull();
    await admin
      .from("rooms")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", first.data!.id as string);
    const second = await createRoom(recycler, "Replacement room");
    expect(second.error).toBeNull();
  });
});
