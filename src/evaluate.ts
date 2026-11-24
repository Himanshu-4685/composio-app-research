// Scores baseline and final records against the human audit (audit/human.csv).
// Each app has 5 graded fields: auth, access, api, mcp, verdict -> C (correct) / I (incorrect) / U (unresolved).
// Rules are mechanical and printed on the page. audit/adjudication.csv may override a grade, with a written reason.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { AppRecord } from "./schema.js";
import { latestById } from "./verify/run.js";

type Grade = "C" | "I" | "U";
export const GRADED = ["auth", "access", "api", "mcp", "verdict"] as const;

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const list = (s: string) => s.toLowerCase().split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
const authNorm = (xs: string[]) => [...new Set(xs.map((x) => (x === "personal_token" ? "api_key" : x)))].sort().join(";"); // a personal token is an API-key-style credential
const BREADTH = ["narrow", "moderate", "broad"];

export function grade(field: (typeof GRADED)[number], r: AppRecord, h: Record<string, string>): Grade {
  const hu = (v: string) => !v || v === "unknown" || v === "needs_research";
  switch (field) {
    case "auth": {
      if (!h.auth_methods || h.auth_methods === "unknown") return "U";
      if (!r.auth.methods.length) return "U";
      return authNorm(r.auth.methods) === authNorm(list(h.auth_methods)) ? "C" : "I";
    }
    case "access": {
      if (hu(h.dev_access) || hu(h.production_access)) return "U";
      if (r.access.dev_access === "unknown" || r.access.production_access === "unknown") return "U";
      return r.access.dev_access === h.dev_access && r.access.production_access === h.production_access ? "C" : "I";
    }
    case "api": {
      if (!h.api_types || hu(h.api_breadth)) return "U";
      if (r.api.breadth === "unknown") return "U";
      const core = (xs: string[]) => ["rest", "graphql", "cli", "soap", "none_found"].filter((t) => xs.includes(t)).join(";");
      const breadthOk = Math.abs(BREADTH.indexOf(r.api.breadth) - BREADTH.indexOf(h.api_breadth)) <= 1; // adjacent breadth accepted (rubric is coarse)
      return core(r.api.types) === core(list(h.api_types)) && breadthOk ? "C" : "I";
    }
    case "mcp": {
      if (hu(h.mcp_status)) return "U";
      if (r.mcp.status === "unknown") return "U";
      return r.mcp.status === h.mcp_status ? "C" : "I";
    }
    case "verdict": {
      if (hu(h.verdict)) return "U";
      if (r.verdict === "needs_research") return "U";
      return r.verdict === h.verdict ? "C" : "I";
    }
  }
}

export function evaluate(runId: string) {
  const sample = JSON.parse(readFileSync("audit/sample.json", "utf8"));
  const human = parseCsv(readFileSync("audit/human.csv", "utf8")).filter((h) => GRADED.some((f) => h[f === "auth" ? "auth_methods" : f === "access" ? "dev_access" : f === "api" ? "api_types" : f === "mcp" ? "mcp_status" : "verdict"]));
  const adj = existsSync("audit/adjudication.csv") ? parseCsv(readFileSync("audit/adjudication.csv", "utf8")) : [];
  const read = (p: string) => existsSync(p) ? latestById(readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : new Map<number, AppRecord>();
  const versions = { baseline: read(`runs/${runId}/baseline.jsonl`), final: read(`runs/${runId}/final.jsonl`) };

  const detail: any[] = [];
  const summary: any = {};
  for (const [ver, recs] of Object.entries(versions)) {
    for (const group of ["calibration", "holdout"]) {
      const c = { C: 0, I: 0, U: 0, apps: 0 }; const perField: any = Object.fromEntries(GRADED.map((f) => [f, { C: 0, I: 0, U: 0 }]));
      for (const pick of sample.picks.filter((p: any) => p.group === group)) {
        const h = human.find((x) => Number(x.id) === pick.id); const r = recs.get(pick.id);
        if (!h || !r) continue;
        c.apps++;
        for (const f of GRADED) {
          const o = adj.find((a) => Number(a.id) === pick.id && a.field === f && a.version === ver);
          const g: Grade = (o?.grade as Grade) ?? grade(f, r, h);
          c[g]++; perField[f][g]++;
          detail.push({ version: ver, group, id: pick.id, app: pick.name, field: f, grade: g, overridden: !!o, override_reason: o?.reason ?? "" });
        }
      }
      const N = c.C + c.I + c.U;
      summary[`${ver}.${group}`] = { ...c, N, supported_rate: N ? c.C / N : null, accuracy_decidable: c.C + c.I ? c.C / (c.C + c.I) : null, coverage: N ? (c.C + c.I) / N : null, perField };
    }
  }
  // Every run keeps its own scores; only the original Claude baseline writes the headline audit/scores.json.
  const outJson = JSON.stringify({ run_id: runId, computed_at: new Date().toISOString(), summary, detail }, null, 1);
  writeFileSync(`runs/${runId}/scores.json`, outJson);
  if (runId === "baseline-v1") writeFileSync("audit/scores.json", outJson);
  for (const [k, v] of Object.entries(summary) as any) if (v.apps) console.log(`${k.padEnd(22)} apps ${v.apps}  C ${v.C} I ${v.I} U ${v.U}  supported ${(100 * v.supported_rate).toFixed(0)}%  decidable-acc ${v.accuracy_decidable == null ? "-" : (100 * v.accuracy_decidable).toFixed(0) + "%"}`);
}
