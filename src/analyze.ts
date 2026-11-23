// Computes the patterns from final records (falls back to baseline). Every number keeps its denominator.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { AppRecord } from "./schema.js";
import { latestById } from "./verify/run.js";

const count = <T,>(xs: T[]) => xs.reduce((m: Record<string, number>, x) => ((m[String(x)] = (m[String(x)] ?? 0) + 1), m), {});
const SELF_SERVE = ["free", "free_trial", "not_applicable"];

/** One primary blocker per app, derived from structured fields (not from free text), so it is countable and reproducible. */
export function primaryBlocker(r: AppRecord): string {
  const { dev_access: d, production_access: p } = r.access;
  if (r.status !== "ok") return "research failed";
  if (d === "partner_or_sales" || p === "partner_or_sales") return "partner / sales gate";
  if (r.verdict === "limited") return r.api.types.includes("none_found") ? "no public API found" : "restricted / local-only tool";
  if (d === "paid_plan" || p === "paid_plan") return "paid tier or API add-on";
  if (d === "admin_approval" || p === "admin_approval") return "org admin must enable";
  if (d === "app_review" || p === "app_review") return "vendor app approval";
  if (r.verdict === "needs_research" || d === "unknown" || p === "unknown") return "unclear: needs research";
  return "none";
}

export function analyze(runId: string) {
  const dir = `runs/${runId}`;
  const src = existsSync(`${dir}/final.jsonl`) ? "final" : "baseline";
  const recs = [...latestById(readFileSync(`${dir}/${src}.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))).values()].sort((a, b) => a.id - b.id);
  const checks = existsSync(`${dir}/verify/checks.json`) ? JSON.parse(readFileSync(`${dir}/verify/checks.json`, "utf8")) : {};
  const inComposio = (r: AppRecord) => !!checks[r.id]?.composio;
  const ok = recs.filter((r) => r.status === "ok");
  const cats = [...new Set(recs.map((r) => r.category))];

  const byCategory = cats.map((c) => {
    const rs = recs.filter((r) => r.category === c);
    return {
      category: c, n: rs.length,
      self_serve_dev: rs.filter((r) => SELF_SERVE.includes(r.access.dev_access)).length,
      api_on_all_plans: rs.filter((r) => SELF_SERVE.includes(r.access.production_access)).length,
      verdicts: count(rs.map((r) => r.verdict)),
      auth: count(rs.flatMap((r) => r.auth.methods)),
      official_mcp: rs.filter((r) => r.mcp.status === "official").length,
      in_composio: rs.filter(inComposio).length,
    };
  });

  const rank = (r: AppRecord) => ({ id: r.id, name: r.name, category: r.category, verdict: r.verdict, breadth: r.api.breadth, mcp: r.mcp.status, in_composio: inComposio(r), blocker: r.blocker, auth: r.auth.methods });
  const out = {
    run_id: runId, source: src, n: recs.length, ok: ok.length, computed_at: new Date().toISOString(),
    verdicts: count(recs.map((r) => r.verdict)),
    auth_methods: count(ok.flatMap((r) => r.auth.methods)),           // overlapping: sums to more than n
    auth_combos: count(ok.map((r) => [...r.auth.methods].sort().join("+") || "none listed")),
    dev_access: count(recs.map((r) => r.access.dev_access)),
    production_access: count(recs.map((r) => r.access.production_access)),
    public_app_review: count(recs.map((r) => r.access.public_app_review)),
    primary_blockers: count(recs.map(primaryBlocker)),
    mcp: count(recs.map((r) => r.mcp.status)),
    api_types: count(ok.flatMap((r) => r.api.types)),
    breadth: count(recs.map((r) => r.api.breadth)),
    confidence: count(recs.map((r) => r.confidence)),
    in_composio: recs.filter(inComposio).length,
    byCategory,
    easy_wins: recs.filter((r) => r.verdict === "build_now" && r.api.breadth !== "narrow").map(rank),
    easy_wins_not_in_composio: recs.filter((r) => r.verdict === "build_now" && !inComposio(r)).map(rank),
    outreach: recs.filter((r) => r.verdict === "outreach_required").map(rank),
    conditions: recs.filter((r) => r.verdict === "build_with_conditions").map((r) => ({ ...rank(r), primary: primaryBlocker(r) })),
    limited_or_unclear: recs.filter((r) => ["limited", "needs_research"].includes(r.verdict) || r.status !== "ok").map((r) => ({ ...rank(r), primary: primaryBlocker(r) })),
  };
  writeFileSync(`${dir}/analysis.json`, JSON.stringify(out, null, 1));
  console.log(`source=${src} n=${out.n}`, "\nverdicts", out.verdicts, "\nauth", out.auth_methods, "\nblockers", out.primary_blockers, "\nmcp", out.mcp, "\nin composio", out.in_composio, "\napp review", out.public_app_review);
  for (const c of byCategory) console.log(`  ${c.category.padEnd(36)} self-serve ${c.self_serve_dev}/10  api-all-plans ${c.api_on_all_plans}/10  build_now ${c.verdicts.build_now ?? 0}  outreach ${c.verdicts.outreach_required ?? 0}  officialMCP ${c.official_mcp}  inComposio ${c.in_composio}`);
  return out;
}
