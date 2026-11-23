// CLI entry point.
//   npm run research -- --app "Calendly" [--hint calendly.com] [--category "Scheduling"]
//   npm run research -- --ids 4,11,58          (apps from data/apps.json)
//   npm run research -- --all [--concurrency 2] [--run <id>]   (resumes an existing run)
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { researchApp, PROMPT_VERSION } from "./agent/research.js";
import type { AppInput, AppRecord } from "./schema.js";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(`--${name}`);

export function readJsonl<T>(path: string): T[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

async function research() {
  const apps: AppInput[] = JSON.parse(readFileSync("data/apps.json", "utf8"));
  let targets: AppInput[];
  let runId = flag("run");
  if (flag("app")) {
    targets = [{ id: 0, name: flag("app")!, hint: flag("hint") ?? "", category: flag("category") ?? "" }];
    runId ??= "adhoc";
  } else if (flag("ids")) {
    const ids = flag("ids")!.split(",").map(Number);
    targets = apps.filter((a) => ids.includes(a.id));
  } else if (has("all")) {
    targets = apps;
  } else {
    console.error('Usage: research --app "Name" [--hint domain] | --ids 1,2,3 | --all  [--run id] [--concurrency n] [--model sonnet]');
    process.exit(1);
  }
  runId ??= "run-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const dir = `runs/${runId}`;
  mkdirSync(dir, { recursive: true });
  const out = `${dir}/baseline.jsonl`;
  const metaPath = `${dir}/meta.json`;
  if (!existsSync(metaPath)) {
    writeFileSync(metaPath, JSON.stringify({ run_id: runId, prompt_version: PROMPT_VERSION, model: flag("model") ?? "sonnet", started_at: new Date().toISOString() }, null, 2));
    writeFileSync(`${dir}/prompt.md`, readFileSync("prompts/research.md", "utf8")); // frozen copy of the exact prompt used
  }

  // Resume: skip apps that already have an ok record in this run.
  const done = new Set(readJsonl<AppRecord>(out).filter((r) => r.status === "ok").map((r) => r.id));
  const queue = targets.filter((a) => a.id === 0 || !done.has(a.id));
  console.log(`run ${runId} | prompt ${PROMPT_VERSION} | ${queue.length} to research (${done.size} already done)`);

  const concurrency = Number(flag("concurrency") ?? 2);
  let next = 0, stopped = false;
  const worker = async () => {
    while (next < queue.length && !stopped) {
      const app = queue[next++];
      const { record, toolLog } = await researchApp(app, {
        runId, model: flag("model"),
        onEvent: queue.length === 1 ? (e) => console.log(`   → ${e.detail.slice(0, 140)}`) : undefined,
      });
      appendFileSync(out, JSON.stringify(record) + "\n");
      appendFileSync(`${dir}/trace.jsonl`, JSON.stringify({ id: record.id, name: record.name, toolLog }) + "\n");
      const s = record.stats;
      console.log(`[${record.status}] #${record.id} ${record.name}: ${record.verdict} | ${s.searches}s/${s.fetches}f | ${s.seconds}s | ${(s.input_tokens / 1000).toFixed(0)}k in | $${s.notional_usd}${record.error ? " | " + record.error.slice(0, 120) : ""}`);
      if (queue.length === 1) console.log(JSON.stringify(record, null, 2));
      // Subscription usage limit: stop cleanly; `--run <id>` resumes later (failed records are retried).
      if (record.error && /limit|rate|quota|429|overloaded/i.test(record.error)) {
        stopped = true;
        console.log(`STOPPED: looks like a usage/rate limit. Resume later with: npm run research -- --all --run ${runId}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

if (cmd === "research") await research();
else if (cmd === "verify") {
  const { verify } = await import("./verify/run.js");
  await verify(flag("run") ?? "baseline-v1", flag("stage") ?? "checks", flag("ids")?.split(",").map(Number), (flag("mode") as any) ?? "trimmed");
}
else if (cmd === "evaluate") {
  const { evaluate } = await import("./evaluate.js");
  evaluate(flag("run") ?? "baseline-v1");
}
else if (cmd === "analyze") {
  const { analyze } = await import("./analyze.js");
  analyze(flag("run") ?? "baseline-v1");
}
else if (cmd === "render") {
  const { render } = await import("./render.js");
  render(flag("run") ?? "baseline-v1");
}
else if (cmd === "finish") {
  // One command to complete everything after a usage-limit reset. Every stage skips work already done.
  const runId = flag("run") ?? "baseline-v1";
  const { verify } = await import("./verify/run.js");
  if (!has("all")) args.push("--all");
  if (!flag("run")) args.push("--run", runId);
  await research();                              // retries any failed apps
  await verify(runId, "checks");
  await verify(runId, "critic");
  await verify(runId, "fix", undefined, "full"); // includes apps deferred in trimmed mode
  (await import("./evaluate.js")).evaluate(runId);
  (await import("./render.js")).render(runId);
}
else console.error(`Unknown command: ${cmd}. Available: research, verify, evaluate, analyze, render, finish`);
