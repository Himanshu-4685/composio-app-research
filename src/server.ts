// npm run ui -> http://127.0.0.1:8787
// Local page with a "Research any app" box. Same researchApp() as the batch, plus L1 + L2 + critic checks.
// Binds to localhost only; keys come from your own .env / Claude Code login.
import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
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
  if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page); }
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
