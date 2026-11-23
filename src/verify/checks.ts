// L1 rule checks and L2 quote checks. Pure code, no LLM.
import type { AppRecord } from "../schema.js";
import { cachedPage, fetchPage } from "../agent/tools.js";

export interface Flag { app_id: number; field: "identity" | "auth" | "access" | "api" | "mcp" | "verdict" | "all"; layer: "L1" | "L2" | "L3" | "L4"; msg: string }

const FREE = ["free", "free_trial"];

/** What the rubric implies from the access fields; null when the rubric can't decide (e.g. limited/CLI). */
export function expectedVerdict(r: AppRecord): string | null {
  const { dev_access: d, production_access: p } = r.access;
  if (d === "partner_or_sales" || p === "partner_or_sales") return "outreach_required";
  if ([d, p].some((x) => ["paid_plan", "admin_approval", "app_review"].includes(x))) return "build_with_conditions";
  if (FREE.includes(d) && [...FREE, "not_applicable"].includes(p) && !r.api.types.includes("none_found")) return "build_now";
  return null;
}

export function ruleChecks(r: AppRecord): Flag[] {
  const f: Flag[] = [];
  const add = (field: Flag["field"], msg: string) => f.push({ app_id: r.id, field, layer: "L1", msg });
  if (r.status !== "ok") { add("all", `research failed: ${r.error}`); return f; }

  const exp = expectedVerdict(r);
  if (exp && r.verdict !== exp && !(r.verdict === "limited" || r.verdict === "needs_research"))
    add("verdict", `verdict ${r.verdict} but access fields imply ${exp}`);
  for (const field of ["auth", "access", "api"] as const)
    if (!r.claims.some((c) => c.field === field)) add(field, `no evidence claim for ${field}`);
  if (["official", "community", "announced"].includes(r.mcp.status) && !r.claims.some((c) => c.field === "mcp"))
    add("mcp", `mcp=${r.mcp.status} with no mcp evidence claim`);
  if (r.mcp.status === "official" && r.mcp.url) {
    const host = safeHost(r.mcp.url), vendor = [safeHost(r.identity.website), safeHost(r.identity.docs_url)].map(root);
    if (host && !vendor.includes(root(host)) && !host.endsWith("github.com"))
      add("mcp", `official MCP url ${host} is not on the vendor domain (${vendor.filter(Boolean).join(", ")})`);
  }
  if (!r.auth.methods.length && !r.api.types.includes("none_found")) add("auth", "no auth methods listed for an app with an API");
  const n = r.api.resource_families.length;
  if ((r.api.breadth === "broad" && n < 5) || (r.api.breadth === "narrow" && n > 3)) add("api", `breadth ${r.api.breadth} but ${n} resource families listed`);
  if (r.confidence === "high" && r.claims.length < 3) add("all", "high confidence with fewer than 3 claims");
  return f;
}

const safeHost = (u: string) => { try { return new URL(u.startsWith("http") ? u : "https://" + u).host.replace(/^www\./, ""); } catch { return ""; } };
const root = (h: string) => h.split(".").slice(-2).join(".");

/** Normalise text so markdown/link/quote-style differences don't cause false misses. */
export function normText(s: string): string {
  return s
    .replace(/\]\([^)]*\)/g, "]")              // [text](url) -> [text]
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/[*_`#>\[\]|\\]/g, " ")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

export type QuoteResult = "verbatim" | "near" | "not_found" | "fetch_failed";

export function matchQuote(quote: string, page: string): QuoteResult {
  const q = normText(quote), p = normText(page);
  if (!q) return "not_found";
  if (p.includes(q)) return "verbatim";
  // near-match: >= 80% of the quote's 5-word shingles appear on the page (handles small line-break/format drift)
  const w = q.split(" "), pw = new Set<string>();
  const ps = p.split(" ");
  for (let i = 0; i + 5 <= ps.length; i++) pw.add(ps.slice(i, i + 5).join(" "));
  const sh: string[] = [];
  for (let i = 0; i + 5 <= w.length; i++) sh.push(w.slice(i, i + 5).join(" "));
  if (sh.length && sh.filter((s) => pw.has(s)).length / sh.length >= 0.8) return "near";
  return "not_found";
}

/** L2: every claim's quote must be on the page it cites (cached copy the agent saw; fetched if absent). */
export async function quoteChecks(r: AppRecord): Promise<{ flags: Flag[]; results: { field: string; url: string; result: QuoteResult }[] }> {
  const results: { field: string; url: string; result: QuoteResult }[] = [];
  for (const c of r.claims) {
    let page = cachedPage(c.url)?.content;
    if (!page) { try { page = (await fetchPage(c.url)).content; } catch { results.push({ field: c.field, url: c.url, result: "fetch_failed" }); continue; } }
    results.push({ field: c.field, url: c.url, result: matchQuote(c.quote, page) });
  }
  const flags: Flag[] = [];
  for (const field of new Set(r.claims.map((c) => c.field))) {
    const rs = results.filter((x) => x.field === field);
    if (!rs.some((x) => x.result === "verbatim" || x.result === "near"))
      flags.push({ app_id: r.id, field: field as Flag["field"], layer: "L2", msg: `no ${field} quote found on its cited page (${rs.map((x) => x.result).join(", ")})` });
  }
  return { flags, results };
}
