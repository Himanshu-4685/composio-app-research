// Interactive pipeline diagram for the case-study page.
// Click a step (agent, first pass, L1–L5, human audit) to open what happens inside it.
// Inside L1, click a rule (R0–R6) to open its logic, real examples from this run, and for R1 a
// decision tree with a "try it" box that runs the same logic as src/verify/checks.ts → expectedVerdict().
import type { AppRecord } from "./schema.js";
import { L1_RULES } from "./render_extra.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

type Step = string | { q: string; yes: string; no?: string; bad?: "yes" | "no" };
/** A small left-to-right chain of boxes; decision steps show their yes/no outcomes underneath. */
const chain = (steps: Step[]) => `<div class="fx-chain">${steps.map((s, i) => {
  const arrow = i ? `<span class="fx-ar" aria-hidden="true">→</span>` : "";
  if (typeof s === "string") return `${arrow}<div class="fx-s">${s}</div>`;
  return `${arrow}<div class="fx-s fx-q"><b>${s.q}</b><div class="fx-yn"><span class="${s.bad === "yes" ? "fx-bad" : "fx-ok"}">yes → ${s.yes}</span>${s.no ? `<span class="${s.bad === "no" ? "fx-bad" : "fx-ok"}">no → ${s.no}</span>` : ""}</div></div>`;
}).join("")}</div>`;

const facts = (rows: [string, string][]) => `<div class="fx-facts">${rows.map(([k, v]) => `<div><b>${k}</b><p class="small">${v}</p></div>`).join("")}</div>`;

export function flowSection(ctx: {
  recs: AppRecord[]; baseRecs: AppRecord[]; checks: any; critic: any; corrections: any[]; scores: any; sample: any; n: number; inComposio: number; replayHref?: string;
}) {
  const { recs, baseRecs, checks, critic, corrections, scores, sample, n, inComposio, replayHref } = ctx;
  const name = new Map(recs.map((r) => [r.id, r.name]));
  const flags: any[] = Object.values(checks).flatMap((x: any) => x.flags ?? []);
  const l1 = flags.filter((f) => f.layer === "L1"), l4 = flags.filter((f) => f.layer === "L4");
  const quotes: any[] = Object.values(checks).flatMap((x: any) => x.quotes ?? []);
  const qv = quotes.filter((q) => q.result === "verbatim").length, qn = quotes.filter((q) => q.result === "near").length;
  const crit = Object.values(critic).filter((v: any) => v?.auth) as any[];
  const cc = (s: string) => crit.reduce((a, v) => a + Object.values(v).filter((j: any) => j.status === s).length, 0);
  const reApps = new Set(corrections.map((c) => c.app_id)).size;
  const vChanges = corrections.filter((c) => c.field === "verdict");
  const ok = baseRecs.filter((r) => r.status === "ok").length;
  const avgTools = (baseRecs.reduce((a, r) => a + (r.stats?.tool_calls ?? 0), 0) / Math.max(1, baseRecs.length)).toFixed(1);
  const cost = baseRecs.reduce((a, r) => a + (r.stats?.notional_usd ?? 0), 0);
  const flaggedApps = new Set([...flags.map((f) => f.app_id), ...Object.entries(critic).filter(([, v]: any) => v?.auth && Object.values(v).some((j: any) => j.status === "contradicted" || j.status === "suspect")).map(([id]) => Number(id))]).size;
  const s = scores?.summary ?? {};
  const sc = (k: string) => s[k]?.N ? `${pct(s[k].C, s[k].N)}%` : "–";
  const fired = (id: string) => { const r = L1_RULES.find((x) => x.id === id)!; return l1.filter((f) => r.re.test(f.msg)); };
  const realEx = (id: string, k = 3) => fired(id).slice(0, k).map((f) => `<li><b>${esc(name.get(f.app_id) ?? "#" + f.app_id)}</b>: <code>${esc(f.msg)}</code></li>`).join("");

  // ---------- main flow nodes ----------
  const nodes: { k: string; t: string; sub: string; kind: "data" | "ai" | "code" | "human" | "gate" }[] = [
    { k: "agent", t: "Research agent", sub: `${avgTools} tool calls / app`, kind: "ai" },
    { k: "first", t: "First pass", sub: `${ok}/${n} records, frozen`, kind: "data" },
    { k: "L1", t: "L1 rules", sub: `R0–R6 · ${l1.length} flags`, kind: "code" },
    { k: "L2", t: "L2 quotes", sub: `${qv + qn}/${quotes.length} found`, kind: "code" },
    { k: "L3", t: "L3 critic", sub: `${crit.length} apps reviewed`, kind: "ai" },
    { k: "L4", t: "L4 catalog", sub: `${l4.length} auth gaps`, kind: "code" },
    { k: "gate", t: "Any flags?", sub: `${flaggedApps} apps flagged`, kind: "gate" },
    { k: "L5", t: "L5 re-research", sub: `${corrections.length} field changes`, kind: "ai" },
    { k: "final", t: "Final record", sub: "final.jsonl + page", kind: "data" },
    { k: "H", t: "Human audit", sub: `holdout ${sc("baseline.holdout")} → ${sc("final.holdout")}`, kind: "human" },
  ];
  const flowHtml = `<div class="fx-flow" role="group" aria-label="Pipeline steps">${nodes.map((x, i) =>
    `${i ? `<span class="fx-ar" aria-hidden="true">${x.k === "H" ? "⋯" : "→"}</span>` : ""}<button class="fx-n k-${x.kind}" data-fx="${x.k}" aria-expanded="false"><b>${x.t}</b><span>${x.sub}</span></button>`).join("")}</div>`;

  // ---------- panels ----------
  const panel = (k: string, title: string, kind: string, body: string) =>
    `<section class="fx-p" data-p="${k}" hidden><h4>${title} <span class="tag">${kind}</span></h4>${body}</section>`;

  // L1: the rule chain (each row opens its rule)
  const ruleOrder = ["R0", "R1", "R2", "R3", "R4", "R5", "R6"];
  const flagOf: Record<string, string> = { R0: "stop, re-run the app", R1: "flag verdict", R2: "flag that field", R3: "flag MCP", R4: "flag auth", R5: "flag API", R6: "flag confidence" };
  const ruleRows = ruleOrder.map((id) => {
    const r = L1_RULES.find((x) => x.id === id)!;
    const k = fired(id).length;
    return `<button class="fx-rr" data-fx="${id}" aria-expanded="false"><span class="fx-rid">${id}</span><span class="fx-rn">${esc(r.name)}</span><span class="fx-rf">fails → ${flagOf[id]}</span><span class="fx-rc">${k} fired</span></button>`;
  }).join(`<span class="fx-down" aria-hidden="true">↓ pass</span>`);

  const opts = ["free", "free_trial", "paid_plan", "admin_approval", "app_review", "partner_or_sales", "not_applicable", "unknown"];
  const sel = (id: string, v: string) => `<select id="${id}">${opts.map((o) => `<option${o === v ? " selected" : ""}>${o}</option>`).join("")}</select>`;
  const verdicts = ["build_now", "build_with_conditions", "outreach_required", "limited", "needs_research"];

  const ruleBody: Record<string, string> = {
    R0: facts([
      ["Checks", "The record exists and has <code>status: ok</code>. A crash, timeout or invalid JSON gives <code>status: error</code>."],
      ["If it fails", "Flags <i>all</i> fields and stops: no other rule runs on a failed record. Resuming the run re-researches it."],
      ["Example", "An app times out after 10 minutes → <code>research failed: timeout</code> → re-run on resume. Without R0 it would silently show as 'no data'."],
      ["In this run", `${fired("R0").length} fired: failed attempts (e.g. at the usage limit) were retried before checking, so all ${ok} records were complete.`],
    ]),
    R1: `${facts([
      ["Why it matters", "The agent fills in two things separately: the <b>facts</b> (dev_access, production_access) and a <b>judgement</b> (the verdict). R1 throws the verdict away, re-derives it from the facts with the rubric, and compares. A mismatch means the agent contradicted itself."],
      ["In this run", `${fired("R1").length} fired in the 100-app run. In the pilot it fired on HubSpot and Close: access was free, but the agent chose "with conditions" only because the vendor reviews public OAuth apps. That exposed a vague rubric, which was fixed before the full run.`],
      ["Weakness", "Consistency, not truth: if the access field itself is wrong, a verdict that matches it passes. L3 and the human audit catch that."],
      ["Skips", "Apps the agent itself marked <code>limited</code> or <code>needs_research</code>, and cases where the rubric gives no expectation (e.g. an <code>unknown</code> access field)."],
    ])}
<h5>Decision tree (first match wins)</h5>
<ol class="fx-tree">
<li data-t="1"><span class="fx-tq">dev or production access is <code>partner_or_sales</code>?</span><span class="fx-ty">yes → expect <b>outreach required</b></span></li>
<li data-t="2"><span class="fx-tq">either is <code>paid_plan</code>, <code>admin_approval</code> or <code>app_review</code>?</span><span class="fx-ty">yes → expect <b>build with conditions</b></span></li>
<li data-t="3"><span class="fx-tq">dev is <code>free</code>/<code>free_trial</code>, production is free/trial/<code>not_applicable</code>, and an API was found?</span><span class="fx-ty">yes → expect <b>build now</b></span></li>
<li data-t="4"><span class="fx-tq">none of the above</span><span class="fx-ty">no expectation → R1 stays silent</span></li>
<li data-t="5"><span class="fx-tq">expected = agent's verdict?</span><span class="fx-ty">yes → pass · no → <b class="fx-badt">flag verdict for L5</b></span></li>
</ol>
<p class="small muted">Order matters: an app that is paid <i>and</i> partner-gated is outreach. Paying doesn't help if sales won't let you in.</p>
<h5>Try it</h5>
<div class="fx-try"><label>dev_access ${sel("fx-d", "free")}</label><label>production_access ${sel("fx-p", "free")}</label>
<label><input type="checkbox" id="fx-api" checked> API found</label>
<label>agent's verdict <select id="fx-v">${verdicts.map((v) => `<option${v === "build_now" ? " selected" : ""}>${v}</option>`).join("")}</select></label></div>
<div id="fx-out" class="fx-out" aria-live="polite"></div>
<p class="small muted">Starts with Stripe's real record (free / free / REST API / build_now → pass). Try production = partner_or_sales.</p>`,
    R2: facts([
      ["Checks", "Auth, access and API each have ≥1 claim (field, URL, verbatim quote). An MCP status of official, community or announced needs its own MCP claim."],
      ["If it fails", "Flags the field without evidence. L5 must find a source or mark it unknown."],
      ["Example", "Auth says <code>oauth2 + api_key</code> but no claim has <code>field: auth</code> → <code>no evidence claim for auth</code>."],
      ["In this run", `${fired("R2").length} fired: the prompt requires a quote per field, and the schema makes claims mandatory.`],
    ]),
    R3: facts([
      ["Checks", "If MCP = official, the server URL's root domain must match the vendor's website or docs domain, or be on github.com."],
      ["If it fails", "Flags MCP: a third-party server may be mislabelled as official."],
      ["Real flags from this run", `<ul class="fx-ex">${realEx("R3", 5) || "<li>none</li>"}</ul>`],
      ["Weakness", "These were mostly vendor-owned second domains (pipedrive.ai, freshworks.com), i.e. false alarms. The fix is an allow-list of vendor domains. Flags trigger a re-check, never an automatic edit."],
    ]),
    R4: facts([
      ["Checks", "If any API was found (types ≠ none_found), at least one auth method is listed."],
      ["If it fails", "Flags auth: the most important field for a toolkit was skipped."],
      ["Example", "API types <code>rest</code>, <code>auth.methods: []</code> → <code>no auth methods listed for an app with an API</code>."],
      ["In this run", `${fired("R4").length} fired. Its blind spot is a <i>missing second</i> method: 4 of the 24 remaining audit errors are a missed auth method, which this rule can't see.`],
    ]),
    R5: facts([
      ["Checks", "'broad' needs ≥5 listed resource families; 'narrow' allows at most 3. 'moderate' always passes."],
      ["If it fails", "Flags API: the breadth label disagrees with the agent's own list."],
      ["Real flags from this run", `<ul class="fx-ex">${realEx("R5") || "<li>none</li>"}</ul>`],
      ["Weakness", "Breadth is coarse on purpose; the audit accepts breadth within one step."],
    ]),
    R6: facts([
      ["Checks", "'high' confidence needs ≥3 claims."],
      ["If it fails", "Flags the whole record as over-confident, so it gets routed to review."],
      ["Example", "High confidence built on one blog quote → <code>high confidence with fewer than 3 claims</code>. Stripe: high confidence with 7 claims → pass."],
      ["In this run", `${fired("R6").length} fired. It counts claims, not their quality (official docs vs blog).`],
    ]),
  };
  const rulePanels = ruleOrder.map((id) => {
    const r = L1_RULES.find((x) => x.id === id)!;
    return `<div class="fx-rule" data-r="${id}" hidden><h5 class="fx-rh">${id} · ${esc(r.name)} <span class="small muted">${fired(id).length} fired in this run</span></h5>${ruleBody[id]}</div>`;
  }).join("");

  const panels = [
    panel("agent", "Research agent", "AI + Composio tools", chain([
      "App name + hint domain", "Claude Sonnet decides what to search and read", "<code>web_search</code> ≤12 · <code>fetch_page</code> ≤14 via Composio (Keenable), served as MCP tools; every page cached", "Schema-validated JSON; every claim = URL + verbatim quote",
    ]) + facts([["Why wrap the tools", "Caching the exact page text the agent read is what lets L2 and the critic re-check it later."], ["Cost", `~$${cost.toFixed(0)} notional for ${n} apps (about $${(cost / Math.max(1, n)).toFixed(2)} each).`]])),
    panel("first", "First pass (frozen)", "data", chain(["Each record appended once to <code>baseline.jsonl</code>", "Exact prompt saved as <code>prompt.md</code> + <code>meta.json</code>", "Never edited: the loop writes <code>final.jsonl</code> and <code>corrections.jsonl</code> instead"]) +
      facts([["Why freeze it", `So "before vs after" is real: the audit scores both. Holdout: ${sc("baseline.holdout")} first pass → ${sc("final.holdout")} after the loop.`]])),
    panel("L1", "L1 rule checks", "code, no AI", `<p class="small">Seven deterministic rules, run in order on every record. A failed rule adds a flag on one field and the checks continue (except R0). <b>Click a rule</b> to see its logic and real examples.</p><div class="fx-rules">${ruleRows}</div>${rulePanels}`),
    panel("L2", "L2 quote check", "code, no AI", chain([
      "Claim: field, URL, quote", "Load the cached page the agent read (fetch if missing)", "Normalise both: markdown, link targets, curly quotes, dashes, spaces",
      { q: "Exact substring?", yes: "verbatim", no: "next test" }, { q: "≥80% of 5-word shingles on the page?", yes: "near match", no: "not found → flag field", bad: "no" },
    ]) + facts([["Result", `${qv} verbatim, ${qn} near, ${quotes.length - qv - qn} not found, out of ${quotes.length}. The agent never invented a quote.`], ["Can't catch", "A real quote that is misread, outdated, or about the wrong plan."]])),
    panel("L3", "L3 critic", "AI, separate", chain([
      "Record + ±700-char excerpt around each quote", "Fresh Sonnet: no tools, prompted to find mistakes", "Labels each field: supported / contradicted / insufficient / suspect", { q: "contradicted or suspect?", yes: "sent to L5 with the reason", no: "nothing", bad: "yes" },
    ]) + facts([["Result", `${cc("contradicted")} contradicted, ${cc("suspect")} suspect, ${cc("insufficient")} insufficient fields across ${crit.length} apps. Most suspects were missing conditions on access and verdict.`], ["Safety", "It never edits. 'Suspect' comes from model memory, so it only triggers re-research with sources."]])),
    panel("L4", "L4 Composio catalog", "API, no AI", chain([
      "Find the app among Composio's toolkits", "Map scheme names (OAUTH2 → oauth2, API_KEY/BEARER → api_key …)", { q: "Composio's schemes ⊆ ours?", yes: "pass", no: "flag auth", bad: "no" },
    ]) + facts([["Result", `${inComposio}/${n} apps matched; ${l4.length} disagreements (${l4.map((f) => esc(name.get(f.app_id))).join(", ")}): OAuth2 missing in our record.`], ["Why a subset", "Composio may implement fewer methods than the vendor offers, so equality would be wrong."]])),
    panel("gate", "Any flags?", "router", chain([
      "Collect flags from L1, L2, L4 + critic contradicted/suspect", { q: "Any for this app?", yes: "L5 re-research", no: "first pass copied to final" },
    ]) + facts([["This run", `${flaggedApps} of ${n} apps had at least one flag.`]])),
    panel("L5", "L5 targeted re-research", "AI agent + tools", chain([
      "Flagged app + its issues + previous record", "Same agent re-checks each issue against official sources", "Keep what's right, fix what's wrong, 'unknown' instead of guessing", "Log every change: before → after, which layer, why",
    ]) + facts([["Result", `${reApps} apps changed, ${corrections.length} field changes, ${vChanges.length} verdict changes (e.g. ${vChanges.slice(0, 4).map((c) => esc(c.app)).join(", ")} → with conditions).`], ["Risk", "It could 'fix' a correct answer if the objection was wrong, which is why it must cite sources."]])),
    panel("final", "Final record", "data", chain(["<code>final.jsonl</code>: corrected records", "<code>corrections.jsonl</code>: every change with its reason", "This page + <code>records.json</code> / <code>.csv</code>, rebuilt from saved data only"])),
    panel("H", "Blind human audit", "human", chain([
      `${sample?.picks?.length ?? 20} random apps (seed ${esc(sample?.seed)}), 2 per category`, "Human fills 5 fields from official docs before seeing the agent", "Code grades each field C / I / U", "10 calibration (may guide fixes) · 10 holdout (only scored)",
    ]) + facts([["Scores", `Calibration ${sc("baseline.calibration")} → ${sc("final.calibration")} · holdout ${sc("baseline.holdout")} → ${sc("final.holdout")} (first pass → after loop).`], ["Why holdout", "Gains on apps never used for tuning are the honest measure."]])),
  ].join("");

  const html = `<div class="card fx" id="flow">
<div class="fx-top"><p class="small muted" style="margin:0">Click any step to open it. Inside <b>L1</b>, click a rule; <b>R1</b> has a decision tree you can try.</p>${replayHref ? `<a class="fx-play" href="${esc(replayHref)}">▶ Watch Stripe go through every check (30 s)</a>` : ""}</div>
${flowHtml}
<div class="fx-legend small muted"><span class="k-ai">AI step</span><span class="k-code">code check</span><span class="k-human">human</span><span class="k-data">saved data</span></div>
<nav class="fx-crumb small" aria-label="Diagram path"></nav>
${panels}</div>`;

  const css = `
.fx{--code:#0F6E56}@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .fx{--code:#5DCAA5}}:root[data-theme=dark] .fx{--code:#5DCAA5}
.fx-top{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin-bottom:10px}
.fx-play{font-size:13px;padding:6px 10px;border:1px solid var(--accent);border-radius:8px;text-decoration:none}
.fx-flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.fx-n{font:inherit;text-align:left;cursor:pointer;background:var(--card);color:var(--fg);border:1.5px solid var(--line);border-radius:10px;padding:8px 10px;min-width:112px;display:flex;flex-direction:column;gap:2px}
.fx-n b{font-size:13.5px}.fx-n span{font-size:11.5px;color:var(--muted)}.fx-n:hover{border-color:var(--fg)}
.fx-n.k-ai{border-color:var(--accent)}.fx-n.k-code{border-color:var(--code)}.fx-n.k-human{border:1.5px dashed var(--warn)}.fx-n.k-gate{border-radius:20px}
.fx-n[aria-expanded=true]{background:color-mix(in srgb,var(--accent) 12%,var(--card));box-shadow:0 0 0 2px var(--accent)}
.fx-ar{color:var(--muted);font-size:16px}.fx-legend{display:flex;gap:14px;margin:10px 0 4px;flex-wrap:wrap}.fx-legend span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px;border:1.5px solid}
.fx-legend .k-ai::before{border-color:var(--accent)}.fx-legend .k-code::before{border-color:var(--code)}.fx-legend .k-human::before{border:1.5px dashed var(--warn)}.fx-legend .k-data::before{border-color:var(--line)}
.fx-crumb{margin:8px 0}.fx-crumb button{font:inherit;background:none;border:0;color:var(--accent);cursor:pointer;padding:0}.fx-crumb span{margin:0 6px;color:var(--muted)}
.fx-p{border-top:1px solid var(--line);padding-top:10px;margin-top:6px}.fx-p h4{margin:4px 0 10px;font-size:15px}.fx-p h5{margin:14px 0 6px;font-size:13.5px}
.fx-chain{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0 10px}.fx-s{background:var(--chip);border-radius:8px;padding:7px 10px;font-size:12.5px;max-width:260px}
.fx-q{border:1px solid var(--line);background:var(--card)}.fx-yn{display:flex;flex-direction:column;gap:2px;margin-top:4px;font-size:11.5px}.fx-ok{color:var(--good)}.fx-bad{color:var(--bad)}
.fx-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:4px 16px}.fx-facts p{margin:2px 0 8px}.fx-ex{margin:2px 0;padding-left:18px;font-size:12px}.fx-ex code{font-size:11.5px;white-space:normal}
.fx-rules{display:flex;flex-direction:column;align-items:stretch;gap:2px;max-width:720px}
.fx-rr{font:inherit;cursor:pointer;display:grid;grid-template-columns:34px 1fr auto auto;gap:10px;align-items:center;text-align:left;background:var(--card);color:var(--fg);border:1.5px solid var(--code);border-radius:8px;padding:7px 10px}
.fx-rr:hover{background:var(--chip)}.fx-rr[aria-expanded=true]{box-shadow:0 0 0 2px var(--accent)}.fx-rid{font-weight:700;color:var(--code)}.fx-rn{font-size:13.5px}.fx-rf{font-size:11.5px;color:var(--bad)}.fx-rc{font-size:11.5px;color:var(--muted);min-width:52px;text-align:right}
.fx-down{font-size:11px;color:var(--muted);padding-left:14px}
.fx-rule{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:10px;background:color-mix(in srgb,var(--chip) 45%,var(--card))}.fx-rh{margin:0 0 8px!important}
.fx-tree{margin:0;padding-left:20px;font-size:13px}.fx-tree li{margin:4px 0;padding:6px 8px;border-radius:8px;display:flex;flex-wrap:wrap;gap:4px 12px}.fx-tq{flex:1;min-width:220px}.fx-ty{color:var(--muted)}
.fx-tree li.on{background:color-mix(in srgb,var(--accent) 14%,transparent)}.fx-tree li.on .fx-ty{color:var(--fg)}.fx-badt{color:var(--bad)}
.fx-try{display:flex;flex-wrap:wrap;gap:8px 14px;font-size:13px;align-items:center}.fx-try select{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
.fx-out{margin-top:8px;padding:8px 10px;border-radius:8px;font-size:13px;background:var(--chip)}.fx-out.pass{border-left:4px solid var(--good)}.fx-out.flag{border-left:4px solid var(--bad)}.fx-out.skip{border-left:4px solid var(--muted)}
@media (max-width:600px){.fx-rr{grid-template-columns:30px 1fr;}.fx-rf,.fx-rc{grid-column:2}.fx-n{min-width:0;flex:1 1 40%}}`;

  // Client JS: open/close panels, breadcrumb, and the R1 try-it box (same logic as expectedVerdict()).
  const js = `
(function(){const root=document.getElementById("flow");if(!root)return;
const T={agent:"Research agent",first:"First pass",L1:"L1 rules",L2:"L2 quotes",L3:"L3 critic",L4:"L4 catalog",gate:"Any flags?",L5:"L5 re-research",final:"Final record",H:"Human audit"};
const crumb=root.querySelector(".fx-crumb");let cur="";
function open(k){const rule=/^R\\d$/.test(k),top=rule?"L1":k;if(cur===k&&!rule){k="";}
root.querySelectorAll(".fx-p").forEach(p=>p.hidden=p.dataset.p!==(k?top:""));
root.querySelectorAll(".fx-n").forEach(b=>b.setAttribute("aria-expanded",String(!!k&&b.dataset.fx===top)));
root.querySelectorAll(".fx-rule").forEach(p=>p.hidden=!(rule&&p.dataset.r===k));
root.querySelectorAll(".fx-rr").forEach(b=>b.setAttribute("aria-expanded",String(rule&&b.dataset.fx===k)));
cur=k;const parts=[["","Pipeline"]];if(k)parts.push([top,T[top]]);if(rule)parts.push([k,k]);
crumb.innerHTML=parts.map((p,i)=>i===parts.length-1?"<b>"+p[1]+"</b>":"<button data-c='"+p[0]+"'>"+p[1]+"</button>").join("<span>›</span>");
crumb.querySelectorAll("button").forEach(b=>b.onclick=()=>{cur="";open(b.dataset.c)});
if(k){const el=rule?root.querySelector(".fx-rule[data-r='"+k+"']"):root.querySelector(".fx-p[data-p='"+top+"']");el&&el.scrollIntoView({block:"nearest",behavior:"smooth"});}}
root.querySelectorAll("[data-fx]").forEach(b=>b.addEventListener("click",()=>open(b.dataset.fx)));
const FREE=["free","free_trial"],L={outreach_required:"outreach required",build_with_conditions:"build with conditions",build_now:"build now"};
function exp(d,p,api){if(d==="partner_or_sales"||p==="partner_or_sales")return["outreach_required",1];
if([d,p].some(x=>["paid_plan","admin_approval","app_review"].includes(x)))return["build_with_conditions",2];
if(FREE.includes(d)&&FREE.concat("not_applicable").includes(p)&&api)return["build_now",3];return[null,4];}
function run(){const d=root.querySelector("#fx-d").value,p=root.querySelector("#fx-p").value,api=root.querySelector("#fx-api").checked,v=root.querySelector("#fx-v").value;
const [e,row]=exp(d,p,api),out=root.querySelector("#fx-out");let cls,msg;
if(v==="limited"||v==="needs_research"){cls="skip";msg="Agent said <b>"+v+"</b>: R1 skips this record."}
else if(!e){cls="skip";msg="The rubric gives <b>no expectation</b> for these access values: R1 stays silent."}
else if(e===v){cls="pass";msg="Expected <b>"+L[e]+"</b> · agent said <b>"+v+"</b> → <b>pass</b>."}
else{cls="flag";msg="Expected <b>"+L[e]+"</b> · agent said <b>"+v+"</b> → <b>flag:</b> <code>verdict "+v+" but access fields imply "+e+"</code>. L5 re-checks which one is wrong."}
out.className="fx-out "+cls;out.innerHTML=msg;
root.querySelectorAll(".fx-tree li").forEach(li=>{const t=+li.dataset.t;li.classList.toggle("on",t===row||(t===5&&!!e&&cls!=="skip"))});}
["#fx-d","#fx-p","#fx-api","#fx-v"].forEach(s=>{const el=root.querySelector(s);el&&el.addEventListener("input",run)});if(root.querySelector("#fx-d"))run();
open("");})();`;

  return { html, css, js };
}
