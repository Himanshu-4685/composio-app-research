// npm run ui -> http://127.0.0.1:8787
// Local page with a "Research any app" box. Same researchApp() as the batch, plus L1 + L2 + critic checks.
// Binds to localhost only; keys come from your own .env / Claude Code login.
import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { researchApp } from "./agent/research.js";
import { ruleChecks, quoteChecks } from "./verify/checks.js";
import { critique } from "./verify/critic.js";
import { verifyAndAdd } from "./added.js";
import { render } from "./render.js";

const PORT = Number(process.env.PORT ?? 8787);
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Research any app</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:30px auto;padding:0 16px;background:#fbfaf8;color:#1d1d1f}input,button{font:inherit;padding:8px 10px;border:1px solid #ccc;border-radius:8px}
#log{background:#f1efeb;padding:12px;border-radius:8px;font:12.5px ui-monospace,monospace;white-space:pre-wrap;min-height:60px}pre{white-space:pre-wrap;font-size:12.5px;background:#fff;border:1px solid #e6e3de;padding:12px;border-radius:8px}</style></head>
<body><h1>Research any app</h1><p>Runs the same agent as the 100-app study (Claude Agent SDK + Composio tools), then rule, quote and critic checks. Results are <b>automated verification only</b>, not human audited. <a href="/site/">View the 100-app case study</a></p>
<form id="f"><input id="name" placeholder="App name, e.g. Calendly" required> <input id="hint" placeholder="Hint (domain), optional"> <input id="cat" placeholder="Category, optional"> <label><input type="checkbox" id="add"> Add to the case-study list</label> <button>Research</button></form>
<h3>Live trace</h3><div id="log"></div><h3>Result</h3><div id="out"></div>
<script>
document.getElementById("f").onsubmit=e=>{e.preventDefault();const log=document.getElementById("log"),out=document.getElementById("out");log.textContent="";out.innerHTML="";
const nm=document.getElementById("name").value,ht=document.getElementById("hint").value,ct=document.getElementById("cat").value,ad=document.getElementById("add").checked?"1":"";const es=new EventSource("/api/research?name="+encodeURIComponent(nm)+"&hint="+encodeURIComponent(ht)+"&category="+encodeURIComponent(ct)+"&add="+ad);
es.onmessage=m=>{const d=JSON.parse(m.data);if(d.type==="done"){es.close();const r=d.record;
out.innerHTML="<p><b>"+r.name+"</b>: <b>"+r.verdict+"</b> ("+r.confidence+" confidence)<br>auth: "+r.auth.methods.join(", ")+" · dev: "+r.access.dev_access+" · prod: "+r.access.production_access+" · MCP: "+r.mcp.status+"</p><p>"+(r.blocker||"")+"</p><pre>"+JSON.stringify({checks:d.checks,critic:d.critic,record:r},null,1).replace(/</g,"&lt;")+"</pre>";}
else log.textContent+=d.detail+"\\n";};es.onerror=()=>{log.textContent+="(connection closed)\\n";es.close()};};
</script></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page.replace('<a href="/site/">View the 100-app case study</a>', '<a href="/site/">View the 100-app case study</a> · <a href="/experiment">Accuracy experiments (change prompt / rubric / rules / model)</a>')); }
  // ---- accuracy experiments ----
  if (url.pathname === "/experiment") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(readFileSync("src/ui/experiment.html")); }
  if (url.pathname === "/api/prompts") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(readdirSync("prompts").filter((f) => f.endsWith(".md")).map((f) => "prompts/" + f))); }
  if (url.pathname === "/api/prompt") {
    const p = url.searchParams.get("path") ?? "";
    if (!/^prompts\/[\w.-]+\.md$/.test(p) || !existsSync(p)) { res.writeHead(400); return res.end("bad path"); }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); return res.end(readFileSync(p));
  }
  if (url.pathname === "/api/compare") { const { compareRows } = await import("./experiment.js"); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(compareRows())); }
  if (url.pathname === "/api/experiment" && req.method === "POST") {
    let raw = ""; for await (const ch of req) raw += ch;
    let b: any; try { b = JSON.parse(raw); } catch { res.writeHead(400); return res.end("bad json"); }
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(b.name ?? "") || b.name === "baseline-v1" || String(b.name).startsWith("pilot")) { res.writeHead(400); return res.end("invalid or protected experiment name"); }
    if (!/^prompts\/[\w.-]+\.md$/.test(b.prompt ?? "") || (b.critic_prompt && !/^prompts\/[\w.-]+\.md$/.test(b.critic_prompt))) { res.writeHead(400); return res.end("bad prompt path"); }
    let prompt = b.prompt;
    if (typeof b.prompt_text === "string" && b.prompt_text.trim()) { prompt = `prompts/exp-${b.name}.md`; writeFileSync(prompt, b.prompt_text); }
    const cfg = { name: b.name, description: "created from the local experiment panel", engine: b.engine === "claude" ? "claude" : "openrouter", model: String(b.model || "openai/gpt-4o").slice(0, 100),
      prompt, critic_prompt: b.critic_prompt || undefined, rules: Array.isArray(b.rules) ? b.rules.filter((r: string) => /^R[0-6]$/.test(r)) : undefined, scope: b.scope === "all" ? "all" : "audited", concurrency: 3 };
    mkdirSync("experiments", { recursive: true });
    const cfgPath = `experiments/${b.name}.json`;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" });
    res.write(`config saved: ${cfgPath}\n`);
    const child = spawn("npx", ["tsx", "src/cli.ts", "experiment", "--config", cfgPath], { shell: true }); // name validated above
    child.stdout.on("data", (d) => res.write(d)); child.stderr.on("data", (d) => res.write(d));
    child.on("close", (code) => res.end(`\nexperiment process exited (${code}). Results in runs/${b.name}/\n`));
    return;
  }
  if (url.pathname.startsWith("/site/")) {
    const f = "site/" + (url.pathname.slice(6) || "index.html");
    if (!f.includes("..") && existsSync(f)) { res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html; charset=utf-8" : f.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8" }); return res.end(readFileSync(f)); }
  }
  if (url.pathname === "/api/research") {
    const name = (url.searchParams.get("name") ?? "").slice(0, 80).trim(), hint = (url.searchParams.get("hint") ?? "").slice(0, 120).trim();
    if (!name) { res.writeHead(400); return res.end("name required"); }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ type: "text", detail: `researching ${name}…` });
    const category = (url.searchParams.get("category") ?? "").slice(0, 60).trim();
    const { record } = await researchApp({ name, hint, category }, { runId: "adhoc-ui", onEvent: (e) => send({ type: "tool", detail: "→ " + e.detail.slice(0, 160) }) });
    send({ type: "text", detail: `research ${record.status} in ${record.stats.seconds}s; running checks…` });
    const flags = ruleChecks(record), q = record.status === "ok" ? await quoteChecks(record) : { flags: [], results: [] };
    send({ type: "text", detail: "running critic…" });
    const c = record.status === "ok" ? await critique(record) : { out: null };
    mkdirSync("runs/adhoc-ui", { recursive: true });
    appendFileSync("runs/adhoc-ui/records.jsonl", JSON.stringify({ ...record, checks: { flags: [...flags, ...q.flags], quotes: q.results }, critic: c.out }) + "\n");
    const checks = { flags: [...flags, ...q.flags], quotes_found: `${q.results.filter((x) => x.result !== "not_found" && x.result !== "fetch_failed").length}/${q.results.length}` };
    if (url.searchParams.get("add") === "1" && record.status === "ok") {
      const added = await verifyAndAdd(record, { ...checks, critic: c.out });
      render("baseline-v1");
      send({ type: "text", detail: `added to the case-study list as #${added.id} and rebuilt the page (open /site/). Commit + push to publish.` });
    }
    send({ type: "done", record, checks, critic: c.out });
    return res.end();
  }
  res.writeHead(404); res.end("not found");
}).listen(PORT, "127.0.0.1", () => console.log(`Research UI: http://127.0.0.1:${PORT}`));
