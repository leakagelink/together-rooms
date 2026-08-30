/**
 * Watch Together — end-to-end UI test.
 *
 * Drives the real app in Chromium with a real end-user session and asserts the
 * search/filter panel behaviour around playback:
 *   1. no media  -> search panel is visible
 *   2. playback starts -> search panel auto-hides
 *   3. tabs (Chat / People / Share) reposition right under the video
 *   4. manual re-open works, and a later play collapses it again
 *
 * Skipped automatically when backend credentials or the dev server are absent.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env["SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
const appUrl = process.env["E2E_BASE_URL"] ?? "http://localhost:8080";

const password = "Test-Password-123!";
const VIDEO = "E2EWATCH001";

async function appReachable() {
  try {
    const res = await fetch(appUrl, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

const backendReady = Boolean(url && serviceKey && anonKey);
const serverReady = backendReady ? await appReachable() : false;
const suite = backendReady && serverReady ? describe : describe.skip;

suite("watch together — search panel / tabs around playback (e2e)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });

  let browser: Browser;
  let page: Page;
  let client: SupabaseClient;
  let userId = "";
  let roomId = "";

  const storageKey = `sb-${new URL(url ?? "https://x.supabase.co").hostname.split(".")[0]}-auth-token`;

  const searchToggle = () => page.locator('[aria-controls="watch-search-panel"]').first();
  const searchPanel = () => page.locator("#watch-search-panel");
  const tabsNav = () => page.getByTestId("room-tabs-nav");

  async function expectSearchVisible(visible: boolean) {
    await expect
      .poll(async () => (await searchPanel().count()) > 0, { timeout: 20_000, interval: 400 })
      .toBe(visible);
  }

  beforeAll(async () => {
    const email = `e2e-watch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user!.id;
    await admin
      .from("user_ad_access")
      .upsert({ user_id: userId, unlock_expires_at: new Date(Date.now() + 86_400_000).toISOString() });

    client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const session = signIn.data.session!;

    const room = await client
      .from("rooms")
      .insert({
        owner_id: userId,
        host_id: userId,
        name: "E2E watch room",
        type: "watch",
        status: "active",
        privacy: "private",
        max_members: 10,
        join_code: `E${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      })
      .select("id")
      .single();
    if (room.error) throw room.error;
    roomId = room.data.id as string;

    // The playback RPCs enforce the server-populated policy cache.
    const seeded = await admin.rpc("upsert_media_metadata_cache", {
      _provider: "youtube",
      _media_id: VIDEO,
      _title: "E2E video",
      _thumbnail_url: `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`,
      _made_for_kids: false,
      _embeddable: true,
      _privacy_status: "public",
      _status: "ok",
      _source: "test",
      _ttl_hours: 1,
    });
    if (seeded.error) throw seeded.error;

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 393, height: 1800 } });
    page = await context.newPage();
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key!, value!),
      [storageKey, JSON.stringify(session)],
    );
    await page.goto(`${appUrl}/rooms/${roomId}`, { waitUntil: "domcontentloaded" });
    await expect(searchToggle()).toBeVisible({ timeout: 30_000 });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    if (roomId) await admin.from("rooms").delete().eq("id", roomId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, 120_000);

  it("shows the search panel while the room has no media", async () => {
    await expectSearchVisible(true);
    await expect(searchToggle()).toHaveAttribute("aria-expanded", "true");
    await expect(tabsNav()).toHaveAttribute("data-search-open", "true");
  });

  it("hides the search panel and pulls the tabs up when playback starts", async () => {
    const set = await client.rpc("set_room_media", {
      _room_id: roomId,
      _provider: "youtube",
      _media_id: VIDEO,
      _expected_version: null,
    });
    expect((set.data as { ok: boolean }).ok).toBe(true);

    const play = await client.rpc("play_room_media", { _room_id: roomId });
    expect((play.data as { ok: boolean }).ok).toBe(true);

    await expectSearchVisible(false);
    await expect(searchToggle()).toHaveAttribute("aria-expanded", "false", { timeout: 20_000 });
    await expect(tabsNav()).toHaveAttribute("data-search-open", "false", { timeout: 20_000 });

    // Tabs sit under the video and stay reachable without scrolling away.
    const box = await tabsNav().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y).toBeLessThan(1800);
  });

  it("re-opens on demand and collapses again on the next play", async () => {
    await searchToggle().click();
    await expectSearchVisible(true);
    await expect(tabsNav()).toHaveAttribute("data-search-open", "true", { timeout: 20_000 });

    const pause = await client.rpc("pause_room_media", { _room_id: roomId });
    expect((pause.data as { ok: boolean }).ok).toBe(true);
    // Pausing must not close a panel the user opened deliberately.
    await expectSearchVisible(true);

    const play = await client.rpc("play_room_media", { _room_id: roomId });
    expect((play.data as { ok: boolean }).ok).toBe(true);
    await expectSearchVisible(false);
    await expect(tabsNav()).toHaveAttribute("data-search-open", "false", { timeout: 20_000 });
  });
});
