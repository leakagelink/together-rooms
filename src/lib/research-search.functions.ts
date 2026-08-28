/**
 * SURF MODE — server-side research search.
 *
 * Search engines refuse to be embedded (X-Frame-Options / frame-ancestors), so
 * a search query can never be rendered in the research frame. Instead the query
 * is resolved on the server and only a small, sanitised result list (title, URL,
 * snippet) is returned to the client, which renders it with app UI.
 *
 * Privacy: the query is proxied, never stored, never logged and never attached
 * to the room. No cookies or user identifiers are forwarded to the engine.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface ResearchSearchResult {
  title: string;
  url: string;
  host: string;
  snippet: string;
}

const inputSchema = z.object({ query: z.string().trim().min(1).max(200) });

function decodeEntities(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo HTML results wrap the target in a redirect: /l/?uddg=<encoded>. */
function normaliseHref(href: string): string | null {
  try {
    const raw = href.startsWith("//") ? `https:${href}` : href;
    const url = new URL(raw, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    const final = target ? new URL(target) : url;
    if (final.protocol !== "https:" && final.protocol !== "http:") return null;
    if (final.hostname.endsWith("duckduckgo.com")) return null;
    return final.toString();
  } catch {
    return null;
  }
}

export const researchSearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<{ results: ResearchSearchResult[] }> => {
    const response = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Mozilla/5.0 (compatible; SyncTogetherResearch/1.0)",
        "accept-language": "en",
      },
      body: new URLSearchParams({ q: data.query }).toString(),
    });
    if (!response.ok) return { results: [] };
    const html = await response.text();

    const results: ResearchSearchResult[] = [];
    const seen = new Set<string>();
    const linkRe =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]+class="[^"]*result__a|$)/g;

    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(html)) !== null && results.length < 20) {
      const url = normaliseHref(match[1] ?? "");
      const title = decodeEntities(match[2] ?? "");
      if (!url || !title || seen.has(url)) continue;
      seen.add(url);
      const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(
        match[3] ?? "",
      );
      results.push({
        title: title.slice(0, 160),
        url,
        host: new URL(url).hostname.replace(/^www\./, ""),
        snippet: decodeEntities(snippetMatch?.[1] ?? "").slice(0, 240),
      });
    }
    return { results };
  });
