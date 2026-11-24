// Extra, interactive sections for the case-study page:
//  - how every verification layer (and each L1 rule) works, with counts from this run
//  - clickable clusters (category x verdict grid, build-now profile) that filter the app table
//  - accuracy explorer over the 20 audited apps (first pass vs after loop, hover for agent vs human)
//  - where the agent lags and how to raise accuracy
//  - every point a human was needed + a risk-ranked review queue
import { readFileSync, existsSync } from "node:fs";
import type { AppRecord } from "./schema.js";
import { parseCsv, GRADED } from "./evaluate.js";
import { primaryBlocker } from "./analyze.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const VL: Record<string, string> = { build_now: "Build now", build_with_conditions: "With conditions", outreach_required: "Outreach", limited: "Limited", needs_research: "Needs research" };
/** JSON for embedding inside <script>: escape < so "</script>" can't break out. */
const safeJson = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");
const fattr = (o: Record<string, string>) => esc(JSON.stringify(o));

// The individual L1 rules, matched to the flag messages produced by src/verify/checks.ts.
export const L1_RULES = [
  { id: "R1", name: "Verdict follows access", re: /verdict .* but access fields imply/, logic: "Re-derives the verdict from dev_access + production_access (free/trial + API on all plans → build now; paid tier/admin/app review → conditions; partner/sales → outreach) and flags a mismatch.", why: "Catches the agent contradicting itself, e.g. 'build now' while also saying access needs a partnership." },
  { id: "R2", name: "Every field has evidence", re: /no evidence claim for|with no mcp evidence claim/, logic: "Auth, access and API must each have at least one claim (URL + verbatim quote); a positive MCP status must have its own claim.", why: "A field without a source is an opinion, not a finding." },
  { id: "R3", name: "Official MCP is on the vendor's domain", re: /official MCP url/, logic: "If MCP = official, its URL must be on the vendor's website/docs domain (or GitHub).", why: "Separates vendor-run servers from third-party ones. Known false alarms: vendor-owned second domains (sentry.dev, helpscout.net)." },
  { id: "R4", name: "An API needs an auth method", re: /no auth methods listed/, logic: "If an API was found, at least one auth method must be listed.", why: "An empty auth list means the agent skipped the most important field." },
  { id: "R5", name: "Breadth matches resources", re: /breadth .* resource families/, logic: "'broad' needs 5+ listed resource families; 'narrow' at most 3.", why: "Keeps the breadth label honest against the list the agent itself produced." },
  { id: "R6", name: "Confidence matches evidence", re: /high confidence with fewer/, logic: "'high' confidence needs 3+ claims.", why: "Stops confident answers built on one source." },
  { id: "R0", name: "Research completed", re: /research failed/, logic: "Failed/timed-out runs are flagged and retried on resume.", why: "Nothing silently disappears from the 100." },
];

export function extras(ctx: {
  recs: AppRecord[]; base: Map<number, AppRecord>; checks: any; critic: any; corrections: any[];
  scores: any; sample: any; A: any; n: number; disagreements: any;
}) {
  const { recs, base, checks, critic, corrections, scores, sample, A, n, disagreements } = ctx;
  const flagsAll: any[] = Object.values(checks).flatMap((x: any) => x.flags ?? []);
  const ruleCount = (re: RegExp) => flagsAll.filter((f) => f.layer === "L1" && re.test(f.msg)).length;
  const quotes: any[] = Object.values(checks).flatMap((x: any) => x.quotes ?? []);
  const l4 = flagsAll.filter((f) => f.layer === "L4");
  const crit = Object.entries(critic).filter(([, v]: any) => v?.auth) as [string, any][];
  const critCount = (s: string) => crit.reduce((a, [, v]) => a + Object.values(v).filter((j: any) => j.status === s).length, 0);
  const verdictChanges = corrections.filter((c) => c.field === "verdict").length;
  const reApps = new Set(corrections.map((c) => c.app_id)).size;

  // ---------- 1. how the checks work ----------
  const layer = (id: string, title: string, kind: string, what: string, how: string, example: string, cant: string, num: string, file: string, extra = "") => `
<details class="card layer"><summary><span class="lid">${id}</span> <b>${title}</b> <span class="tag">${kind}</span> <span class="small muted">${num}</span></summary>
<div class="lgrid"><div><b>What it checks</b><p class="small">${what}</p></div><div><b>How it works</b><p class="small">${how}</p></div>
<div><b>Real example from this run</b><p class="small">${example}</p></div><div><b>What it can't catch</b><p class="small">${cant}</p></div></div>
${extra}<p class="small muted">Code: <code>${file}</code></p></details>`;
  const rulesTable = `<table><thead><tr><th>Rule</th><th>Logic</th><th>Why it matters</th><th>Fired</th></tr></thead><tbody>${L1_RULES.map((r) => `<tr><td><b>${r.id}</b> ${esc(r.name)}</td><td class="small">${esc(r.logic)}</td><td class="small">${esc(r.why)}</td><td>${ruleCount(r.re)}</td></tr>`).join("")}</tbody></table>`;
  const checksHtml = `
<h3 id="how-checks">How each check works</h3>
<p class="small muted">The layers run in order on every record. A flag never edits a record by itself; it sends the record back to research (L5) with the objection attached. Click a layer to expand it.</p>
${layer("L1", "Rule checks", "code, no AI", "Internal consistency of each record: does the verdict follow from the access fields, does every field have evidence, do labels match the agent's own lists.",
    "Six deterministic rules (R1–R6, listed below) run over the structured record. Each rule either passes or raises a flag naming the field and the reason.",
    "In the pilot, R1 flagged HubSpot and Close: 'build with conditions' given only because the vendor reviews public OAuth apps, which the rubric says is not a gate. That finding changed the prompt before the 100-app run.",
    "A wrong answer that is internally consistent. Rules check logic, not facts.", `${flagsAll.filter((f) => f.layer === "L1").length} flags on the first pass`, "src/verify/checks.ts → ruleChecks()",
    `<h4 style="margin:14px 0 6px">The six rules (plus a completeness check)</h4><div class="scroll">${rulesTable}</div>`)}
${layer("L2", "Quote check", "code, no AI", "Whether each claim's quote really appears on the page it cites, i.e. that the agent did not invent or misremember text.",
    "Every fetched page is cached when the agent reads it. For each claim, code normalises page and quote (markdown, link targets, curly quotes, dashes, whitespace) and looks for the quote. If there's no exact match, it accepts a near match when ≥80% of the quote's 5-word shingles appear on the page.",
    `${quotes.filter((q) => q.result === "verbatim").length} of ${quotes.length} quotes matched verbatim; ${quotes.filter((q) => q.result === "near").length} near; ${quotes.filter((q) => q.result === "not_found").length} not found.`,
    "A real quote that is misread, or a quote from an outdated page. Real ≠ correctly interpreted.", `${quotes.length} quotes checked`, "src/verify/checks.ts → quoteChecks(), matchQuote()")}
${layer("L3", "Critic agent", "AI, separate", "Whether each field (auth, access, API, MCP, verdict) is supported by the evidence, and what the record may be missing.",
    "A second Claude call with a fresh context and no tools. It is prompted to find mistakes, not to agree. It sees the record plus a ±700-character excerpt around each quote, and labels each field supported / contradicted / insufficient / suspect (suspect = 'from what I know, a condition is probably missing: go check'). See prompts/critic.md.",
    `Across ${crit.length} apps: ${critCount("contradicted")} contradicted, ${critCount("suspect")} suspect, ${critCount("insufficient")} insufficient fields. Most suspects were missing conditions on access and verdict (e.g. API tier gates).`,
    "Mistakes both models share. Its 'suspect' notes come from model memory, so they are only ever acted on through re-research with sources.", `${crit.length} apps reviewed`, "src/verify/critic.ts, prompts/critic.md")}
${layer("L4", "Composio catalog cross-check", "API, no AI", "Whether our auth methods include every auth scheme Composio's own toolkit uses for the same app. This source is fully independent of our agent.",
    `Code downloads Composio's toolkit catalog (${A.in_composio}/${n} of our apps are in it), maps scheme names (OAUTH2 → oauth2, API_KEY/BEARER_TOKEN → api_key/personal_token, BASIC, SERVICE_ACCOUNT …) and flags any Composio scheme our record doesn't cover. Subset, not equality: Composio may implement fewer methods than the vendor offers.`,
    `${l4.length} disagreements (Ahrefs, Neo4j, Datadog: Composio supports OAuth2 that our record missed). Neo4j was fixed by re-research.`,
    `The ${n - A.in_composio} apps Composio doesn't have yet, and anything other than auth.`, `${l4.length} auth disagreements`, "src/verify/catalog.ts")}
${layer("L5", "Targeted re-research", "AI agent + tools", "Only the flagged apps, focused on the specific objections.",
    "Each flagged app is researched again by the same agent, with the list of issues (from L1/L2/L4 and critic contradicted/suspect notes) and its previous record in the prompt. It must verify each issue against official sources, keep what is right, fix what is wrong, and fall back to 'unknown/needs research' instead of guessing. Every field change is logged (before → after → which layer → why).",
    `${reApps} apps changed, ${corrections.length} field changes, ${verdictChanges} verdict changes (e.g. Ramp and iPayX moved to 'with conditions'; Datadog to 'needs research' when sources conflicted).`,
    "Errors no layer flagged. That's why an independent human audit is still needed.", `${corrections.length} field changes`, "src/verify/run.ts → stage fix")}
${layer("H", "Blind human audit", "human", "Ground truth: the answer a careful person gets from the official docs.",
    "20 apps (2 per category, fixed random seed, pilot apps excluded) are split into 10 calibration (allowed to guide fixes) and 10 holdout (only scored). The human fills in 5 fields per app from official docs before seeing the agent's answers. Code grades each field C / I / U with fixed rules.",
    "Correct fields: calibration 56% → 62%, holdout 70% → 76% (first pass → after loop).",
    "It's a sample of 20: the rates describe the sample, not an exact accuracy for all 100.", "100 field checks", "audit/, src/evaluate.ts")}`;

  // ---------- 2. clickable clusters ----------
  const cats: string[] = A.byCategory.map((c: any) => c.category);
  const vkeys = Object.keys(VL);
  const maxCell = Math.max(1, ...A.byCategory.flatMap((c: any) => vkeys.map((v) => c.verdicts[v] ?? 0)));
  const heat = `<div class="scroll"><table class="heat"><thead><tr><th>Category</th>${vkeys.map((v) => `<th>${VL[v]}</th>`).join("")}</tr></thead><tbody>${A.byCategory.map((c: any) => `<tr><td>${esc(c.category)}</td>${vkeys.map((v) => {
    const k = c.verdicts[v] ?? 0;
    return `<td>${k ? `<button class="cell v-${v}" style="--a:${(0.15 + 0.85 * (k / maxCell)).toFixed(2)}" data-f="${fattr({ cat: c.category, verdict: v })}" title="Show these ${k} apps">${k}</button>` : `<span class="muted">·</span>`}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;
  const bn = recs.filter((r) => r.verdict === "build_now");
  const cnt = (xs: string[]) => xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  const bnCats = Object.entries(cnt(bn.map((r) => r.category))).sort((a, b) => b[1] - a[1]);
  const bnProfile = `<ul class="small">
<li><b>${bn.length}/${n}</b> apps. Most common in ${bnCats.slice(0, 3).map(([c, k]) => `<button class="lnk" data-f="${fattr({ cat: c, verdict: "build_now" })}">${esc(c)} (${k})</button>`).join(", ")}.</li>
<li><b>Auth:</b> ${pct(bn.filter((r) => r.auth.methods.includes("oauth2")).length, bn.length)}% offer OAuth2, ${pct(bn.filter((r) => r.auth.methods.some((m) => m === "api_key" || m === "personal_token")).length, bn.length)}% an API key or personal token. Most offer both: OAuth for multi-customer apps, a key for quick testing.</li>
<li><b>API:</b> ${pct(bn.filter((r) => r.api.breadth === "broad").length, bn.length)}% broad, ${pct(bn.filter((r) => r.api.types.includes("graphql")).length, bn.length)}% GraphQL. <b>MCP:</b> ${pct(bn.filter((r) => r.mcp.status === "official").length, bn.length)}% already ship an official MCP server.</li>
<li><b>Composio:</b> ${pct(bn.filter((r) => checks[r.id]?.composio).length, bn.length)}% already exist in Composio. The other ${bn.filter((r) => !checks[r.id]?.composio).length} are the cheapest new toolkits: <button class="lnk" data-f="${fattr({ verdict: "build_now", composio: "no" })}">show them</button>.</li>
<li><b>Typical shape:</b> a developer-facing SaaS with a free tier or trial, a public REST API on every plan, OAuth2 + key, and published docs. The gated ones look different: enterprise data (PitchBook, DealCloud), ads platforms and fintech need sales contact, paid tiers or vendor approval.</li></ul>`;
  const clustersHtml = `
<h3>Clusters: click any number to see those apps</h3>
<div class="grid g2"><div class="card"><h3 style="margin-top:0">Category × verdict</h3>${heat}<p class="small muted">Each cell filters the app table below.</p></div>
<div class="card"><h3 style="margin-top:0">What kind of apps are "build now"?</h3>${bnProfile}</div></div>`;

  // ---------- 3. accuracy explorer ----------
  const human = existsSync("audit/human.csv") ? parseCsv(readFileSync("audit/human.csv", "utf8")) : [];
  const fin = new Map(recs.map((r) => [r.id, r]));
  const val = (f: string, r?: AppRecord) => !r ? "–" : f === "auth" ? r.auth.methods.join(" + ") : f === "access" ? `dev ${r.access.dev_access} / prod ${r.access.production_access}` : f === "api" ? `${r.api.types.join(", ")} · ${r.api.breadth}` : f === "mcp" ? r.mcp.status : r.verdict;
  const hval = (f: string, h: any) => !h ? "–" : f === "auth" ? h.auth_methods : f === "access" ? `dev ${h.dev_access} / prod ${h.production_access}` : f === "api" ? `${h.api_types} · ${h.api_breadth}` : f === "mcp" ? h.mcp_status : h.verdict;
  const defSet = new Set<string>();
  const defCat = disagreements?.categories?.find((c: any) => /definition/i.test(c.cause));
  for (const it of defCat?.items ?? []) { const [app, fs] = String(it).split(":"); for (const f of fs.split(",")) defSet.add(`${app.trim()}|${f.trim()}`); }
  const detail: any[] = scores?.detail ?? [];
  const grade = (ver: string, id: number, f: string) => detail.find((d) => d.version === ver && d.id === id && d.field === f)?.grade ?? "U";
  const explorer = (sample?.picks ?? []).map((p: any) => {
    const h = human.find((x: any) => Number(x.id) === p.id), b = base.get(p.id), fr = fin.get(p.id);
    return { id: p.id, app: p.name, group: p.group, cat: p.category, fields: Object.fromEntries(GRADED.map((f) => [f, {
      human: hval(f, h), b: { v: val(f, b), g: grade("baseline", p.id, f) }, f: { v: val(f, fr), g: grade("final", p.id, f) },
      def: defSet.has(`${p.name}|${f}`),
    }])) };
  });
  const explorerHtml = `
<div class="card" style="margin-top:14px" id="explorer"><h3 style="margin-top:0">Accuracy explorer: the 20 audited apps × 5 fields</h3>
<div class="filters"><span class="seg" role="group" aria-label="Version"><button class="on" data-ver="b">First pass</button><button data-ver="f">After loop</button></span>
<label class="small"><input type="checkbox" id="xdef"> Re-grade the ${defSet.size} "paid product" cells under the rule the agent was given</label>
<label class="small"><input type="checkbox" id="xdiff"> Highlight cells the loop changed</label></div>
<div id="xsum" class="small"></div>
<div class="scroll"><table class="xg"><thead><tr><th>App</th><th>Group</th>${GRADED.map((f) => `<th>${f}</th>`).join("")}</tr></thead><tbody id="xbody"></tbody></table></div>
<div id="xdet" class="card small" style="margin-top:10px">Hover or tap a cell to compare the agent's answer with the human's.</div>
<p class="small muted"><b>About the re-grade option:</b> the audit guide given to the human (audit/HOW_TO_AUDIT.md) was written <i>before</i> the rule "a paid product with the API on every plan is not a paid-plan gate" was added to the agent's prompt. So the human graded those cells under a different definition. This was our process error. The option shows the effect of that one definition. The official numbers above stay as computed.</p>
</div>`;

  // ---------- 4. where the agent lags & how to raise accuracy ----------
  const pf = (k: string) => scores?.summary?.[k]?.perField ?? {};
  const fieldStats = GRADED.map((f) => {
    const sum = (k: string) => { const g = pf(k)[f] ?? { C: 0, I: 0, U: 0 }; return g; };
    const fb = [sum("baseline.calibration"), sum("baseline.holdout")], ff = [sum("final.calibration"), sum("final.holdout")];
    const tot = (gs: any[]) => gs.reduce((a, g) => ({ C: a.C + g.C, N: a.N + g.C + g.I + g.U }), { C: 0, N: 0 });
    return { f, b: tot(fb), fi: tot(ff) };
  }).sort((a, b) => a.fi.C / a.fi.N - b.fi.C / b.fi.N);
  const LEVERS: Record<string, { why: string; fixes: string[] }> = {
    access: { why: "Access needs two judgements (developer vs customer) and depends on pricing pages, which change often and are written for buyers, not developers.", fixes: ["<b>Rubric:</b> define 'paid product vs paid API' in the audit guide and prompt (the 9 definitional misses).", "<b>Prompt:</b> require one claim for production access taken from the pricing or plans page.", "<b>Code rule:</b> flag 'production = free' when the cited pricing page mentions 'Enterprise', 'add-on' or 'API access' near a price.", "<b>Human:</b> review queue below, sorted by access risk."] },
    verdict: { why: "The verdict depends on access, so access errors carry over into it.", fixes: ["Fix access first: R1 already makes the verdict follow access.", "Add a 'gate type' decision table (app review vs outreach vs paid) with examples, e.g. Pinterest."] },
    auth: { why: "The agent stops after finding the main method and misses a second one (Vonage OAuth2, Zoho Cliq key, Bright Data basic).", fixes: ["<b>Prompt:</b> 'list ALL methods on the auth overview page; read it fully, no focus filter'.", "<b>Code rule:</b> flag when the cached auth page mentions OAuth/API key/Basic but the record doesn't list it (cheap, no AI).", "<b>L4:</b> already catches this for apps in Composio's catalog (Neo4j fixed)."] },
    mcp: { why: "Official vs community vs announced is hard to tell from search results.", fixes: ["<b>Prompt:</b> search the vendor's own docs for 'MCP' before web search; 'official' needs a vendor-domain or vendor-GitHub-org source.", "<b>R3:</b> allow-list vendor-owned second domains to remove the false alarms."] },
    api: { why: "Mostly secondary interfaces missed (e.g. Gladly CLI); breadth is coarse.", fixes: ["Ask for SDK/CLI explicitly; count resource families from the API reference index."] },
  };
  const lagsHtml = `
<h3 id="improve">Where the agent lags, and how to raise accuracy</h3>
<div class="grid g2"><div class="card"><h3 style="margin-top:0">Correct by field (20 apps, first pass → after loop)</h3>
${fieldStats.map((s) => `<div class="hb"><span class="hbk">${s.f}</span><span class="hbb two"><span class="b" style="width:${pct(s.b.C, s.b.N)}%"></span><span style="width:${pct(s.fi.C, s.fi.N)}%"></span></span><span class="hbv">${pct(s.fi.C, s.fi.N)}%</span></div>`).join("")}
<p class="small muted">Light bar = first pass, dark bar = after loop. Weakest first. The loop helped most on auth (L4 + re-research) and verdict.</p></div>
<div class="card"><h3 style="margin-top:0">What the audit taught us</h3><ul class="small">
<li><b>No invented facts.</b> Every quote is real (L2). The remaining errors come from <b>omission</b> (a missed method or condition) and <b>definitions</b>, not fabrication.</li>
<li><b>The weakest field is access.</b> It's the one Composio cares about most (self-serve vs gated), so it gets the most fixes below.</li>
<li><b>Several misses are process issues, not model issues.</b> The rubric wasn't in the audit guide, and some human cells listed two values. Fixing the process is the cheapest accuracy gain.</li></ul></div></div>
<div class="card" style="margin-top:14px"><h3 style="margin-top:0">Next accuracy loop (proposed, not yet run or measured)</h3><div class="scroll"><table><thead><tr><th>Field</th><th>Why it lags</th><th>Fixes, cheapest first</th></tr></thead><tbody>
${fieldStats.map((s) => `<tr><td><b>${s.f}</b><div class="small muted">${pct(s.fi.C, s.fi.N)}% correct</div></td><td class="small">${LEVERS[s.f].why}</td><td class="small"><ul>${LEVERS[s.f].fixes.map((x) => `<li>${x}</li>`).join("")}</ul></td></tr>`).join("")}
</tbody></table></div>
<p class="small muted">How to measure it honestly: apply the fixes using calibration apps only, re-run the 20 audited apps (<code>npm run research -- --ids …</code>, then verify), and score the holdout once. Other general levers: run the research twice and flag any disagreement between the two runs (self-consistency), and use a browser check for JavaScript-heavy docs pages the fetch tool can't read.</p></div>`;

  // ---------- 5. human-in-the-loop map + review queue ----------
  const humanHtml = `
<div class="card"><h3 style="margin-top:0">Every point where a human was needed</h3><div class="scroll"><table><thead><tr><th>Stage</th><th>What the human did</th><th>Why the agent couldn't</th><th>Effect</th></tr></thead><tbody>
<tr><td>Scope & rubric</td><td class="small">Defined the verdict scale and what counts as a gate. After the pilot: customer admin consent is normal; vendor app review is tracked separately; a paid product ≠ a paid API.</td><td class="small">These are business definitions for Composio, not facts in any doc.</td><td class="small">Removed a whole class of wrong "conditions" verdicts (HubSpot, Close) before the 100-app run.</td></tr>
<tr><td>Tool choice</td><td class="small">Picked Composio toolkits that work without paid accounts (Keenable search/fetch); skipped Tavily/Firecrawl/Exa.</td><td class="small">Needs account and cost decisions.</td><td class="small">The whole run cost $0 in tool fees.</td></tr>
<tr><td>Pilot review & prompt freeze</td><td class="small">Read 6 pilot records, approved fixes, then froze the prompt for all 100.</td><td class="small">The agent can't judge its own rubric.</td><td class="small">Fair first-pass baseline (prompt <code>41807f85</code>).</td></tr>
<tr><td>Credentials & safety</td><td class="small">Created the Composio key, kept it in <code>.env</code>, scanned the repo before every push.</td><td class="small">Secrets must stay with a human.</td><td class="small">No secret in the repo.</td></tr>
<tr><td><b>Blind audit</b></td><td class="small">Checked 20 apps × 5 fields from official docs before seeing agent output.</td><td class="small">The ground truth can't come from the system being tested.</td><td class="small">The accuracy numbers: 56→62% and 70→76%.</td></tr>
<tr><td>Disagreement analysis</td><td class="small">Sorted all 24 remaining disagreements by cause; found the rubric missing from the audit guide.</td><td class="small">Needs judgement about who's right and why.</td><td class="small">Turned errors into the fix list above.</td></tr>
<tr><td>Rule triage</td><td class="small">Classified R3 MCP-domain flags on vendor-owned second domains as false alarms.</td><td class="small">The rule can't know which domains a vendor owns.</td><td class="small">Prevents "fixing" correct answers.</td></tr>
</tbody></table></div></div>`;

  const risk = recs.map((r) => {
    const reasons: string[] = []; let s = 0;
    if (r.confidence === "low") { s += 3; reasons.push("low confidence"); } else if (r.confidence === "medium") { s += 1; reasons.push("medium confidence"); }
    if (r.verdict === "needs_research") { s += 3; reasons.push("needs research"); }
    const cv = critic[r.id] ?? {};
    for (const [f, j] of Object.entries(cv) as [string, any][]) { if (j?.status === "contradicted") { s += 3; reasons.push(`critic: ${f} contradicted`); } else if (j?.status === "suspect") { s += 1; reasons.push(`critic: ${f} suspect`); } else if (j?.status === "insufficient") { s += 1; reasons.push(`critic: ${f} thin evidence`); } }
    const fl = (checks[r.id]?.flags ?? []).filter((f: any) => f.layer !== "L2");
    if (fl.length) { s += 2 * fl.length; reasons.push(...fl.map((f: any) => `${f.layer} ${f.field}`)); }
    if (["paid_plan", "partner_or_sales", "admin_approval", "unknown"].includes(r.access.production_access) || ["unknown"].includes(r.access.dev_access)) { s += 1; reasons.push("gated or unclear access"); }
    const audited = (sample?.picks ?? []).some((p: any) => p.id === r.id);
    return { r, s, reasons, audited };
  }).filter((x) => !x.audited).sort((a, b) => b.s - a.s).slice(0, 15);
  const queueHtml = `
<div class="card" style="margin-top:14px" id="queue"><h3 style="margin-top:0">Human review queue: the 15 riskiest unaudited records</h3>
<p class="small muted">Risk score = low/medium confidence + "needs research" + critic objections + rule/catalog flags + gated access. These are where an hour of human checking buys the most accuracy. Tick when checked (saved in your browser only). Click a name to open it in the table.</p>
<div class="scroll"><table><thead><tr><th></th><th>App</th><th>Risk</th><th>Verdict</th><th>Why it's risky</th></tr></thead><tbody>
${risk.map((x) => `<tr><td><input type="checkbox" class="qchk" data-id="${x.r.id}" aria-label="Checked ${esc(x.r.name)}"></td><td><button class="lnk" data-f="${fattr({ q: x.r.name.toLowerCase() })}">${esc(x.r.name)}</button><div class="small muted">${esc(x.r.category)}</div></td><td>${x.s}</td><td>${esc(VL[x.r.verdict] ?? x.r.verdict)}</td><td class="small">${esc([...new Set(x.reasons)].join(" · "))}</td></tr>`).join("")}
</tbody></table></div></div>`;

  // ---------- css + js ----------
  const css = `
.filters input[type=checkbox]{flex:0 0 auto;min-width:0;padding:0;margin-right:6px}.filters label{display:inline-flex;align-items:center}
.layer{margin:8px 0;padding:12px 16px}.layer summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.layer summary::-webkit-details-marker{display:none}
.lid{display:inline-grid;place-items:center;min-width:30px;height:24px;border-radius:6px;background:var(--accent);color:var(--card);font-weight:700;font-size:12px}
.lgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:10px}.lgrid table{font-size:12.5px}
.heat td,.heat th{text-align:center}.heat td:first-child,.heat th:first-child{text-align:left}
.cell{border:0;border-radius:6px;min-width:34px;padding:4px 8px;font:inherit;font-weight:600;cursor:pointer;background:color-mix(in srgb,var(--accent) calc(var(--a)*100%),transparent);color:var(--fg)}
.cell.v-build_now{background:color-mix(in srgb,var(--good) calc(var(--a)*100%),transparent)}.cell.v-build_with_conditions{background:color-mix(in srgb,var(--warn) calc(var(--a)*100%),transparent)}.cell.v-outreach_required{background:color-mix(in srgb,var(--bad) calc(var(--a)*100%),transparent)}
.cell:hover,.cell:focus-visible{outline:2px solid var(--fg)}
.lnk{border:0;background:none;padding:0;font:inherit;color:var(--accent);cursor:pointer;text-decoration:underline}
.hbar-btn{all:unset;display:contents;cursor:pointer}.hbar-btn:hover .hbk,.hbar-btn:focus-visible .hbk{color:var(--accent);text-decoration:underline}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.seg button{border:0;border-radius:0;padding:6px 12px;background:var(--card);color:var(--fg);font:inherit;font-size:13px;cursor:pointer}.seg button.on{background:var(--accent);color:var(--card)}
.xg td,.xg th{text-align:center}.xg td:first-child,.xg th:first-child,.xg td:nth-child(2){text-align:left}
.g{display:inline-block;width:34px;height:24px;line-height:24px;border-radius:5px;font-weight:700;font-size:12px;cursor:pointer}
.gC{background:color-mix(in srgb,var(--good) 28%,transparent);color:var(--good)}.gI{background:color-mix(in srgb,var(--bad) 25%,transparent);color:var(--bad)}.gU{background:var(--chip);color:var(--muted)}
.g.adj{outline:2px dashed var(--good)}.g.chg{box-shadow:0 0 0 2px var(--accent)}
.hbb.two{position:relative}.hbb.two span{position:absolute;left:0;top:0}.hbb.two span.b{opacity:.35}
#chip{display:none;align-items:center;gap:6px;background:var(--chip);border-radius:999px;padding:4px 10px;font-size:13px}#chip button{border:0;background:none;color:var(--fg);cursor:pointer;font-size:14px}
`;
  const js = `
const X=${safeJson(explorer)};
let xver="b";
function xg(c,ver){const s=c[ver];let g=s.g,adj=false;if($("#xdef").checked&&c.def&&g==="I"&&s.v===c.f.v){g="C";adj=true}return{g,adj}}
function xr(){const b=$("#xbody");let C=0,I=0,U=0,html="";for(const a of X){html+="<tr><td><b>"+a.app+"</b></td><td class='small muted'>"+a.group+"</td>";
for(const [f,c] of Object.entries(a.fields)){const {g,adj}=xg(c,xver);g==="C"?C++:g==="I"?I++:U++;const chg=$("#xdiff").checked&&c.b.v!==c.f.v;
html+="<td><span tabindex='0' class='g g"+g+(adj?" adj":"")+(chg?" chg":"")+"' data-a='"+a.id+"' data-f='"+f+"'>"+g+"</span></td>"}html+="</tr>"}
b.innerHTML=html;const N=C+I+U;$("#xsum").innerHTML="<b>"+(xver==="b"?"First pass":"After loop")+":</b> "+C+" correct, "+I+" incorrect, "+U+" unresolved of "+N+" → <b>"+Math.round(100*C/N)+"% correct</b>"+($("#xdef").checked?" <span class='muted'>(with the paid-product re-grade; official numbers are above)</span>":"");}
function xd(e){const t=e.target.closest(".g");if(!t)return;const a=X.find(x=>x.id==t.dataset.a),c=a.fields[t.dataset.f];
$("#xdet").innerHTML="<b>"+a.app+" · "+t.dataset.f+"</b> ("+a.group+")<br>Human: <code>"+c.human+"</code><br>First pass: <code>"+c.b.v+"</code> → "+c.b.g+"<br>After loop: <code>"+c.f.v+"</code> → "+c.f.g+(c.def?"<br><i>Definitional: the human applied 'paid product = paid plan'; the agent's rubric says it isn't.</i>":"")+(c.b.v!==c.f.v?"<br><i>Changed by the verification loop.</i>":"");}
document.querySelectorAll("[data-ver]").forEach(b=>b.onclick=()=>{xver=b.dataset.ver;document.querySelectorAll("[data-ver]").forEach(x=>x.classList.toggle("on",x===b));xr()});
["#xdef","#xdiff"].forEach(s=>$(s).addEventListener("change",xr));$("#xbody").addEventListener("mouseover",xd);$("#xbody").addEventListener("focusin",xd);$("#xbody").addEventListener("click",xd);xr();
// clickable clusters -> filter the table
document.addEventListener("click",e=>{const t=e.target.closest("[data-f]");if(!t||t.closest("#xbody"))return;const o=JSON.parse(t.dataset.f);
["#q","#fc","#fv","#fm","#fx"].forEach(s=>$(s).value="");for(const k in ext)delete ext[k];
if(o.q)$("#q").value=o.q;if(o.cat)$("#fc").value=o.cat;if(o.verdict)$("#fv").value=o.verdict;if(o.mcp)$("#fm").value=o.mcp;if(o.composio)$("#fx").value=o.composio;
for(const k of ["auth","blocker","review"])if(o[k])ext[k]=o[k];f();document.getElementById("matrix").scrollIntoView({behavior:"smooth"});});
// review queue ticks (per-viewer convenience only)
document.querySelectorAll(".qchk").forEach(c=>{try{c.checked=localStorage.getItem("q"+c.dataset.id)==="1"}catch(e){}c.onchange=()=>{try{localStorage.setItem("q"+c.dataset.id,c.checked?"1":"0")}catch(e){}}});
`;
  return { checksHtml, clustersHtml, explorerHtml, lagsHtml, humanHtml, queueHtml, css, js, rowAttrs: (r: AppRecord) => `data-auth="${esc(r.auth.methods.join(" "))}" data-blocker="${esc(primaryBlocker(r))}" data-review="${esc(r.access.public_app_review)}"` };
}
