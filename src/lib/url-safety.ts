/**
 * Phase 6 — resource URL validation and normalization.
 *
 * SECURITY MODEL
 * --------------
 * A room resource is a *reference*, never fetched content. This module is the
 * single specification of which references are storable. It is pure and runs
 * identically in the browser (for instant feedback) and inside the server
 * functions (where it is the actual boundary — the browser copy is UX only).
 *
 * Rejected by design:
 *   - every scheme except http/https (kills javascript:, data:, file:, blob:,
 *     vbscript:, intent:, about: … so a stored URL can never be an XSS sink)
 *   - credentials embedded in the authority (user:pass@host — phishing/redirect)
 *   - loopback, private, link-local, CGNAT, multicast, reserved and metadata
 *     hosts (169.254.169.254 and friends) so no stored reference can be used to
 *     probe internal infrastructure if a future phase ever fetches one
 *   - hostnames without a dot, and the .local / .internal / .home / .lan
 *     pseudo-TLDs, which only resolve inside a private network
 *   - malformed URLs and anything longer than 2048 characters
 *
 * NORMALIZATION STRATEGY (used only for duplicate detection; the original URL
 * is always stored verbatim and is what a member actually opens):
 *   1. lowercase the scheme and the host, strip a trailing root dot
 *   2. drop the default port (:80 for http, :443 for https)
 *   3. drop the fragment (#…) — it never identifies a different document
 *   4. drop a bare trailing "/" on an empty path
 *   5. drop *only* the documented tracking parameters below. Every other query
 *      parameter is meaningful (?id=, ?page=, ?v=, ?q= …) and is preserved.
 *   6. sort the remaining parameters so ?a=1&b=2 and ?b=2&a=1 dedupe together
 * Normalization deliberately does NOT touch the path, case of the path, or
 * unknown parameters: two URLs that differ there are two different documents.
 */

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "yclid",
  "twclid",
  "ref_src",
  "ref_url",
  "_ga",
  "_gl",
  "vero_id",
  "vero_conv",
]);

const PRIVATE_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home", ".lan", ".test"];

export const MAX_URL_LENGTH = 2048;

export type UrlRejection =
  "malformed" | "scheme_not_allowed" | "credentials_not_allowed" | "too_long" | "private_network";

export interface UrlAccepted {
  ok: true;
  url: string;
  normalized: string;
  host: string;
}

export interface UrlRejected {
  ok: false;
  reason: UrlRejection;
}

export type UrlCheck = UrlAccepted | UrlRejected;

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return false;
  const [a, b] = nums as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.replace(/\.$/, "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host === "broadcasthost") return true;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  if (host.startsWith("[") && host.endsWith("]")) {
    const v6 = host.slice(1, -1).toLowerCase();
    if (v6 === "::1" || v6 === "::" || v6 === "0:0:0:0:0:0:0:1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true; // unique local
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return true; // link-local
    if (v6.startsWith("::ffff:")) return isPrivateIPv4(v6.slice(7));
    return false;
  }

  if (/^\d+(\.\d+)*$/.test(host)) {
    // Bare or short numeric forms (e.g. 2130706433, 127.1) are always refused:
    // they are only ever used to disguise a loopback/private target.
    return !(/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !isPrivateIPv4(host));
  }

  // Single-label hostnames only resolve through an internal search domain.
  if (!host.includes(".")) return true;
  return false;
}

/** Validates a user-supplied resource URL and derives its dedupe key. */
export function checkResourceUrl(raw: string): UrlCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "malformed" };
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: "too_long" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return { ok: false, reason: "scheme_not_allowed" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "credentials_not_allowed" };
  }
  if (!parsed.hostname) return { ok: false, reason: "malformed" };
  if (isPrivateHost(parsed.hostname)) return { ok: false, reason: "private_network" };

  const host = parsed.hostname.replace(/\.$/, "").toLowerCase();

  const normalizedUrl = new URL(parsed.toString());
  normalizedUrl.protocol = scheme;
  normalizedUrl.hostname = host;
  normalizedUrl.hash = "";
  if (
    (scheme === "http:" && normalizedUrl.port === "80") ||
    (scheme === "https:" && normalizedUrl.port === "443")
  ) {
    normalizedUrl.port = "";
  }

  const params = [...normalizedUrl.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()) && !/^utm_/i.test(key))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const search = new URLSearchParams(params).toString();

  const path = normalizedUrl.pathname === "/" ? "" : normalizedUrl.pathname;
  const normalized = `${scheme}//${host}${normalizedUrl.port ? `:${normalizedUrl.port}` : ""}${path}${
    search ? `?${search}` : ""
  }`;

  return { ok: true, url: parsed.toString(), normalized, host };
}

const REJECTION_MESSAGES: Record<UrlRejection, string> = {
  malformed: "That doesn't look like a valid web address.",
  scheme_not_allowed: "Only http and https links can be added.",
  credentials_not_allowed: "Links containing a username or password aren't allowed.",
  too_long: "That link is too long.",
  private_network: "Links to local or private network addresses aren't allowed.",
};

export function urlRejectionMessage(reason: UrlRejection): string {
  return REJECTION_MESSAGES[reason];
}

/** Display label for a resource: the registrable-looking host, without "www.". */
export function displayHost(host: string | null | undefined): string {
  if (!host) return "";
  return host.replace(/^www\./, "");
}
