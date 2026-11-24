// A ~30-second animated replay of ONE app going through the whole pipeline, built only from saved run data
// (trace.jsonl, baseline/final records, verify/checks.json, verify/critic.json, corrections.jsonl).
// Every value shown is real; the R0–R6 results are recomputed with the same code the loop used.
//   site/replay/<slug>.html   (self-contained; plays on load, "Replay" restarts; ?rec=1 hides controls for recording)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import type { AppRecord } from "./schema.js";
import { latestById } from "./verify/run.js";
import { ruleChecks, expectedVerdict } from "./verify/checks.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const readJsonl = (p: string) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const readJson = (p: string, d: any = null) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d;
const host = (u: string) => { try { return new URL(u.startsWith("http") ? u : "https://" + u).host.replace(/^www\./, ""); } catch { return ""; } };
const root = (h: string) => h.split(".").slice(-2).join(".");
const VL: Record<string, string> = { build_now: "Build now", build_with_conditions: "Build with conditions", outreach_required: "Outreach required", limited: "Limited", needs_research: "Needs research" };
const short = (s: string, n = 150) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function writeReplay(runId: string, appName: string): string | null {
  const dir = `runs/${runId}`;
  const base = [...latestById(readJsonl(`${dir}/baseline.jsonl`)).values()].find((r) => r.name.toLowerCase() === appName.toLowerCase());
  if (!base) return null;
  const fin = latestById(readJsonl(`${dir}/final.jsonl`)).get(base.id) ?? base;
  const trace = readJsonl(`${dir}/trace.jsonl`).filter((t: any) => t.id === base.id).pop()?.toolLog ?? [];
  const ck = readJson(`${dir}/verify/checks.json`, {})[base.id] ?? {};
  const cr = readJson(`${dir}/verify/critic.json`, {})[base.id] ?? {};
  const corr = readJsonl(`${dir}/corrections.jsonl`).filter((c: any) => c.app_id === base.id);
  const r: AppRecord = base;
  const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  // ---- recompute L1 exactly as the loop did, and explain each rule with this record's real values ----
  const l1 = ruleChecks(r);
  const hit = (re: RegExp) => l1.find((f) => re.test(f.msg));
  const claimsBy = (f: string) => r.claims.filter((c) => c.field === f).length;
  const exp = expectedVerdict(r);
  const mh = r.mcp.url ? host(r.mcp.url) : "";
  const vend = [host(r.identity.website), host(r.identity.docs_url)].map(root).filter(Boolean);
  const rules = [
    { id: "R0", name: "Research completed", val: `status: ${r.status}`, f: hit(/research failed/) },
    { id: "R1", name: "Verdict follows access", val: `dev ${r.access.dev_access} + prod ${r.access.production_access} → expect ${exp ?? "no expectation"} · agent: ${r.verdict}`, f: hit(/verdict .* but access/) },
    { id: "R2", name: "Every field has evidence", val: `claims · auth ${claimsBy("auth")} · access ${claimsBy("access")} · api ${claimsBy("api")} · mcp ${claimsBy("mcp")}`, f: hit(/no evidence claim|no mcp evidence/) },
    { id: "R3", name: "Official MCP on vendor domain", val: r.mcp.status === "official" && mh ? `${mh} → root ${root(mh)} · vendor ${[...new Set(vend)].join(", ")}` : `MCP ${r.mcp.status}: rule not applicable`, f: hit(/official MCP url/) },
    { id: "R4", name: "API needs an auth method", val: `${r.auth.methods.length} method(s): ${r.auth.methods.join(", ") || "none"}`, f: hit(/no auth methods/) },
    { id: "R5", name: "Breadth matches resources", val: `${r.api.breadth} · ${r.api.resource_families.length} resource families (broad needs ≥5)`, f: hit(/breadth .* resource/) },
    { id: "R6", name: "Confidence matches evidence", val: `${r.confidence} confidence · ${r.claims.length} claims (high needs ≥3)`, f: hit(/high confidence/) },
  ];
  const quotes: any[] = ck.quotes ?? [];
  const qOk = quotes.filter((q) => q.result === "verbatim" || q.result === "near").length;
  const l4flags = (ck.flags ?? []).filter((f: any) => f.layer === "L4");
  const critFields = ["auth", "access", "api", "mcp", "verdict"].filter((f) => cr[f]);
  const critFlags = critFields.filter((f) => ["contradicted", "suspect"].includes(cr[f].status));
  const allFlags = (ck.flags ?? []).length + critFlags.length;
  const s = r.stats ?? ({} as any);

  // ---- scenes: [step key, seconds, html] ----
  const it = (html: string, i: number, cls = "") => `<div class="it ${cls}" style="--d:${(0.25 + i * 0.55).toFixed(2)}s">${html}</div>`;
  const ok = (b: boolean) => (b ? `<span class="ok">✓</span>` : `<span class="bad">✗</span>`);
  const scenes: [string, number, string][] = [
    ["input", 2.4, `<h2>New app</h2>${it(`<div class="field"><span class="lbl">App name</span><span class="type" style="--n:${r.name.length}">${esc(r.name)}</span></div>`, 0)}${it(`<div class="field"><span class="lbl">Hint domain</span><span>${esc((r as any).hint ?? r.identity.website)}</span></div>`, 1)}${it(`<button class="run">Research</button>`, 2)}`],
    ["agent", 4.4, `<h2>Research agent <small>Claude Sonnet · Composio tools</small></h2>${trace.slice(0, 6).map((t: any, i: number) => it(`<div class="tool"><code>${esc(t.tool)}</code> ${esc(short(t.input, 95))}<span class="m">${t.ok ? "✓" : "✗"} ${t.chars ? (t.chars / 1000).toFixed(1) + "k chars" : ""} · ${t.ms ?? "?"} ms · cached</span></div>`, i)).join("")}${it(`<div class="stats">${s.searches ?? 0} searches · ${s.fetches ?? 0} fetches · ${s.turns ?? "?"} turns · ${s.seconds ?? "?"} s · $${s.notional_usd ?? "?"}</div>`, Math.min(trace.length, 6))}`],
    ["first", 3.2, `<h2>First pass record <small>baseline.jsonl · frozen</small></h2><div class="rec">${[
      ["auth", r.auth.methods.join(" + ")], ["dev / prod access", `${r.access.dev_access} / ${r.access.production_access}`], ["API", `${r.api.types.filter((t) => t !== "other").join(", ")} · ${r.api.breadth} · ${r.api.resource_families.length} families`],
      ["MCP", `${r.mcp.status}${r.mcp.url ? " · " + host(r.mcp.url) : ""}`], ["verdict", VL[r.verdict] ?? r.verdict], ["evidence", `${r.claims.length} claims (URL + verbatim quote) · confidence ${r.confidence}`],
    ].map(([k, v], i) => it(`<span class="k">${k}</span><span class="v">${esc(v)}</span>`, i, "row")).join("")}</div>`],
    ["L1", 6.0, `<h2>L1 rule checks <small>code, no AI</small></h2>${rules.map((x, i) => `<div class="it rule" style="--d:${(0.2 + i * 0.7).toFixed(2)}s"><span class="rid">${x.id}</span><span class="rn">${x.name}</span><span class="rv">${esc(x.val)}</span>${ok(!x.f)}</div>`).join("")}${it(`<div class="sum">${l1.length ? `${l1.length} flag(s): ${l1.map((f) => esc(f.msg)).join("; ")}` : "All 7 rules pass · 0 flags"}</div>`, 8.5)}`],
    ["L2", 3.4, `<h2>L2 quote check <small>is each quote on the page it cites?</small></h2>${quotes.slice(0, 7).map((q, i) => it(`<span class="qf">${esc(q.field)}</span><span class="qu">${esc(q.url.replace(/^https?:\/\//, ""))}</span><span class="${q.result === "verbatim" || q.result === "near" ? "ok" : "bad"}">${esc(q.result)}</span>`, i * 0.7, "row q")).join("")}${it(`<div class="sum">${qOk}/${quotes.length} quotes found on their cited pages</div>`, 5)}`],
    ["L3", 3.4, `<h2>L3 critic <small>fresh Sonnet, no tools, looks for mistakes</small></h2>${critFields.map((f, i) => it(`<span class="qf">${f}</span><span class="st st-${esc(cr[f].status)}">${esc(cr[f].status)}</span><span class="why">${esc(short(cr[f].reason, 120))}</span>`, i, "row c")).join("")}`],
    ["L4", 2.8, `<h2>L4 Composio catalog <small>Composio's auth ⊆ ours?</small></h2>${ck.composio ? `${it(`<div class="cat"><div><span class="lbl">Composio toolkit</span><b>${esc(ck.composio.slug)}</b> · ${ck.composio.tools_count ?? "?"} tools</div><div><span class="lbl">Composio schemes</span>${esc((ck.composio.auth_schemes ?? []).join(", "))}</div><div><span class="lbl">Our record</span>${esc(r.auth.methods.join(", "))}</div></div>`, 0)}${it(`<div class="sum">${l4flags.length ? `${ok(false)} ${esc(l4flags[0].msg)}` : `${ok(true)} every Composio scheme is in our record`}</div>`, 2)}` : it(`<div class="sum">Not in Composio's catalog yet: nothing to compare (a new-toolkit opportunity)</div>`, 0)}`],
    ["gate", 2.2, `<h2>Any flags?</h2>${it(`<div class="big">${allFlags} flag${allFlags === 1 ? "" : "s"}</div>`, 0)}${it(`<div class="sum">${allFlags ? `→ L5 re-research of: ${[...new Set([...(ck.flags ?? []).map((f: any) => f.field), ...critFlags])].join(", ")}` : "→ L5 not needed: the first pass becomes the final record unchanged"}</div>`, 1)}`],
    ...(corr.length ? [["L5", 3.6, `<h2>L5 targeted re-research</h2>${corr.slice(0, 5).map((c: any, i: number) => it(`<span class="qf">${esc(c.field)}</span><span>${esc(short(String(c.before), 50))} → <b>${esc(short(String(c.after), 50))}</b></span><span class="m">${esc(c.triggered_by.join(", "))}</span>`, i, "row")).join("")}`] as [string, number, string]] : []),
    ["final", 3.4, `<h2>Final result</h2>${it(`<div class="verdict v-${esc(fin.verdict)}">${esc(VL[fin.verdict] ?? fin.verdict)}</div>`, 0)}${it(`<p class="summ">${esc(short(fin.summary, 200))}</p>`, 1)}${it(`<div class="sum">auth ${esc(fin.auth.methods.join(" + "))} · ${esc(fin.access.dev_access)} dev access · ${esc(fin.mcp.status)} MCP · ${fin.claims.length} quoted sources${corr.length ? ` · ${corr.length} field(s) corrected by the loop` : " · unchanged by the loop"}</div>`, 2)}`],
  ];
  const steps = [["input", "New app"], ["agent", "Research agent"], ["first", "First pass"], ["L1", "L1 rules"], ["L2", "L2 quotes"], ["L3", "L3 critic"], ["L4", "L4 catalog"], ["gate", "Any flags?"], ["L5", "L5 re-research"], ["final", "Final"]];
  const total = scenes.reduce((a, x) => a + x[1], 0);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.name)} Pipeline Replay</title>
<meta name="description" content="A 30-second replay of ${esc(r.name)} going through research, the frozen first pass, L1–L5 checks and the final verdict, built from saved run data.">
<style>
:root{--bg:#fbfaf8;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#e6e3de;--accent:#4b3fd1;--good:#1f8a4c;--warn:#b26b00;--bad:#c23b3b;--chip:#f1efeb;--code:#0F6E56}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121214;--fg:#ececef;--muted:#9a9aa2;--card:#1b1b1f;--line:#2c2c32;--accent:#a49bff;--good:#4cc27e;--warn:#e0a443;--bad:#ef6b6b;--chip:#25252b;--code:#5DCAA5}}
:root[data-theme=dark]{--bg:#121214;--fg:#ececef;--muted:#9a9aa2;--card:#1b1b1f;--line:#2c2c32;--accent:#a49bff;--good:#4cc27e;--warn:#e0a443;--bad:#ef6b6b;--chip:#25252b;--code:#5DCAA5}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:20px 16px;display:grid;grid-template-columns:200px 1fr;gap:18px;min-height:100vh;align-content:start}
header{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}header h1{font-size:20px;margin:0}header .sub{color:var(--muted);font-size:13px}
.ctl{display:flex;gap:8px}.ctl button,.ctl a{font:inherit;font-size:13px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);cursor:pointer;text-decoration:none}
ol.steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}ol.steps li{padding:7px 10px;border-radius:8px;border:1.5px solid var(--line);font-size:13px;color:var(--muted);transition:all .3s}
ol.steps li.done{color:var(--fg);border-color:color-mix(in srgb,var(--good) 50%,var(--line))}ol.steps li.done::after{content:" ✓";color:var(--good)}ol.steps li.now{color:var(--fg);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--card))}ol.steps li.skip{opacity:.45;text-decoration:line-through}
.stage{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;min-height:470px;position:relative;overflow:hidden}
.stage h2{font-size:22px;margin:0 0 14px}.stage h2 small{font-size:13px;color:var(--muted);font-weight:400;margin-left:8px}
section{display:none}section.on{display:block}
.it{opacity:0;transform:translateY(8px)}section.on .it{animation:in .45s ease forwards;animation-delay:var(--d)}@keyframes in{to{opacity:1;transform:none}}
.field{display:flex;gap:12px;align-items:center;margin:8px 0;font-size:17px}.lbl{font-size:12px;color:var(--muted);min-width:110px;display:inline-block}
.type{display:inline-block;overflow:hidden;white-space:nowrap;border-right:2px solid var(--accent);width:0}section.on .type{animation:type 1s steps(var(--n)) .3s forwards}@keyframes type{to{width:calc(var(--n) * 1ch + 2px)}}
.run{font:inherit;padding:8px 16px;border-radius:8px;border:0;background:var(--accent);color:#fff;margin-top:8px}
.tool{font-size:13.5px;padding:8px 10px;border-radius:8px;background:var(--chip);margin:6px 0;display:flex;flex-wrap:wrap;gap:4px 10px}.tool code{color:var(--accent);font-weight:600}.m{color:var(--muted);font-size:12px;margin-left:auto}
.stats,.sum{margin-top:12px;font-size:14px;padding:8px 12px;border-left:4px solid var(--good);background:color-mix(in srgb,var(--good) 8%,transparent);border-radius:0 8px 8px 0}
.rec{display:flex;flex-direction:column;gap:6px}.row{display:grid;grid-template-columns:150px 1fr auto;gap:12px;align-items:baseline;padding:7px 10px;border-radius:8px;background:var(--chip);font-size:14px}.k,.qf{color:var(--muted);font-size:12.5px}
.rule{display:grid;grid-template-columns:34px 210px 1fr 24px;gap:10px;align-items:center;padding:7px 10px;margin:5px 0;border:1.5px solid var(--code);border-radius:8px;font-size:13.5px}.rid{font-weight:700;color:var(--code)}.rv{color:var(--muted);font-size:12.5px}
.ok{color:var(--good);font-weight:700}.bad{color:var(--bad);font-weight:700}
.q{grid-template-columns:70px 1fr auto;margin:5px 0}.qu{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.c{grid-template-columns:70px 110px 1fr;margin:5px 0}.why{font-size:12.5px;color:var(--muted)}.st{font-weight:600}.st-supported{color:var(--good)}.st-suspect,.st-insufficient{color:var(--warn)}.st-contradicted{color:var(--bad)}
.cat{display:flex;flex-direction:column;gap:8px;font-size:15px}.big{font-size:56px;font-weight:700;letter-spacing:-.02em}
.verdict{display:inline-block;font-size:30px;font-weight:700;padding:8px 18px;border-radius:12px}.v-build_now{background:color-mix(in srgb,var(--good) 18%,transparent);color:var(--good)}.v-build_with_conditions{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}.v-outreach_required{background:color-mix(in srgb,var(--bad) 16%,transparent);color:var(--bad)}.v-limited,.v-needs_research{background:var(--chip)}
.summ{font-size:16px;max-width:760px}
.bar{position:absolute;left:0;bottom:0;height:4px;background:var(--accent);width:0}
.foot{grid-column:1/-1;color:var(--muted);font-size:12px}
body.rec .ctl{display:none}body.rec .wrap{zoom:1.32;min-height:0;padding-top:14px}body.rec .stage{min-height:400px}
@media (max-width:760px){.wrap{grid-template-columns:1fr}ol.steps{flex-direction:row;flex-wrap:wrap}.rule{grid-template-columns:30px 1fr 24px}.rv{grid-column:2/3}.row,.c{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.it,section.on .it{animation:none;opacity:1;transform:none}section.on .type{animation:none;width:auto}}
</style></head><body>
<div class="wrap">
<header><div><h1>${esc(r.name)}: from search to verdict</h1><div class="sub">Replayed from saved run data (run <code>${esc(runId)}</code>). Every value is real. ~${Math.round(total)} s.</div></div>
<div class="ctl"><button id="pp">Pause</button><button id="again">Replay</button><a href="../index.html#flow">Back to the page</a></div></header>
<ol class="steps">${steps.map(([k, t]) => `<li data-k="${k}"${k === "L5" && !corr.length ? ' class="skip"' : ""}>${t}</li>`).join("")}</ol>
<div class="stage">${scenes.map(([k], i) => `<section data-k="${k}" data-i="${i}">${scenes[i][2]}</section>`).join("")}<div class="bar" id="bar"></div></div>
<div class="foot">Sources: runs/${esc(runId)}/trace.jsonl, baseline.jsonl, final.jsonl, verify/checks.json, verify/critic.json, corrections.jsonl. L1 is recomputed with <code>ruleChecks()</code>.</div>
</div>
<script>
(function(){const D=${JSON.stringify(scenes.map(([k, sec]) => [k, sec]))},T=${total.toFixed(2)};
const secs=[...document.querySelectorAll("section")],lis=[...document.querySelectorAll("ol.steps li")],bar=document.getElementById("bar");
if(/[?&]rec=1/.test(location.search))document.body.classList.add("rec");
let t0=0,paused=false,pauseAt=0,idx=-1,raf=0;
function show(i){idx=i;secs.forEach((s,j)=>{s.classList.toggle("on",j===i)});const k=D[i][0],order=lis.map(l=>l.dataset.k),pos=order.indexOf(k);
lis.forEach((l,j)=>{if(l.classList.contains("skip"))return;l.classList.toggle("now",j===pos);l.classList.toggle("done",j<pos||(k==="final"&&j===pos))});}
function tick(now){if(paused)return;const t=(now-t0)/1000;let acc=0,i=0;for(;i<D.length;i++){acc+=D[i][1];if(t<acc)break}
if(i>=D.length){i=D.length-1;bar.style.width="100%";show(i);document.body.dataset.done="1";return}
if(i!==idx)show(i);bar.style.width=Math.min(100,100*t/T)+"%";raf=requestAnimationFrame(tick)}
function start(){cancelAnimationFrame(raf);delete document.body.dataset.done;paused=false;document.getElementById("pp").textContent="Pause";idx=-1;secs.forEach(s=>s.classList.remove("on"));
requestAnimationFrame(n=>{t0=n;raf=requestAnimationFrame(tick)})}
document.getElementById("again").onclick=start;
document.getElementById("pp").onclick=function(){if(document.body.dataset.done)return start();if(!paused){paused=true;pauseAt=performance.now();this.textContent="Play";document.querySelectorAll("section.on .it,section.on .type").forEach(e=>e.style.animationPlayState="paused")}
else{paused=false;t0+=performance.now()-pauseAt;this.textContent="Pause";document.querySelectorAll("section.on .it,section.on .type").forEach(e=>e.style.animationPlayState="");raf=requestAnimationFrame(tick)}};
start();})();
</script></body></html>`;
  mkdirSync("site/replay", { recursive: true });
  const out = `site/replay/${slug}.html`;
  writeFileSync(out, html);
  return `replay/${slug}.html`;
}
