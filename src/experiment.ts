// Experiments: re-run the study with a different model (OpenRouter or Claude), prompt/rubric and L1 rule set,
// WITHOUT touching the baseline. Each experiment writes only to runs/<name>/ and is scored against the same
// 20 human audit answers, so runs are directly comparable.
//
//   npm run experiment -- --config experiments/or-rubric-v2.json            (scope from config)
//   npm run experiment -- --config experiments/or-rubric-v2.json --scope all
//   npm run compare                                                          (table of all runs)
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { researchApp } from "./agent/research.js";
import { verify, latestById } from "./verify/run.js";
import { evaluate } from "./evaluate.js";
import type { AppInput, AppRecord } from "./schema.js";

export interface ExperimentConfig {
  name: string; description?: string;
  engine: "openrouter" | "claude"; model: string;
  prompt: string; critic_prompt?: string; critic_engine?: "openrouter" | "claude"; critic_model?: string;
  rules?: string[]; scope?: "audited" | "all" | number[]; concurrency?: number;
}

const readJsonl = (p: string) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

export function loadConfig(path: string): ExperimentConfig {
  const c: ExperimentConfig = JSON.parse(readFileSync(path, "utf8"));
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(c.name ?? "")) throw new Error("config.name must be lowercase letters, digits and dashes");
  if (c.name === "baseline-v1" || c.name.startsWith("pilot")) throw new Error("experiments may not write to the baseline or pilot runs");
  if (!existsSync(c.prompt)) throw new Error(`prompt file not found: ${c.prompt}`);
  if (c.critic_prompt && !existsSync(c.critic_prompt)) throw new Error(`critic prompt not found: ${c.critic_prompt}`);
  if (c.engine === "openrouter" && !process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing in .env");
  return c;
}

export async function runExperiment(cfg: ExperimentConfig, scopeOverride?: string, log: (s: string) => void = console.log) {
  const apps: AppInput[] = JSON.parse(readFileSync("data/apps.json", "utf8"));
  const audited: number[] = (JSON.parse(readFileSync("audit/sample.json", "utf8")).picks ?? []).map((p: any) => p.id);
  const scope = scopeOverride ?? cfg.scope ?? "audited";
  const targets = Array.isArray(scope) ? apps.filter((a) => scope.includes(a.id)) : scope === "all" ? apps : apps.filter((a) => audited.includes(a.id));
  const dir = `runs/${cfg.name}`;
  mkdirSync(dir, { recursive: true });
  // Freeze exactly what this run used.
  if (!existsSync(`${dir}/meta.json`)) {
    writeFileSync(`${dir}/meta.json`, JSON.stringify({ run_id: cfg.name, experiment: cfg, started_at: new Date().toISOString() }, null, 2));
    writeFileSync(`${dir}/prompt.md`, readFileSync(cfg.prompt, "utf8"));
    if (cfg.critic_prompt) writeFileSync(`${dir}/critic_prompt.md`, readFileSync(cfg.critic_prompt, "utf8"));
  }
  const out = `${dir}/baseline.jsonl`;
  const done = new Set(readJsonl(out).filter((r: AppRecord) => r.status === "ok").map((r: AppRecord) => r.id));
  const queue = targets.filter((a) => !done.has(a.id));
  log(`experiment ${cfg.name} | ${cfg.engine}:${cfg.model} | prompt ${cfg.prompt} | ${queue.length} to research (${done.size} done, scope ${Array.isArray(scope) ? "ids" : scope})`);

  let next = 0, stopped = false, usd = 0;
  const worker = async () => {
    while (next < queue.length && !stopped) {
      const app = queue[next++];
      const { record, toolLog } = await researchApp(app, { runId: cfg.name, engine: cfg.engine, model: cfg.model, promptPath: cfg.prompt });
      appendFileSync(out, JSON.stringify(record) + "\n");
      appendFileSync(`${dir}/trace.jsonl`, JSON.stringify({ id: record.id, name: record.name, toolLog }) + "\n");
      usd += record.stats.notional_usd;
      log(`[${record.status}] #${record.id} ${record.name}: ${record.verdict} | ${record.stats.tool_calls} tools | $${record.stats.notional_usd}${record.error ? " | " + record.error.slice(0, 140) : ""}`);
      if (record.error && /limit|quota|429|402|credit|insufficient/i.test(record.error)) { stopped = true; log("STOPPED: rate/credit limit. Re-run the same command to resume."); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency ?? 3, Math.max(1, queue.length)) }, worker));
  if (stopped) return;
  log(`research done ($${usd.toFixed(2)} this session). Verifying…`);
  await verify(cfg.name, "checks");
  await verify(cfg.name, "critic");
  await verify(cfg.name, "fix", undefined, "full");
  evaluate(cfg.name);
  log(compareTable());
}

/** Accuracy of every run that has been scored against the human audit. */
export function compareRows() {
  const rows: any[] = [];
  for (const d of readdirSync("runs")) {
    const sp = `runs/${d}/scores.json`, mp = `runs/${d}/meta.json`;
    const s = existsSync(sp) ? JSON.parse(readFileSync(sp, "utf8")) : d === "baseline-v1" && existsSync("audit/scores.json") ? JSON.parse(readFileSync("audit/scores.json", "utf8")) : null;
    if (!s) continue;
    const m = existsSync(mp) ? JSON.parse(readFileSync(mp, "utf8")) : {};
    const e = m.experiment ?? {};
    const recs = [...latestById(readJsonl(`runs/${d}/final.jsonl`).length ? readJsonl(`runs/${d}/final.jsonl`) : readJsonl(`runs/${d}/baseline.jsonl`)).values()];
    const cost = readJsonl(`runs/${d}/baseline.jsonl`).reduce((a: number, r: any) => a + (r.stats?.notional_usd ?? 0), 0);
    const pick = (k: string) => s.summary?.[k];
    const comb = (ver: string) => { const a = pick(`${ver}.calibration`), b = pick(`${ver}.holdout`); if (!a?.apps && !b?.apps) return null; const C = (a?.C ?? 0) + (b?.C ?? 0), N = (a?.N ?? 0) + (b?.N ?? 0); return { C, N }; };
    rows.push({
      run: d, engine: e.engine ?? "claude", model: e.model ?? "claude-sonnet (Agent SDK)", prompt: e.prompt ?? "prompts/research.md (rubric v1)",
      apps: recs.length, failed: recs.filter((r: any) => r.status !== "ok").length, cost_usd: Number(cost.toFixed(2)),
      first: comb("baseline"), final: comb("final"), holdout_first: pick("baseline.holdout"), holdout_final: pick("final.holdout"),
      perField: pick("final.holdout")?.perField ?? null,
    });
  }
  return rows;
}

export function compareTable() {
  const pc = (x: any) => (x?.N ? `${Math.round((100 * x.C) / x.N)}% (${x.C}/${x.N})` : "–");
  const rows = compareRows();
  return ["run | engine:model | prompt | apps | failed | cost | all-20 first→final | holdout first→final",
    ...rows.map((r) => `${r.run} | ${r.engine}:${r.model} | ${r.prompt} | ${r.apps} | ${r.failed} | $${r.cost_usd} | ${pc(r.first)} → ${pc(r.final)} | ${pc(r.holdout_first)} → ${pc(r.holdout_final)}`)].join("\n");
}
