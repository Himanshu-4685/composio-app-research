// Verification orchestrator.
//   verify --run <id> --stage checks   L1 rules + L2 quotes + L4 Composio catalog (no LLM)
//   verify --run <id> --stage critic   L3 critic on every ok record (LLM, no tools)
//   verify --run <id> --stage fix      L5 re-research of flagged apps -> final.jsonl + corrections.jsonl
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import type { AppRecord } from "../schema.js";
import { ruleChecks, quoteChecks, type Flag } from "./checks.js";
import { loadCatalog, matchToolkit, authDisagreements } from "./catalog.js";
import { critique } from "./critic.js";
import { researchApp } from "../agent/research.js";

const readJsonl = <T,>(p: string): T[] => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const readJson = (p: string, d: any = {}) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d;

/** Latest record per app id (a resumed run may have a failed attempt followed by an ok one). */
export function latestById(records: AppRecord[]): Map<number, AppRecord> {
  const m = new Map<number, AppRecord>();
  for (const r of records) if (!m.has(r.id) || r.status === "ok" || m.get(r.id)!.status !== "ok") m.set(r.id, r);
  return m;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// mode "trimmed": re-research only apps with L1/L4 flags or critic contradicted/suspect; apps whose only issue is
// "insufficient" are copied with deferred=true. mode "full" (after a usage reset) re-researches those deferred apps too.
export async function verify(runId: string, stage: string, only?: number[], mode: "trimmed" | "full" = "trimmed") {
  const dir = `runs/${runId}`, vdir = `${dir}/verify`;
  mkdirSync(vdir, { recursive: true });
  const base = [...latestById(readJsonl<AppRecord>(`${dir}/baseline.jsonl`)).values()].filter((r) => !only || only.includes(r.id)).sort((a, b) => a.id - b.id);

  if (stage === "checks") {
    const catalog = await loadCatalog();
    const out: Record<number, any> = {};
    for (const r of base) {
      const flags: Flag[] = ruleChecks(r);
      const q = r.status === "ok" ? await quoteChecks(r) : { flags: [], results: [] };
      flags.push(...q.flags);
      const tk = matchToolkit(r, catalog);
      if (tk && r.status === "ok") {
        const miss = authDisagreements(r.auth.methods, tk.auth_schemes);
        if (miss.length) flags.push({ app_id: r.id, field: "auth", layer: "L4", msg: `Composio toolkit '${tk.slug}' supports ${miss.join(", ")}, not in our auth methods [${r.auth.methods.join(", ")}]` });
      }
      out[r.id] = { name: r.name, flags, quotes: q.results, composio: tk ? { slug: tk.slug, auth_schemes: tk.auth_schemes, tools_count: tk.tools_count } : null };
      console.log(`#${r.id} ${r.name}: ${flags.length} flags | quotes ${q.results.filter((x) => x.result === "verbatim" || x.result === "near").length}/${q.results.length} | composio ${tk?.slug ?? "-"}`);
    }
    writeFileSync(`${vdir}/checks.json`, JSON.stringify(out, null, 1));
    const all = Object.values(out).flatMap((x: any) => x.flags as Flag[]);
    const byLayer = all.reduce((a: any, f) => ((a[f.layer] = (a[f.layer] ?? 0) + 1), a), {});
    console.log(`\n${all.length} flags on ${Object.values(out).filter((x: any) => x.flags.length).length}/${base.length} apps`, byLayer);
  }

  if (stage === "critic") {
    const path = `${vdir}/critic.json`, out = readJson(path);
    const todo = base.filter((r) => r.status === "ok" && !out[r.id]?.auth);
    console.log(`critic: ${todo.length} apps`);
    await pool(todo, 2, async (r) => {
      const c = await critique(r);
      out[r.id] = c.out ?? { error: c.error };
      writeFileSync(path, JSON.stringify(out, null, 1));
      const bad = c.out ? Object.entries(c.out).filter(([, j]) => j.status !== "supported").map(([k, j]) => `${k}:${j.status}`) : [c.error];
      console.log(`#${r.id} ${r.name}: ${bad.length ? bad.join(" ") : "all supported"} ($${c.usd.toFixed(3)})`);
    });
  }

  if (stage === "fix") {
    const checks = readJson(`${vdir}/checks.json`), critic = readJson(`${vdir}/critic.json`);
    const finalPath = `${dir}/final.jsonl`;
    const done = new Set(readJsonl<AppRecord & { deferred?: boolean }>(finalPath).filter((r) => mode === "trimmed" || !r.deferred).map((r) => r.id));
    const issuesFor = (r: AppRecord) => {
      const issues: { layer: string; field: string; msg: string }[] = (checks[r.id]?.flags ?? []).map((f: Flag) => ({ layer: f.layer, field: f.field, msg: f.msg }));
      for (const [field, j] of Object.entries(critic[r.id] ?? {}) as [string, any][])
        if (j?.status && j.status !== "supported") issues.push({ layer: "L3", field, msg: `${j.status}: ${j.reason}` });
      return issues;
    };
    const todo = base.filter((r) => !done.has(r.id));
    console.log(`fix: ${todo.length} apps, ${todo.filter((r) => issuesFor(r).length).length} flagged for re-research`);
    await pool(todo, 2, async (r) => {
      const issues = issuesFor(r);
      if (!issues.length) { appendFileSync(finalPath, JSON.stringify({ ...r, pass: "final" }) + "\n"); return; }
      if (mode === "trimmed" && issues.every((i) => i.layer === "L3" && i.msg.startsWith("insufficient") || i.layer === "L2")) {
        appendFileSync(finalPath, JSON.stringify({ ...r, pass: "final", deferred: true }) + "\n");
        console.log(`#${r.id} ${r.name}: deferred (only 'insufficient evidence' issues)`);
        return;
      }
      const extra = [
        "A previous research pass produced the record below. Automated checks and a reviewer raised the issues listed.",
        "Verify EACH issue against official sources (fetch them), fix what is wrong, keep what is right, and return the complete corrected record with verbatim quotes.",
        "If an issue cannot be resolved with evidence, lower confidence and use unknown/needs_research rather than guessing.",
        `ISSUES:\n${issues.map((i) => `- [${i.layer}] ${i.field}: ${i.msg}`).join("\n")}`,
        `PREVIOUS RECORD:\n${JSON.stringify({ identity: r.identity, auth: r.auth, access: r.access, api: { ...r.api, resource_families: undefined }, mcp: r.mcp, verdict: r.verdict, blocker: r.blocker, claims: r.claims.map((c) => ({ field: c.field, url: c.url, quote: c.quote })) })}`,
      ].join("\n\n");
      const { record } = await researchApp(r, { runId, extraInstructions: extra });
      const fin: AppRecord = record.status === "ok" ? { ...record, pass: "final" } : { ...r, pass: "final", open_questions: [...r.open_questions, `re-research failed: ${record.error}`] };
      appendFileSync(finalPath, JSON.stringify(fin) + "\n");
      for (const c of diff(r, fin)) appendFileSync(`${dir}/corrections.jsonl`, JSON.stringify({ app_id: r.id, app: r.name, ...c, triggered_by: [...new Set(issues.map((i) => i.layer))], issues: issues.map((i) => `[${i.layer}] ${i.field}: ${i.msg}`) }) + "\n");
      console.log(`#${r.id} ${r.name}: ${issues.length} issues -> ${r.verdict} => ${fin.verdict} | ${diff(r, fin).map((d) => d.field).join(", ") || "no field changes"}`);
    });
  }
}

export function diff(a: AppRecord, b: AppRecord) {
  const pick: [string, (r: AppRecord) => string][] = [
    ["auth.methods", (r) => [...r.auth.methods].sort().join(";")],
    ["access.dev_access", (r) => r.access.dev_access], ["access.production_access", (r) => r.access.production_access],
    ["access.public_app_review", (r) => r.access.public_app_review],
    ["api.types", (r) => [...r.api.types].sort().join(";")], ["api.breadth", (r) => r.api.breadth],
    ["mcp.status", (r) => r.mcp.status], ["verdict", (r) => r.verdict],
  ];
  return pick.filter(([, f]) => f(a) !== f(b)).map(([field, f]) => ({ field, before: f(a), after: f(b) }));
}
