// Research tools given to the agent.
// Execution goes through the Composio SDK (Keenable public search/fetch toolkits).
// The agent sees them as MCP tools served in-process, so every call passes through
// our code: we log it, cache the page text (verification re-reads it later), and cap usage.
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Composio } from "@composio/core";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const CACHE_DIR = ".cache/pages";
const CLIENT_TITLE = "app-research-agent";
mkdirSync(CACHE_DIR, { recursive: true });

let sessionPromise: Promise<any> | null = null;
export function composioSession() {
  if (!sessionPromise) {
    const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY, allowTracking: false, disableVersionCheck: true } as any);
    sessionPromise = composio.create("app-research-agent", { toolkits: ["keenable"] } as any);
  }
  return sessionPromise;
}

export interface ToolCallLog { tool: string; input: string; ok: boolean; ms: number; chars: number; error?: string }

export interface PageRecord { url: string; fetched_at: string; content: string; via: string }

const pageKey = (url: string) => createHash("sha1").update(url.trim()).digest("hex").slice(0, 16);

export function cachedPage(url: string): PageRecord | null {
  const f = join(CACHE_DIR, pageKey(url) + ".json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

/** Fetch a page via Composio (Keenable). Uses the on-disk cache unless `fresh`. */
export async function fetchPage(url: string, opts: { fresh?: boolean; maxChars?: number } = {}): Promise<PageRecord> {
  if (!opts.fresh) { const c = cachedPage(url); if (c) return c; }
  const session = await composioSession();
  const r: any = await session.execute("KEENABLE_FETCH_URL_PUBLIC", {
    url, keenable_title: CLIENT_TITLE, max_chars: opts.maxChars ?? 40000, live: !!opts.fresh,
  });
  const content: string = r?.data?.content ?? "";
  if (!content) throw new Error(`empty fetch: ${JSON.stringify(r?.error ?? r?.data ?? r).slice(0, 200)}`);
  const rec: PageRecord = { url, fetched_at: new Date().toISOString(), content, via: "composio:KEENABLE_FETCH_URL_PUBLIC" };
  writeFileSync(join(CACHE_DIR, pageKey(url) + ".json"), JSON.stringify(rec));
  return rec;
}

export async function webSearch(query: string) {
  const session = await composioSession();
  const r: any = await session.execute("KEENABLE_SEARCH_WEB_PUBLIC", { query, keenable_title: CLIENT_TITLE });
  const results: any[] = r?.data?.results ?? [];
  return results.slice(0, 8).map((x) => ({ title: x.title ?? "", url: x.url, snippet: String(x.snippet ?? x.description ?? "").slice(0, 500) }));
}

/** Return only paragraphs that mention a focus keyword (plus neighbours), to save tokens. Text is never rewritten, so quotes stay verbatim. */
export function focusText(content: string, focus?: string[], cap = 9000): string {
  if (!focus?.length) {
    return content.length > 6000 ? content.slice(0, 6000) + "\n\n[TRUNCATED: page continues; call again with focus keywords]" : content;
  }
  const paras = content.split(/\n\s*\n/);
  const keys = focus.map((k) => k.toLowerCase());
  const keep = new Set<number>();
  paras.forEach((p, i) => { if (keys.some((k) => p.toLowerCase().includes(k))) [i - 1, i, i + 1].forEach((j) => j >= 0 && j < paras.length && keep.add(j)); });
  if (!keep.size) return `[No section matched ${JSON.stringify(focus)}. Page start:]\n\n` + content.slice(0, 5000);
  let out = "", last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    out += (i !== last + 1 ? "\n\n[...]\n\n" : "\n\n") + paras[i];
    last = i;
    if (out.length > cap) { out += "\n\n[MORE MATCHES OMITTED: narrow your focus keywords]"; break; }
  }
  return out.trim();
}

/** Build the per-app MCP server. `log` collects every call for the trace; `budget` caps calls. */
export function researchToolServer(log: ToolCallLog[], budget = { searches: 12, fetches: 14 }) {
  let searches = 0, fetches = 0;
  const wrap = async (name: string, input: string, fn: () => Promise<string>) => {
    const t0 = Date.now();
    try {
      const out = await fn();
      log.push({ tool: name, input, ok: true, ms: Date.now() - t0, chars: out.length });
      return { content: [{ type: "text" as const, text: out }] };
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
      log.push({ tool: name, input, ok: false, ms: Date.now() - t0, chars: 0, error: msg });
      return { content: [{ type: "text" as const, text: `ERROR: ${msg}` }], isError: true };
    }
  };
  return createSdkMcpServer({
    name: "research",
    version: "1.0.0",
    tools: [
      tool("web_search", "Search the web. Returns up to 8 results (title, url, snippet). Use site: filters to target official docs, e.g. 'site:docs.attio.com authentication'.",
        { query: z.string() },
        async ({ query }) => wrap("web_search", query, async () => {
          if (++searches > budget.searches) throw new Error("search budget exhausted for this app; finish with what you have");
          return JSON.stringify(await webSearch(query), null, 1);
        })),
      tool("fetch_page", "Fetch a public web page as markdown text. Pass `focus` keywords (e.g. ['oauth','api key','plan']) to get only the matching sections; without focus you get the first ~12k chars. Quotes you cite MUST be copied verbatim from text returned here.",
        { url: z.string().url(), focus: z.array(z.string()).optional() },
        async ({ url, focus }) => wrap("fetch_page", url + (focus?.length ? ` [focus: ${focus.join(", ")}]` : ""), async () => {
          if (++fetches > budget.fetches) throw new Error("fetch budget exhausted for this app; finish with what you have");
          const p = await fetchPage(url);
          return focusText(p.content, focus);
        })),
    ],
  });
}
