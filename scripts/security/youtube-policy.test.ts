/**
 * PHASE 4.2 (corrected) — YouTube policy completeness & embedded playback
 * integrity. Tests YT-POLICY-T1 … T20.
 *
 * Corrected policy model under test:
 *  - "Made for Kids" is PLAYABLE. It only suppresses analytics.
 *  - Policy verification FAILS CLOSED: no cache row, or an expired one, means
 *    the media cannot be set (`provider_verification_failed`). There is no
 *    oEmbed-derived policy fallback.
 *  - The client cannot supply a title, thumbnail or policy verdict.
 *  - The embedded player is never obscured once a video is rendered.
 *
 * Skipped automatically when backend credentials are absent.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { evaluateYouTubePolicy, policyFromJsonb } from "../../src/lib/media-policy";
import { planPlayerSurface } from "../../src/lib/player-surface";
import { classifyYouTubePlayerError } from "../../src/lib/providers/youtube";
import {
  __setConsentStore,
  isEventSuppressed,
  setAnalyticsConsent,
  setPlaybackTrackingRestricted,
} from "../../src/lib/analytics";

const url = process.env["SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
const enabled = Boolean(url && serviceKey && anonKey);
const suite = enabled ? describe : describe.skip;

const password = "Test-Password-123!";
const PUBLIC_VIDEO = "P42PUBLIC01";
const MFK_VIDEO = "P42MFKVID01";
const PRIVATE_VIDEO = "P42PRIVATE1";
const NON_EMBED_VIDEO = "P42NOEMBED1";
const UNAVAILABLE_VIDEO = "P42UNAVAIL1";
const UNVERIFIED_VIDEO = "P42NOCACHE1";
const EXPIRED_VIDEO = "P42EXPIRED1";
const FORGED_EMBED_VIDEO = "P42FORGED01";
const FORGED_PRIV_VIDEO = "P42FORGED02";
const EVIL_THUMB_VIDEO = "P42EVILTHM1";
const ALL_VIDEOS = [
  PUBLIC_VIDEO,
  MFK_VIDEO,
  PRIVATE_VIDEO,
  NON_EMBED_VIDEO,
  UNAVAILABLE_VIDEO,
  UNVERIFIED_VIDEO,
  EXPIRED_VIDEO,
  FORGED_EMBED_VIDEO,
  FORGED_PRIV_VIDEO,
  EVIL_THUMB_VIDEO,
];

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

suite("phase 4.2 YouTube policy completeness (corrected)", () => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: TestUser[] = [];
  let host: TestUser;
  let roomId = "";

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `p42c-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  /** Only the service role may populate the trusted policy cache. */
  async function seedPolicy(mediaId: string, status: string, extras: Record<string, unknown> = {}) {
    const { error } = await admin.rpc("upsert_media_metadata_cache", {
      _provider: "youtube",
      _media_id: mediaId,
      _title: "Provider title",
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
        join_code: `P4C${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      })
      .select("id")
      .single();
    if (error) throw error;
    roomId = data.id as string;
  }, 120_000);

  afterAll(async () => {
    await admin.from("media_metadata_cache").delete().in("media_id", ALL_VIDEOS);
    await admin.from("rooms").delete().eq("id", roomId);
    for (const user of created) {
      await user.client.auth.signOut();
      await admin.auth.admin.deleteUser(user.id);
    }
  }, 120_000);

  afterEach(async () => {
    if (host) await admin.from("rate_limits").delete().eq("user_id", host.id);
    setPlaybackTrackingRestricted(false);
  });

  // ---------------------------------------------------------------- T1 … T3

  it("YT-POLICY-T1: the Data API key is server-side only", () => {
    expect(process.env["YOUTUBE_DATA_API_KEY"]).toBeTruthy();
    // Never exposed through a VITE_ variable, and never referenced by client code.
    expect(process.env["VITE_YOUTUBE_DATA_API_KEY"]).toBeUndefined();
    const resolver = readFileSync("src/lib/media-metadata.functions.ts", "utf8");
    expect(resolver).toContain('process.env["YOUTUBE_DATA_API_KEY"]');
    const component = readFileSync("src/components/room/watch-together.tsx", "utf8");
    expect(component).not.toContain("YOUTUBE_DATA_API_KEY");
  });

  it("YT-POLICY-T2: a verified public video is accepted with server-owned metadata", async () => {
    await seedPolicy(PUBLIC_VIDEO, "ok");
    const res = await setMedia(host, PUBLIC_VIDEO);
    expect(res.ok).toBe(true);
    expect(res.state?.provider_media_id).toBe(PUBLIC_VIDEO);

    const { data: row } = await admin
      .from("room_playback_state")
      .select("title, thumbnail_url, policy_check_result")
      .eq("room_id", roomId)
      .single();
    expect(row?.title).toBe("Provider title");
    expect(row?.thumbnail_url).toBe(`https://i.ytimg.com/vi/${PUBLIC_VIDEO}/hqdefault.jpg`);
    const policy = policyFromJsonb(row?.policy_check_result);
    expect(policy?.playable).toBe(true);
    expect(policy?.tracking_restricted).toBe(false);
  }, 60_000);

  it("YT-POLICY-T3: Made for Kids content PLAYS and is flagged tracking_restricted", async () => {
    await seedPolicy(MFK_VIDEO, "made_for_kids");
    const res = await setMedia(host, MFK_VIDEO);
    expect(res.ok).toBe(true);
    expect(res.state?.provider_media_id).toBe(MFK_VIDEO);

    const { data: row } = await admin
      .from("room_playback_state")
      .select("policy_check_result")
      .eq("room_id", roomId)
      .single();
    const raw = row?.policy_check_result as Record<string, unknown>;
    expect(raw["status"]).toBe("made_for_kids");
    expect(raw["made_for_kids"]).toBe(true);
    expect(raw["tracking_restricted"]).toBe(true);
    expect(raw["playable"]).toBe(true);
  }, 60_000);

  // ---------------------------------------------------------------- T4 … T7

  it("YT-POLICY-T4: playback analytics are suppressed for Made for Kids media", () => {
    const memory = new Map<string, string>();
    __setConsentStore({
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    });
    setAnalyticsConsent(true);

    setPlaybackTrackingRestricted(false);
    expect(isEventSuppressed("playback_started")).toBe(false);

    setPlaybackTrackingRestricted(true);
    expect(isEventSuppressed("playback_started")).toBe(true);
    expect(isEventSuppressed("playback_media_selected")).toBe(true);
    expect(isEventSuppressed("playback_seeked")).toBe(true);
    // Non-playback product events are unaffected.
    expect(isEventSuppressed("room_created")).toBe(false);

    setPlaybackTrackingRestricted(false);
    __setConsentStore(null);
  });

  it("YT-POLICY-T5: non-embeddable content is rejected", async () => {
    await seedPolicy(NON_EMBED_VIDEO, "not_embeddable");
    const res = await setMedia(host, NON_EMBED_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_embeddable");
  }, 60_000);

  it("YT-POLICY-T6: private content is rejected", async () => {
    await seedPolicy(PRIVATE_VIDEO, "privacy_blocked");
    const res = await setMedia(host, PRIVATE_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("privacy_blocked");
  }, 60_000);

  it("YT-POLICY-T7: unavailable content is rejected", async () => {
    await seedPolicy(UNAVAILABLE_VIDEO, "unavailable");
    const res = await setMedia(host, UNAVAILABLE_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unavailable");
  }, 60_000);

  // --------------------------------------------------------------- T8 … T12

  it("YT-POLICY-T8: an unverified video fails closed", async () => {
    await admin.from("media_metadata_cache").delete().eq("media_id", UNVERIFIED_VIDEO);
    const res = await setMedia(host, UNVERIFIED_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("provider_verification_failed");
  }, 60_000);

  it("YT-POLICY-T9: an expired policy never authorizes playback", async () => {
    await seedPolicy(EXPIRED_VIDEO, "ok", { _ttl_hours: -1 });
    const { data: rows } = await admin
      .from("media_metadata_cache")
      .select("expires_at")
      .eq("media_id", EXPIRED_VIDEO)
      .limit(1);
    expect(new Date(rows![0]!.expires_at as string).getTime()).toBeLessThan(Date.now());

    const res = await setMedia(host, EXPIRED_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("provider_verification_failed");
  }, 60_000);

  it("YT-POLICY-T10: the client cannot supply title, thumbnail or a policy verdict", async () => {
    await seedPolicy(PUBLIC_VIDEO, "ok");
    // The legacy metadata-accepting overload no longer exists: PostgREST cannot
    // find a matching function signature.
    const { error } = await host.client.rpc("set_room_media", {
      _room_id: roomId,
      _provider: "youtube",
      _media_id: PUBLIC_VIDEO,
      _title: "Client injected title",
      _thumbnail_url: "https://evil.test/phish.png",
      _policy_check_result: { status: "ok", made_for_kids: false },
      _expected_version: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(error).not.toBeNull();

    // And the client call path in application code sends no metadata at all.
    const callSite = readFileSync("src/lib/playback.functions.ts", "utf8");
    expect(callSite).not.toContain("_title");
    expect(callSite).not.toContain("_thumbnail_url");
    expect(callSite).not.toContain("_policy_check_result");
  }, 60_000);

  it("YT-POLICY-T11: a forged cache row claiming ok but non-embeddable is rejected", async () => {
    await seedPolicy(FORGED_EMBED_VIDEO, "ok", { _embeddable: false });
    const res = await setMedia(host, FORGED_EMBED_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_embeddable");
  }, 60_000);

  it("YT-POLICY-T12: a forged cache row claiming ok but private is rejected", async () => {
    await seedPolicy(FORGED_PRIV_VIDEO, "ok", { _privacy_status: "private" });
    const res = await setMedia(host, FORGED_PRIV_VIDEO);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("privacy_blocked");
  }, 60_000);

  // -------------------------------------------------------------- T13 … T16

  it("YT-POLICY-T13: authenticated users cannot write the policy cache", async () => {
    const insert = await host.client.from("media_metadata_cache").insert({
      provider: "youtube",
      media_id: PUBLIC_VIDEO,
      title: "Injected",
      made_for_kids: false,
      embeddable: true,
      privacy_status: "public",
      status: "ok",
      source: "malicious",
    });
    expect(insert.error).not.toBeNull();

    const update = await host.client
      .from("media_metadata_cache")
      .update({ status: "ok", embeddable: true })
      .eq("media_id", NON_EMBED_VIDEO);
    expect(update.error).not.toBeNull();

    const remove = await host.client
      .from("media_metadata_cache")
      .delete()
      .eq("media_id", NON_EMBED_VIDEO);
    expect(remove.error).not.toBeNull();
  }, 60_000);

  it("YT-POLICY-T14: authenticated users cannot execute the cache upsert function", async () => {
    const { error } = await host.client.rpc("upsert_media_metadata_cache", {
      _provider: "youtube",
      _media_id: PUBLIC_VIDEO,
      _title: "Injected",
      _thumbnail_url: `https://i.ytimg.com/vi/${PUBLIC_VIDEO}/hqdefault.jpg`,
      _made_for_kids: false,
      _embeddable: true,
      _privacy_status: "public",
      _status: "ok",
      _source: "malicious",
      _ttl_hours: 24,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(error).not.toBeNull();
  }, 60_000);

  it("YT-POLICY-T15: stored thumbnails are always canonical YouTube URLs", async () => {
    await seedPolicy(EVIL_THUMB_VIDEO, "ok", { _thumbnail_url: "https://evil.test/phish.png" });
    const res = await setMedia(host, EVIL_THUMB_VIDEO);
    expect(res.ok).toBe(true);

    const { data: row } = await admin
      .from("room_playback_state")
      .select("thumbnail_url")
      .eq("room_id", roomId)
      .single();
    expect(row?.thumbnail_url).toBe(`https://i.ytimg.com/vi/${EVIL_THUMB_VIDEO}/hqdefault.jpg`);
  }, 60_000);

  it("YT-POLICY-T16: the policy engine classifies MFK as playable, not blocked", () => {
    const mfk = evaluateYouTubePolicy("dQw4w9WgXcQ", {
      snippet: { title: "Kids clip" },
      status: { madeForKids: true, embeddable: true, privacyStatus: "public" },
    });
    expect(mfk.ok).toBe(true);
    expect(mfk.policy.status).toBe("made_for_kids");
    expect(mfk.policy.playable).toBe(true);
    expect(mfk.policy.tracking_restricted).toBe(true);

    const blocked = evaluateYouTubePolicy("dQw4w9WgXcQ", {
      status: { madeForKids: true, embeddable: false, privacyStatus: "public" },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.policy.status).toBe("not_embeddable");

    // A missing video is unavailable; there is no permissive default.
    expect(evaluateYouTubePolicy("dQw4w9WgXcQ", null).policy.status).toBe("unavailable");
  });

  // -------------------------------------------------------------- T17 … T20

  it("YT-POLICY-T17: nothing overlays the player once a video is rendered", () => {
    const base = {
      providerFailure: null,
      authorized: true,
      playerReady: true,
      loading: false,
      hasMedia: true,
      connected: true,
      awaitingGesture: false,
      policyStatus: "ok" as const,
    };
    expect(planPlayerSurface(base).overlay).toBeNull();
    // Even while disconnected, drifting or awaiting a gesture, no overlay.
    expect(planPlayerSurface({ ...base, connected: false }).overlay).toBeNull();
    expect(planPlayerSurface({ ...base, awaitingGesture: true }).overlay).toBeNull();
    expect(planPlayerSurface({ ...base, loading: true }).overlay).toBeNull();
    // MFK plays: informational notice only, never a block.
    const mfk = planPlayerSurface({ ...base, policyStatus: "made_for_kids" });
    expect(mfk.overlay).toBeNull();
    expect(mfk.videoRendered).toBe(true);
    expect(mfk.notices.some((n) => n.id === "made-for-kids")).toBe(true);

    // The component renders the overlay only from surface.overlay.
    const component = readFileSync("src/components/room/watch-together.tsx", "utf8");
    expect(component).toContain("surface.overlay");
    expect(component).not.toContain("absolute inset-0 flex flex-col items-center justify-center");
  });

  it("YT-POLICY-T18: the gesture prompt is outside the frame and only when playing is possible", () => {
    const base = {
      providerFailure: null,
      authorized: true,
      playerReady: true,
      loading: false,
      hasMedia: true,
      connected: true,
      awaitingGesture: true,
      policyStatus: "ok" as const,
    };
    expect(planPlayerSurface(base).gesturePrompt).toBe(true);
    // No video rendered → no gesture prompt, just the informative overlay.
    const blocked = planPlayerSurface({ ...base, policyStatus: "not_embeddable" });
    expect(blocked.gesturePrompt).toBe(false);
    expect(blocked.overlay).toBeTruthy();
    expect(planPlayerSurface({ ...base, hasMedia: false }).gesturePrompt).toBe(false);
  });

  it("YT-POLICY-T19: referrer policy keeps the origin and error 153 is classified", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).not.toContain('"no-referrer"');
    expect(root).toContain("strict-origin-when-cross-origin");
    // The embed iframe must not be given rel=noreferrer either.
    const component = readFileSync("src/components/room/watch-together.tsx", "utf8");
    expect(component).not.toContain("noreferrer");
    expect(classifyYouTubePlayerError(153).kind).toBe("origin_not_allowed");
  });

  it("YT-POLICY-T20: background pause is local only and never mutates room state", async () => {
    await seedPolicy(PUBLIC_VIDEO, "ok");
    const set = await setMedia(host, PUBLIC_VIDEO);
    expect(set.ok).toBe(true);

    const { data: before } = await admin
      .from("room_playback_state")
      .select("version, playback_status")
      .eq("room_id", roomId)
      .single();

    // Any attempt to write the authoritative state directly is refused, so a
    // local visibility pause cannot leak into the room.
    const direct = await host.client
      .from("room_playback_state")
      .update({ playback_status: "paused" })
      .eq("room_id", roomId);
    expect(direct.error).not.toBeNull();

    const { data: after } = await admin
      .from("room_playback_state")
      .select("version, playback_status")
      .eq("room_id", roomId)
      .single();
    expect(after?.version).toBe(before?.version);
    expect(after?.playback_status).toBe(before?.playback_status);

    // The visibility handler pauses the local player only — no mutation call.
    const component = readFileSync("src/components/room/watch-together.tsx", "utf8");
    const handler = component.slice(
      component.indexOf("const onVisibility"),
      component.indexOf('document.addEventListener("visibilitychange"'),
    );
    expect(handler).toContain("pauseVideo");
    expect(handler).not.toContain("mutate(");
  }, 60_000);
});
