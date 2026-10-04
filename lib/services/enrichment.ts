import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LeadEnrichment } from "@/lib/db/types";
import { isFreeMailDomain } from "@/lib/domain/scoring";
import { DEMO_SITES } from "./demo-data";
import { appOrigin } from "./shared";

/**
 * Company research (spec 3.2 step 2): fetch the lead's company homepage and
 * keep its title, description, headings and a ~1,500-character text excerpt.
 *
 * - No JavaScript, robots.txt honoured, 3 s for robots.txt plus 5 s for the
 *   page (inside the privacy page's eight-second promise), 512 KB read cap.
 * - Free-mail domains are skipped; demo domains (*.example) read built-in
 *   fixtures so the demo works offline.
 * - SSRF guard: only public hostnames; every address the name resolves to
 *   must be public, re-checked on each redirect (at most 3). DNS rebinding
 *   between the check and the fetch is not defended against; the fetch only
 *   ever reads a homepage and the body is never executed.
 * - The text is untrusted: it is stored as data and shown to the scoring
 *   model inside <website> tags with an instruction never to follow it.
 */

const ROBOTS_TIMEOUT_MS = 3_000;
const PAGE_TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
export const EXCERPT_CHARS = 1_500;
const RESERVED_TLDS = /\.(?:example|test|invalid|localhost|local|internal|lan|home|corp)$/i;
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function userAgent(): string {
  return `FirstreplyBot/1.0 (+${appOrigin()})`;
}

/* ------------------------------------------------------------------ */
/* HTML extraction (pure)                                              */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function clean(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, name: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (key !== name) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return clean(content);
  }
  return null;
}

export type HomepageExtract = Pick<LeadEnrichment, "title" | "description" | "headings" | "excerpt">;

export function extractHomepage(html: string): HomepageExtract {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(stripped)?.[1] ?? "") || null;
  const description = metaContent(stripped, "description") ?? metaContent(stripped, "og:description");
  const headings = [...stripped.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => clean(m[2]))
    .filter((h) => h.length > 0 && h.length <= 200)
    .slice(0, 12);
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(stripped)?.[1] ?? stripped;
  const text = clean(body);
  return {
    title: title?.slice(0, 200) ?? null,
    description: description?.slice(0, 400) ?? null,
    headings,
    excerpt: text ? text.slice(0, EXCERPT_CHARS) : null,
  };
}

/** One-line company summary for the reply prompt ("what we know about their company"). */
export function summarize(extract: HomepageExtract): string | null {
  const parts = [extract.title, extract.description].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return extract.excerpt ? extract.excerpt.slice(0, 240) : null;
  return parts.join(": ").slice(0, 300);
}

/* ------------------------------------------------------------------ */
/* robots.txt (pure)                                                   */
/* ------------------------------------------------------------------ */

/** True when robots.txt disallows "/" for us (or for every agent). Minimal parser: groups, Disallow, Allow. */
export function robotsDisallowsHomepage(robots: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "disallow" || key === "allow") && current) {
      current.rules.push({ allow: key === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const ours = groups.find((g) => g.agents.some((a) => a.includes("firstreply")));
  const group = ours ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return false;
  const matching = group.rules.filter((r) => r.path !== "" && "/".startsWith(r.path.replace(/\*$/, "").replace(/\$$/, "")));
  if (matching.length === 0) return false;
  // Longest match wins; Allow wins ties.
  const best = matching.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
  return !best.allow;
}

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

/** Throws unless `host` is a public DNS name whose every address is public. */
export async function assertPublicHost(host: string): Promise<void> {
  if (!HOSTNAME.test(host) || isIP(host) || RESERVED_TLDS.test(host)) throw new Error("not a public hostname");
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("resolves to a private address");
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, bytes.byteLength - offset);
    bytes.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= bytes.byteLength) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function fetchPublic(url: URL, timeoutMs: number, accept: string): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") throw new Error("unsupported redirect");
    await assertPublicHost(current.hostname);
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { "user-agent": userAgent(), accept },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error("too many redirects");
}

/** Live homepage research for a domain; never throws (failures are recorded in `error`). */
export async function enrichDomain(domain: string | null, now: Date = new Date()): Promise<LeadEnrichment> {
  const fetchedAt = now.toISOString();
  const host = domain?.trim().toLowerCase().replace(/^www\./, "") ?? "";
  if (!host) return { domain: null, error: "no email domain", fetchedAt };
  if (isFreeMailDomain(host)) return { domain: host, freeMail: true, error: "free-mail domain", fetchedAt };

  const fixture = DEMO_SITES[host];
  if (fixture) {
    const extract = extractHomepage(fixture);
    return { domain: host, freeMail: false, homepageUrl: `https://${host}/`, ...extract, summary: summarize(extract), fetchedAt };
  }
  if (RESERVED_TLDS.test(host)) return { domain: host, freeMail: false, error: "reserved domain", fetchedAt };

  try {
    const robots = await fetchPublic(new URL(`https://${host}/robots.txt`), ROBOTS_TIMEOUT_MS, "text/plain").catch(
      () => null,
    );
    if (robots?.ok && robotsDisallowsHomepage(await readCapped(robots, 64 * 1024))) {
      return { domain: host, freeMail: false, error: "robots.txt disallows the homepage", fetchedAt };
    }
    const response = await fetchPublic(new URL(`https://${host}/`), PAGE_TIMEOUT_MS, "text/html,application/xhtml+xml");
    if (!response.ok) return { domain: host, freeMail: false, error: `homepage returned HTTP ${response.status}`, fetchedAt };
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) return { domain: host, freeMail: false, error: `homepage is ${type}`, fetchedAt };
    const extract = extractHomepage(await readCapped(response, MAX_BYTES));
    return {
      domain: host,
      freeMail: false,
      homepageUrl: response.url || `https://${host}/`,
      ...extract,
      summary: summarize(extract),
      fetchedAt,
    };
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "TimeoutError" ? "timed out" : error.message) : "fetch failed";
    return { domain: host, freeMail: false, error: `homepage not reachable (${reason})`, fetchedAt };
  }
}
