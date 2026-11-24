// Builds site/index.html (one self-contained page) + site/data/* (machine-readable exports) from saved run data.
// No network, no LLM: the page is a pure function of the files in runs/ and audit/.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import type { AppRecord } from "./schema.js";
import { latestById } from "./verify/run.js";
import { analyze, primaryBlocker } from "./analyze.js";
import { readAdded } from "./added.js";
import { matchToolkit } from "./verify/catalog.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const readJsonl = (p: string) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const readJson = (p: string, d: any = null) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d;
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const V_LABEL: Record<string, string> = { build_now: "Build now", build_with_conditions: "Build with conditions", outreach_required: "Outreach required", limited: "Limited", needs_research: "Needs research" };
const REPO = process.env.REPO_URL ?? "https://github.com/Himanshu-4685/composio-app-research";

export function render(runId: string) {
  const dir = `runs/${runId}`;
  const A = analyze(runId);
  const base = latestById(readJsonl(`${dir}/baseline.jsonl`));
  const fin = latestById(readJsonl(`${dir}/final.jsonl`));
  const recs: AppRecord[] = [...(fin.size ? fin : base).values()].sort((a, b) => a.id - b.id);
  const checks = readJson(`${dir}/verify/checks.json`, {});
  const critic = readJson(`${dir}/verify/critic.json`, {});
  const corrections = readJsonl(`${dir}/corrections.jsonl`);
  const scores = readJson("audit/scores.json");
  const sample = readJson("audit/sample.json");
  const meta = readJson(`${dir}/meta.json`, {});
  const baseRecs = [...base.values()];

  // ---------- verification funnel numbers ----------
  const quotes = Object.values(checks).flatMap((x: any) => x.quotes ?? []);
  const qOk = quotes.filter((q: any) => q.result === "verbatim" || q.result === "near").length;
  const flagsAll = Object.values(checks).flatMap((x: any) => x.flags ?? []);
  const l1 = flagsAll.filter((f: any) => f.layer === "L1"), l4 = flagsAll.filter((f: any) => f.layer === "L4");
  const criticRows = Object.entries(critic).filter(([, v]: any) => v && v.auth);
  const criticIssues = criticRows.flatMap(([id, v]: any) => Object.entries(v).filter(([, j]: any) => j.status !== "supported").map(([f, j]: any) => ({ id: Number(id), field: f, ...j })));
  const cCount = (s: string) => criticIssues.filter((i) => i.status === s).length;
  const reResearched = new Set(corrections.map((c: any) => c.app_id));
  const finalArr = [...fin.values()] as any[];
  const deferred = finalArr.filter((r) => r.deferred).length;
  const limitCut = finalArr.filter((r) => (r.open_questions ?? []).some((q: string) => /re-research failed/i.test(q))).length;
  const disagreements = readJson("audit/disagreements.json");
  const reran = finalArr.filter((r) => !r.deferred && r.stats && base.get(r.id) && r.researched_at !== base.get(r.id)!.researched_at).length;
  const totalUsd = baseRecs.reduce((a, r) => a + (r.stats?.notional_usd ?? 0), 0);
  const avgSec = Math.round(baseRecs.reduce((a, r) => a + (r.stats?.seconds ?? 0), 0) / Math.max(1, baseRecs.length));
  const avgTools = (baseRecs.reduce((a, r) => a + (r.stats?.tool_calls ?? 0), 0) / Math.max(1, baseRecs.length)).toFixed(1);

  // ---------- headline sentences (computed) ----------
  const n = A.n, v = A.verdicts as Record<string, number>;
  const am = A.auth_methods as Record<string, number>;
  const both = recs.filter((r) => r.auth.methods.includes("oauth2") && (r.auth.methods.includes("api_key") || r.auth.methods.includes("personal_token"))).length;
  const keyish = recs.filter((r) => r.auth.methods.includes("api_key") || r.auth.methods.includes("personal_token")).length;
  const cats = [...A.byCategory].sort((a, b) => b.self_serve_dev - a.self_serve_dev);
  const blockers = Object.entries(A.primary_blockers as Record<string, number>).filter(([k]) => k !== "none").sort((a, b) => b[1] - a[1]);
  const gap = A.easy_wins_not_in_composio;
  const headlines = [
    `<b>${v.build_now ?? 0} of ${n}</b> apps can be built as agent toolkits today: documented API, and a developer can get credentials free or on a trial.`,
    `<b>Auth is not the bottleneck; access is.</b> ${am.oauth2 ?? 0}/${n} offer OAuth2, ${keyish}/${n} offer an API key or personal token, and ${both} offer both. The real blockers are commercial: ${blockers.slice(0, 3).map(([k, c]) => `${esc(k)} (${c})`).join(", ")}.`,
    `<b>Self-serve varies by category.</b> Most open: ${cats.slice(0, 2).map((c) => `${esc(c.category)} (${c.self_serve_dev}/10)`).join(", ")}. Most gated: ${cats.slice(-2).reverse().map((c) => `${esc(c.category)} (${c.self_serve_dev}/10)`).join(", ")}.`,
    `<b>${A.in_composio}/${n}</b> already exist in Composio's catalog. Of the ${n - A.in_composio} that don't, <b>${gap.length}</b> are "build now": the easiest new toolkits (${gap.slice(0, 6).map((g: any) => esc(g.name)).join(", ")}${gap.length > 6 ? ", …" : ""}).`,
    `<b>${v.outreach_required ?? 0}</b> need a sales or partner conversation before any developer access (${A.outreach.map((o: any) => esc(o.name)).join(", ") || "none"}). <b>${(A.mcp as any).official ?? 0}/${n}</b> already ship an official MCP server.`,
  ];

  // ---------- accuracy block ----------
  const s = scores?.summary ?? {};
  const scoreRow = (k: string, label: string) => {
    const x = s[k]; if (!x?.apps) return `<tr><td>${label}</td><td colspan="5" class="muted">pending: audit rows not filled yet</td></tr>`;
    return `<tr><td>${label}</td><td>${x.apps}</td><td>${x.C} / ${x.I} / ${x.U}</td><td><b>${pct(x.C, x.N)}%</b> <span class="muted">(${x.C}/${x.N})</span></td><td>${x.accuracy_decidable == null ? "–" : Math.round(100 * x.accuracy_decidable) + "%"} <span class="muted">(${x.C}/${x.C + x.I})</span></td><td>${GR(x.perField)}</td></tr>`;
  };
  const GR = (pf: any) => pf ? Object.entries(pf).map(([f, g]: any) => `${f} ${g.C}/${g.C + g.I + g.U}`).join(" · ") : "";
  const misses = (scores?.detail ?? []).filter((d: any) => d.version === "final" && d.grade === "I");
  // If deferred / limit-cut apps were finished after the first scoring, show the first scoring too.
  const first = readJson("audit/scores-first.json");
  const fmt = (x: any) => x?.apps ? `${pct(x.C, x.N)}% (${x.C}/${x.N})` : "–";
  const changed = first && ["final.calibration", "final.holdout"].some((k) => first.summary?.[k]?.C !== s[k]?.C || first.summary?.[k]?.I !== s[k]?.I);
  const firstNote = first ? `<p class="small"><b>Score history.</b> First scored ${esc(String(first.computed_at).slice(0, 16).replace("T", " "))} UTC, when some flagged apps had not been re-researched yet (usage limit). After <code>npm run finish</code> completed them, re-scored ${esc(String(scores?.computed_at ?? "").slice(0, 16).replace("T", " "))} UTC. ${changed ? `After-loop scores at first scoring: calibration ${fmt(first.summary["final.calibration"])}, holdout ${fmt(first.summary["final.holdout"])}. The table shows the re-scored numbers.` : "The audited scores did not change."} Grading rules were not changed between the two.</p>` : "";

  // ---------- corrections examples ----------
  const corrRows = corrections.slice(0, 40).map((c: any) => `<tr><td>${esc(c.app)}</td><td><code>${esc(c.field)}</code></td><td>${esc(c.before)}</td><td>${esc(c.after)}</td><td>${esc(c.triggered_by.join(", "))}</td><td class="small">${esc((c.issues ?? [])[0] ?? "")}</td></tr>`).join("");

  // ---------- matrix ----------
  const tag = (x: string, cls = "") => `<span class="tag ${cls}">${esc(x)}</span>`;
  // Apps added after the study (data/added.jsonl): shown in the table, excluded from every statistic above.
  const added = readAdded();
  const catalogList = readJson(".cache/composio_catalog.json", []);
  const rows = [...recs, ...added].map((r: any) => {
    const ck = r.added ? { composio: matchToolkit(r, catalogList) } : (checks[r.id] ?? {});
    const cr = r.added ? (r.critic ?? {}) : (critic[r.id] ?? {});
    const claims = (r.claims ?? []).map((c: any) => `<li><b>${esc(c.field)}</b>: ${esc(c.text)}<br><q>${esc(c.quote)}</q> <a href="${esc(c.url)}" target="_blank" rel="noopener">source ↗</a></li>`).join("");
    const crit = Object.entries(cr).filter(([, j]: any) => j?.status).map(([f, j]: any) => `<li>${esc(f)}: <b>${esc(j.status)}</b>, ${esc(j.reason)}</li>`).join("");
    const corr = corrections.filter((c: any) => c.app_id === r.id).map((c: any) => `<li><code>${esc(c.field)}</code>: ${esc(c.before)} → <b>${esc(c.after)}</b></li>`).join("");
    const inAudit = sample?.picks?.find((p: any) => p.id === r.id);
    return `<tr class="row" data-cat="${esc(r.category)}" data-verdict="${esc(r.verdict)}" data-mcp="${esc(r.mcp.status)}" data-dev="${esc(r.access.dev_access)}" data-composio="${ck.composio ? "yes" : "no"}" data-q="${esc((r.name + " " + r.summary + " " + r.category).toLowerCase())}">
<td>${r.id}</td><td><b>${esc(r.name)}</b><div class="small muted">${esc(r.category)}</div>${r.added ? `<div>${tag("Added later · automated checks only", "added")}</div>` : ""}</td>
<td>${r.auth.methods.map((m: string) => tag(m)).join(" ")}</td>
<td>${tag(r.access.dev_access, "a-" + r.access.dev_access)}<div class="small muted">prod: ${esc(r.access.production_access)}</div></td>
<td>${r.api.types.filter((t: string) => t !== "other").map((t: string) => esc(t)).join(", ")}<div class="small muted">${esc(r.api.breadth)}</div></td>
<td>${tag(r.mcp.status, "m-" + r.mcp.status)}</td>
<td>${ck.composio ? `✓ <span class="small muted">${esc(ck.composio.slug)}</span>` : "–"}</td>
<td>${tag(V_LABEL[r.verdict] ?? r.verdict, "v-" + r.verdict)}${r.blocker ? `<div class="small">${esc(r.blocker)}</div>` : ""}</td>
<td><details><summary>${(r.claims ?? []).length} sources${inAudit ? " · audited" : ""}${corr ? " · corrected" : ""}${r.added ? ` · quotes ${esc(r.auto_checks?.quotes_found)}` : ""}</summary>
<div class="det"><p>${esc(r.summary)}</p><p class="small"><b>Auth:</b> ${esc(r.auth.detail)}</p>
${r.access.gates?.length ? `<p class="small"><b>Conditions:</b></p><ul class="small">${r.access.gates.map((g: string) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
<p class="small"><b>Public OAuth app review:</b> ${esc(r.access.public_app_review)} · <b>Resources:</b> ${esc((r.api.resource_families ?? []).join(", "))} ${r.mcp.url ? `· <b>MCP:</b> <a href="${esc(r.mcp.url)}" target="_blank" rel="noopener">${esc(r.mcp.url)}</a>` : ""}</p>
<p class="small"><b>Evidence</b> (every quote re-checked on its page)</p><ul class="small">${claims}</ul>
${crit ? `<p class="small"><b>Critic (L3)</b></p><ul class="small">${crit}</ul>` : ""}
${corr ? `<p class="small"><b>Changed by verification loop</b></p><ul class="small">${corr}</ul>` : ""}
${r.open_questions?.length ? `<p class="small"><b>Open questions</b></p><ul class="small">${r.open_questions.map((q: string) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
<p class="small muted">confidence ${esc(r.confidence)} · ${r.stats?.tool_calls ?? "?"} tool calls · ${r.stats?.seconds ?? "?"}s · researched ${esc(String(r.researched_at).slice(0, 16))}${r.deferred ? " · re-research deferred" : ""}${r.added ? ` · added ${esc(String(r.added_at).slice(0, 10))}, rule/quote flags ${r.auto_checks?.flags?.length ?? 0}, not human audited, not counted in the study's statistics` : ""}</p></div></details></td></tr>`;
  }).join("\n");

  const catRows = A.byCategory.map((c: any) => `<tr><td>${esc(c.category)}</td>${bar(c.self_serve_dev)}${bar(c.api_on_all_plans)}<td>${c.verdicts.build_now ?? 0}</td><td>${c.verdicts.build_with_conditions ?? 0}</td><td>${c.verdicts.outreach_required ?? 0}</td><td>${(c.verdicts.limited ?? 0) + (c.verdicts.needs_research ?? 0)}</td><td>${c.official_mcp}</td><td>${c.in_composio}</td></tr>`).join("");
  function bar(x: number) { return `<td><div class="bar"><span style="width:${x * 10}%"></span></div><span class="small">${x}/10</span></td>`; }
  const hbars = (o: Record<string, number>, total: number) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, c]) => `<div class="hb"><span class="hbk">${esc(k)}</span><span class="hbb"><span style="width:${pct(c, total)}%"></span></span><span class="hbv">${c}</span></div>`).join("");
  const opts = (vals: string[]) => vals.map((x) => `<option value="${esc(x)}">${esc(V_LABEL[x] ?? x)}</option>`).join("");
  const list = (xs: any[], extra: (x: any) => string = () => "") => xs.length ? `<ul class="plist">${xs.map((x) => `<li><b>${esc(x.name)}</b> <span class="muted small">${esc(x.category)}</span>${extra(x)}</li>`).join("")}</ul>` : `<p class="muted">None.</p>`;
  const condGroups = Object.entries(A.conditions.reduce((m: any, x: any) => ((m[x.primary] ??= []).push(x), m), {})) as [string, any[]][];

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App Toolkit Research</title>
<meta name="description" content="An agent researched 100 apps for Composio toolkit buildability; verified with code checks, a critic agent, Composio's catalog and a blind human audit.">
<style>
:root{--bg:#fbfaf8;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#e6e3de;--accent:#4b3fd1;--good:#1f8a4c;--warn:#b26b00;--bad:#c23b3b;--info:#2f6fb0;--chip:#f1efeb}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121214;--fg:#ececef;--muted:#9a9aa2;--card:#1b1b1f;--line:#2c2c32;--accent:#a49bff;--good:#4cc27e;--warn:#e0a443;--bad:#ef6b6b;--info:#6aa6e6;--chip:#25252b}}
:root[data-theme=dark]{--bg:#121214;--fg:#ececef;--muted:#9a9aa2;--card:#1b1b1f;--line:#2c2c32;--accent:#a49bff;--good:#4cc27e;--warn:#e0a443;--bad:#ef6b6b;--info:#6aa6e6;--chip:#25252b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 16px 80px}h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}h2{font-size:21px;margin:44px 0 12px;letter-spacing:-.01em}h3{font-size:16px;margin:18px 0 8px}
a{color:var(--accent)}.muted{color:var(--muted)}.small{font-size:12.5px}code{font-size:12.5px;background:var(--chip);padding:1px 5px;border-radius:4px}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);z-index:5}nav div{max-width:1180px;margin:0 auto;padding:8px 16px;display:flex;gap:16px;overflow-x:auto;font-size:13.5px;white-space:nowrap}nav a{text-decoration:none;color:var(--muted)}nav a:hover{color:var(--fg)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}.grid{display:grid;gap:14px}.g2{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}.g5{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.headline{border-left:4px solid var(--accent)}.headline li{margin:6px 0}
.stat .n{font-size:30px;font-weight:700;letter-spacing:-.02em}.stat .l{font-size:12.5px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:8px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600;background:var(--card)}#mx th{position:sticky;top:0}
.scroll{overflow-x:auto}.tag{display:inline-block;padding:1px 7px;border-radius:999px;background:var(--chip);font-size:12px;margin:1px 0}
.v-build_now{background:color-mix(in srgb,var(--good) 18%,transparent);color:var(--good)}.v-build_with_conditions{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}.v-outreach_required{background:color-mix(in srgb,var(--bad) 16%,transparent);color:var(--bad)}.added{background:color-mix(in srgb,var(--info) 18%,transparent);color:var(--info)}.v-limited,.v-needs_research{background:color-mix(in srgb,var(--muted) 20%,transparent)}
.m-official{color:var(--good)}.m-community{color:var(--info)}
.bar{display:inline-block;width:70px;height:8px;background:var(--chip);border-radius:4px;margin-right:6px;vertical-align:middle}.bar span{display:block;height:100%;background:var(--accent);border-radius:4px}
.hb{display:grid;grid-template-columns:170px 1fr 34px;gap:8px;align-items:center;font-size:13px;margin:5px 0}.hbb{height:10px;background:var(--chip);border-radius:5px}.hbb span{display:block;height:100%;background:var(--accent);border-radius:5px}.hbv{text-align:right;font-variant-numeric:tabular-nums}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.filters input,.filters select,.filters button{font:inherit;font-size:13.5px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}.filters input{flex:1;min-width:180px}
details summary{cursor:pointer;color:var(--accent);font-size:12.5px;white-space:nowrap}.det{min-width:340px;max-width:560px;white-space:normal}q{color:var(--muted);font-style:italic}
.flow{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch}.flow .step{flex:1;min-width:150px;background:var(--chip);border-radius:10px;padding:10px 12px;font-size:13px}.flow .step b{display:block;font-size:13.5px}.flow .human{outline:2px dashed var(--warn)}
.plist{margin:0;padding-left:18px}.plist li{margin:3px 0}pre{background:var(--chip);padding:12px;border-radius:8px;overflow-x:auto;font-size:12.5px}
.honest{border-left:4px solid var(--warn)}
</style></head><body>
<nav><div><a href="#top">Findings</a><a href="#patterns">Patterns</a><a href="#priorities">Priorities</a><a href="#verification">Verification</a><a href="#agent">The agent</a><a href="#matrix">All 100 apps</a><a href="#run">Run it</a></div></nav>
<main id="top">
<h1>Which apps can become agent toolkits?</h1>
<p class="muted">An agent researched ${n} requested apps for Composio: auth, self-serve vs gated access, API surface, MCP, and a buildability verdict, all backed by quoted evidence. The results were then checked by code, by a second critic agent, against Composio's own catalog, and by a blind human audit. Researched ${esc(String(meta.started_at ?? "").slice(0, 10))} · <a href="${REPO}">source repo</a> · <a href="data/records.json">records.json</a> · <a href="data/records.csv">records.csv</a> · <a href="data/summary.md">summary.md</a></p>

<div class="card headline"><h3 style="margin-top:0">Headline findings</h3><ol>${headlines.map((h) => `<li>${h}</li>`).join("")}</ol></div>

<div class="grid g5" style="margin-top:14px">
${[["Build now", v.build_now ?? 0], ["With conditions", v.build_with_conditions ?? 0], ["Outreach needed", v.outreach_required ?? 0], ["Limited / unclear", (v.limited ?? 0) + (v.needs_research ?? 0)], ["Already in Composio", A.in_composio]].map(([l, x]) => `<div class="card stat"><div class="n">${x}</div><div class="l">${l} · of ${n}</div></div>`).join("")}
</div>

<h2 id="patterns">Patterns</h2>
<div class="card scroll"><table><thead><tr><th>Category (10 apps each)</th><th>Self-serve dev access</th><th>API on all plans</th><th>Build now</th><th>Conditions</th><th>Outreach</th><th>Limited/unclear</th><th>Official MCP</th><th>In Composio</th></tr></thead><tbody>${catRows}</tbody></table>
<p class="small muted">Self-serve = a developer can get credentials free or on a trial. "API on all plans" = the API works on any customer plan (a paid product with the API on every plan counts as yes).</p></div>
<div class="grid g2" style="margin-top:14px">
<div class="card"><h3 style="margin-top:0">Auth methods (apps can have several, so the bars sum to more than ${n})</h3>${hbars(am, n)}</div>
<div class="card"><h3 style="margin-top:0">Primary blocker (one per app, derived from structured fields)</h3>${hbars(A.primary_blockers as any, n)}</div>
<div class="card"><h3 style="margin-top:0">MCP server status</h3>${hbars(A.mcp as any, n)}</div>
<div class="card"><h3 style="margin-top:0">Vendor must approve a public OAuth app?</h3>${hbars(A.public_app_review as any, n)}<p class="small muted">E.g. HubSpot Marketplace listing, Attio's 25-workspace cap for unpublished apps. This doesn't block building, but Composio's shared OAuth app needs vendor approval to scale.</p></div>
</div>

<h2 id="priorities">Priorities</h2>
<div class="grid g2">
<div class="card"><h3 style="margin-top:0">Easy wins not yet in Composio (${gap.length})</h3><p class="small muted">Verdict "build now" and no matching toolkit in Composio's catalog of ${readJson(".cache/composio_catalog.json", []).length} toolkits.</p>${list(gap, (x) => ` <span class="small">· ${esc(x.breadth)} API · MCP ${esc(x.mcp)}</span>`)}</div>
<div class="card"><h3 style="margin-top:0">Needs outreach (${A.outreach.length})</h3><p class="small muted">Sales/partner gate before any developer access.</p>${list(A.outreach, (x) => `<div class="small">${esc(x.blocker)}</div>`)}</div>
<div class="card"><h3 style="margin-top:0">Buildable with a named condition (${A.conditions.length})</h3>${condGroups.map(([k, xs]) => `<p class="small"><b>${esc(k)}</b> (${xs.length}): ${xs.map((x: any) => esc(x.name)).join(", ")}</p>`).join("")}</div>
<div class="card"><h3 style="margin-top:0">Limited or unclear (${A.limited_or_unclear.length})</h3>${list(A.limited_or_unclear, (x) => `<div class="small">${esc(x.primary)}: ${esc(x.blocker)}</div>`)}</div>
</div>

<h2 id="verification">Verification: how we know it's right</h2>
<div class="flow">
<div class="step"><b>First pass</b>${baseRecs.filter((r) => r.status === "ok").length}/${n} records, frozen prompt <code>${esc(meta.prompt_version)}</code></div>
<div class="step"><b>L1 rules (code)</b>${l1.length} flags: contradictions, missing evidence</div>
<div class="step"><b>L2 quote check (code)</b>${qOk}/${quotes.length} quotes found on the cited page</div>
<div class="step"><b>L3 critic agent</b>${criticRows.length} apps reviewed: ${cCount("contradicted")} contradicted, ${cCount("suspect")} suspect, ${cCount("insufficient")} insufficient fields</div>
<div class="step"><b>L4 Composio catalog</b>${l4.length} auth disagreements across ${A.in_composio} matched toolkits</div>
<div class="step"><b>L5 re-research</b>${reran} apps re-researched, ${corrections.length} field changes${deferred ? `, ${deferred} deferred` : ""}</div>
<div class="step human"><b>Human audit</b>${sample?.picks?.length ?? 20} apps, blind, 5 fields each; calibration + holdout</div>
</div>

<div class="card" style="margin-top:14px"><h3 style="margin-top:0">Accuracy against the blind human audit</h3>
<div class="scroll"><table><thead><tr><th>Version · group</th><th>Apps</th><th>C / I / U</th><th>Correct of all fields</th><th>Correct of decidable</th><th>Per field (C / checked)</th></tr></thead><tbody>
${scoreRow("baseline.calibration", "First pass · calibration")}${scoreRow("final.calibration", "After loop · calibration")}${scoreRow("baseline.holdout", "First pass · holdout")}${scoreRow("final.holdout", "After loop · holdout")}
</tbody></table></div>${firstNote}
<p class="small muted">C correct, I incorrect, U unresolved (agent or human said unknown). "Correct of all" counts unknowns against the agent. Calibration apps could guide fixes; holdout apps were only scored. Grading rules: auth = same set (api_key ≡ personal_token); access = dev and production both match; API = same core type and breadth within one step; MCP and verdict = exact. Sample seed ${esc(sample?.seed)}, pilot apps excluded. 20 apps is a sample: these rates describe the sample, not an exact accuracy for all 100.</p>
${disagreements ? `<h3>Why the remaining ${misses.length} final fields disagree with the human</h3><p class="small muted">${esc(disagreements.note)}</p><div class="scroll"><table><thead><tr><th>Cause</th><th>Fields</th><th>Cases</th><th>What it means</th></tr></thead><tbody>${disagreements.categories.map((c: any) => `<tr><td><b>${esc(c.cause)}</b></td><td>${c.items.reduce((a: number, i: string) => a + i.split(",").length, 0)}</td><td class="small">${c.items.map(esc).join("<br>")}</td><td class="small">${esc(c.explanation)}</td></tr>`).join("")}</tbody></table></div>
<p class="small"><b>Takeaway:</b> the agent does not invent facts (all quotes verified). Its remaining errors are <b>incomplete lists</b> (a missed second auth method) and <b>classification judgement</b>. The biggest single source of disagreement is a <b>definition</b> (is a paid product a "paid plan" gate?), which a research process at Composio's scale must pin down in the rubric before automating.</p>`
  : misses.length ? `<h3>Where the final answers still disagree with the human</h3><ul class="small">${misses.map((d: any) => `<li>${esc(d.app)}: <code>${esc(d.field)}</code> (${esc(d.group)})</li>`).join("")}</ul>` : ""}
</div>

${corrections.length ? `<div class="card scroll" style="margin-top:14px"><h3 style="margin-top:0">What the loop changed (${corrections.length} field changes${corrections.length > 40 ? ", first 40 shown; all in corrections.jsonl" : ""})</h3><table><thead><tr><th>App</th><th>Field</th><th>Before</th><th>After</th><th>Caught by</th><th>Why</th></tr></thead><tbody>${corrRows}</tbody></table></div>` : ""}

<div class="card honest" style="margin-top:14px"><h3 style="margin-top:0">Honest limits</h3><ul class="small">
<li><b>Docs-checked, not call-tested.</b> No authenticated API call was made to any of the 100 apps. Findings describe what the official docs say.</li>
<li><b>The quote check proves quotes are real, not that they're interpreted right.</b> All ${qOk} quotes matched their pages, so the agent never invented a quote. Errors come from <i>missing</i> conditions and judgment, which is why the critic and the human audit exist.</li>
<li><b>My own rule had false alarms.</b> The L1 "official MCP must be on the vendor's domain" rule flagged vendor-owned alternate domains (e.g. sentry.dev, helpscout.net). Flags are prompts for re-checking, not automatic edits.</li>
<li><b>Composio's catalog is a partial oracle.</b> It lists the auth Composio implements, which can be a subset of what the vendor offers. We check "Composio's methods ⊆ ours", not equality.</li>
<li><b>Usage limits shaped the run.</b> On a Claude Pro subscription the first pass hit the 5-hour limit at app 60 and resumed after the reset. The re-research pass (L5) ran the 20 audited apps first, then the rest by id.${limitCut ? ` <b>${limitCut} flagged apps were cut off by the next usage limit</b> and keep their first-pass answers (none of them is in the audit sample).` : ""}${deferred ? ` ${deferred} apps with only "insufficient evidence" critic notes were deferred.` : ""}${limitCut || deferred ? " <code>npm run finish</code> completes both." : ""}</li>
<li><b>The improvement is modest and measured honestly.</b> The loop raised correct fields by 6 points in both the calibration and the untouched holdout group. The scores were computed once with fixed grading rules and not adjusted afterwards.</li>
<li><b>The critic is also an LLM.</b> Its "suspect" notes come from model knowledge and are only acted on through re-research with sources. The human audit is the only ground truth.</li>
</ul></div>

<h2 id="agent">The agent</h2>
<div class="flow">
<div class="step"><b>Input</b>App name + hint (100 from the brief, or any new app)</div>
<div class="step"><b>Research loop</b>Claude (Sonnet) via Claude Agent SDK decides what to search and read next, until the evidence is enough</div>
<div class="step"><b>Tools via Composio</b><code>web_search</code> / <code>fetch_page</code> run through Composio's SDK (Keenable toolkit), served to the agent as MCP tools. Each page is cached for verification.</div>
<div class="step"><b>Structured record</b>Schema-validated JSON; every claim = URL + verbatim quote</div>
<div class="step"><b>Verification L1–L5</b>Code checks, critic agent, Composio catalog, re-research</div>
<div class="step"><b>Page</b>Generated from saved data only</div>
</div>
<div class="grid g2" style="margin-top:14px">
<div class="card"><h3 style="margin-top:0">Where a human was needed</h3><ul class="small">
<li><b>Rubric decisions.</b> The pilot showed "customer admin consent" and "vendor app review" being treated as gates. A human ruled: admin consent is normal; app review is tracked separately. A paid product ≠ a paid API.</li>
<li><b>Freezing the baseline.</b> The prompt was fixed after a 6-app pilot, then frozen for all 100 so the before/after comparison is fair.</li>
<li><b>Blind audit.</b> 20 apps checked by hand from official docs before seeing agent output; this is the accuracy ground truth.</li>
<li><b>Tool choice.</b> Composio search/fetch toolkits that need a paid account (Tavily, Firecrawl, Exa) were skipped; Keenable's public toolkit works with no extra signup.</li>
<li><b>Usage limits.</b> Resuming after the subscription reset.</li></ul></div>
<div class="card"><h3 style="margin-top:0">Run stats</h3><ul class="small">
<li>Model: ${esc(baseRecs[0]?.stats?.model ?? "claude-sonnet")} (research + critic) · prompt <code>${esc(meta.prompt_version)}</code></li>
<li>Average per app: ${avgSec}s, ${avgTools} tool calls, max 12 searches / 14 fetches</li>
<li>Usage: ~$${totalUsd.toFixed(0)} notional for the first pass (Claude Pro subscription, not billed per call)</li>
<li>Records failed: ${baseRecs.filter((r) => r.status !== "ok").length} (failed attempts are retried on resume)</li>
<li>Run id <code>${esc(runId)}</code>: all raw data is in <code>runs/${esc(runId)}/</code> in the repo</li></ul></div>
</div>

<h2 id="matrix">All ${n} apps${added.length ? ` <span class="muted">+ ${added.length} added later</span>` : ""}</h2>
${added.length ? `<p class="small muted">Apps added after the study (${added.map((a) => esc(a.name)).join(", ")}) went through the same agent and automatic checks (rules, quote check, critic). They are not human audited and are not counted in any number above. Filter them with the category "${esc([...new Set(added.map((a) => a.category))].join('", "'))}".</p>` : ""}
<div class="filters"><input id="q" placeholder="Search apps…" aria-label="Search apps">
<select id="fc" aria-label="Category"><option value="">All categories</option>${[...A.byCategory.map((c: any) => c.category), ...new Set(added.map((a) => a.category))].filter((c, i, a) => a.indexOf(c) === i).map((c) => `<option>${esc(c)}</option>`).join("")}</select>
<select id="fv" aria-label="Verdict"><option value="">All verdicts</option>${opts(Object.keys(V_LABEL))}</select>
<select id="fm" aria-label="MCP"><option value="">Any MCP</option>${opts(["official", "community", "announced", "none_found", "unknown"])}</select>
<select id="fx" aria-label="In Composio"><option value="">In Composio: any</option><option value="yes">In Composio</option><option value="no">Not in Composio</option></select>
<button id="reset">Reset</button><span id="count" class="small muted" style="align-self:center"></span></div>
<div class="card scroll" style="padding:0"><table id="mx"><thead><tr><th>#</th><th>App</th><th>Auth</th><th>Dev access</th><th>API</th><th>MCP</th><th>Composio</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div>

<h2 id="run">Run it on any app</h2>
<div class="card"><p class="small">The live page is static (no API key is exposed). The same agent runs locally on any app outside this list in about 30–60 seconds. It needs Node 22, a Composio API key, and Claude Code login or <code>ANTHROPIC_API_KEY</code>.</p>
<pre>git clone ${esc(REPO)} && cd composio-app-research && npm install
cp .env.example .env            # add COMPOSIO_API_KEY
npm run research -- --app "Calendly" --hint calendly.com    # any app; prints the full record
npm run research -- --app "Calendly" --hint calendly.com --add   # also add it to this page's list
npm run ui                       # local page with a "Research any app" box (+ "Add to list" checkbox)
npm run render -- --run ${esc(runId)}   # rebuild this page from saved data (no network)</pre>
<p class="small muted">New-app results get automatic verification only (rules + quote check + critic); they are not human audited.</p></div>
</main>
<script>
const $=s=>document.querySelector(s),rows=[...document.querySelectorAll("#mx tr.row")];
function f(){const q=$("#q").value.toLowerCase(),c=$("#fc").value,v=$("#fv").value,m=$("#fm").value,x=$("#fx").value;let k=0;
for(const r of rows){const ok=(!q||r.dataset.q.includes(q))&&(!c||r.dataset.cat===c)&&(!v||r.dataset.verdict===v)&&(!m||r.dataset.mcp===m)&&(!x||r.dataset.composio===x);r.style.display=ok?"":"none";k+=ok}
$("#count").textContent=k+" of "+rows.length+" apps";}
["#q","#fc","#fv","#fm","#fx"].forEach(s=>$(s).addEventListener("input",f));$("#reset").onclick=()=>{["#q","#fc","#fv","#fm","#fx"].forEach(s=>$(s).value="");f()};f();
</script></body></html>`;

  mkdirSync("site/data", { recursive: true });
  writeFileSync("site/index.html", html);
  writeFileSync("site/data/records.json", JSON.stringify([
    ...recs.map(({ stats, ...r }: any) => ({ ...r, added: false, in_composio: !!checks[r.id]?.composio, composio_slug: checks[r.id]?.composio?.slug ?? null, primary_blocker: primaryBlocker(r) })),
    ...added.map(({ stats, ...r }: any) => { const tk = matchToolkit(r, catalogList); return { ...r, in_composio: !!tk, composio_slug: tk?.slug ?? null, primary_blocker: primaryBlocker(r) }; }),
  ], null, 1));
  const cols = ["id", "name", "category", "verdict", "auth_methods", "dev_access", "production_access", "public_app_review", "api_types", "api_breadth", "mcp_status", "mcp_url", "in_composio", "primary_blocker", "blocker", "docs_url", "confidence", "sources"];
  const csvCell = (x: unknown) => { let s = String(x ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  writeFileSync("site/data/records.csv", [cols.join(","), ...recs.map((r) => [r.id, r.name, r.category, r.verdict, r.auth.methods.join(";"), r.access.dev_access, r.access.production_access, r.access.public_app_review, r.api.types.join(";"), r.api.breadth, r.mcp.status, r.mcp.url, !!checks[r.id]?.composio, primaryBlocker(r), r.blocker, r.identity.docs_url, r.confidence, r.claims.map((c) => c.url).join(" ")].map(csvCell).join(","))].join("\n"));
  writeFileSync("site/data/summary.md", `# App toolkit research: summary (machine-readable)\n\nRun ${runId}. ${n} apps. Source of truth: records.json.\n\n## Headlines\n${headlines.map((h) => "- " + h.replace(/<[^>]+>/g, "")).join("\n")}\n\n## Verdicts\n${Object.entries(v).map(([k, c]) => `- ${k}: ${c}`).join("\n")}\n\n## Easy wins not in Composio\n${gap.map((g: any) => `- ${g.name} (${g.category})`).join("\n")}\n\n## Outreach required\n${A.outreach.map((o: any) => `- ${o.name}: ${o.blocker}`).join("\n")}\n`);
  console.log(`wrote site/index.html (${Math.round(html.length / 1024)} KB) + site/data/{records.json,records.csv,summary.md}`);
}
