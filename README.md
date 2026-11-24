# App toolkit research agent

An agent that researches whether an app can become an **AI-agent toolkit for Composio**. For 100 requested
apps it determines auth, self-serve vs gated access, API surface, MCP availability and a buildability
verdict, **every claim backed by a verbatim quote from an official page**. It then checks its own
answers through a layered verification loop and measures accuracy against a **blind human audit**.

- **Live case study:** https://himanshu-4685.github.io/composio-app-research/
- **Research any new app locally:** `npm run ui` → http://127.0.0.1:8787
- **Re-run the study with another model / prompt / rubric:** `npm run ui` → http://127.0.0.1:8787/experiment

---

## Contents
1. [Results at a glance](#1-results-at-a-glance)
2. [How it works](#2-how-it-works)
3. [The record: what is captured per app](#3-the-record-what-is-captured-per-app)
4. [The rubric: how findings are classified](#4-the-rubric-how-findings-are-classified)
5. [Verification loop (L1–L5 + human audit)](#5-verification-loop-l1l5--human-audit)
6. [Measuring accuracy](#6-measuring-accuracy)
7. [Where a human was needed](#7-where-a-human-was-needed)
8. [Experiments: other models, prompts, rubrics](#8-experiments-other-models-prompts-rubrics)
9. [Adding new apps](#9-adding-new-apps)
10. [Setup and commands](#10-setup-and-commands)
11. [Repository layout](#11-repository-layout)
12. [Design decisions and trade-offs](#12-design-decisions-and-trade-offs)
13. [Limitations](#13-limitations)

---

## 1. Results at a glance

| | Count (of 100) |
|---|---|
| **Build now**: documented API, free/trial developer access, API on all plans | **58** |
| **Build with conditions**: feasible but needs a named condition (API tier, vendor app approval, org admin enablement) | **32** |
| **Outreach required**: sales/partner contact before any developer access | **6** (DealCloud, Gladly, Aircall, Salesforce Commerce Cloud, Waterfall.io, PitchBook) |
| **Limited / needs research** | **4** (Mermaid CLI limited; Sherlock, Datadog, Paygent Connect unclear) |
| Already a toolkit in Composio's catalog | **74** |

**Patterns**
- **Auth isn't the bottleneck; access is.** 72/100 offer OAuth2, 83/100 an API key or personal token, and 58 offer both.
  The blockers are commercial: paid tier / API add-on (16), vendor approval of a public OAuth app (10), partner/sales gate (6).
- **Self-serve varies by category.** Developer/infra (10/10 self-serve) and productivity (9/10) are wide open.
  Finance/fintech (6/10) and AI/media (7/10) are the most gated. Marketing/ads and fintech have the most "with conditions" verdicts.
- **Easy wins not yet in Composio (11):** LiveAgent, Vonage, GoHighLevel, systeme.io, WooCommerce, Amazon Selling Partner,
  SE Ranking, Netlify, MongoDB Atlas, Binance, Reducto.
- **MCP is mainstream:** 85/100 publish an official MCP server (see the limitations for how reliable that label is).
- **Vendor app review matters for Composio specifically:** 33 apps require the vendor to approve a third-party OAuth app before it
  can serve many customers (e.g. HubSpot Marketplace, Attio's 25-workspace cap for unpublished apps). It doesn't block building,
  but Composio's shared OAuth app needs that approval to scale.

**Accuracy vs blind human audit (20 apps × 5 fields)**

| | First pass | After verification loop |
|---|---|---|
| Calibration (10 apps, may guide fixes) | 56% | **62%** |
| Holdout (10 apps, scored only) | 70% | **76%** |

All **721 evidence quotes** were found verbatim on their cited pages, so the agent never fabricated a quote.

---

## 2. How it works

```
data/apps.json (100 apps)            any new app (CLI / local UI)
          │                                   │
          ▼                                   ▼
┌──────────────────────── research agent (one app) ────────────────────────┐
│ Claude Agent SDK (Sonnet)  — or any OpenRouter model in experiments       │
│ tools: web_search, fetch_page  →  executed via Composio SDK (Keenable)    │
│        served to the agent as MCP tools; every fetched page is cached     │
│ loop: decide what to read next → read → decide … (≤12 searches, ≤14 fetches) │
│ output: schema-validated JSON record; every claim = URL + verbatim quote  │
└───────────────────────────────────────────────────────────────────────────┘
          │  runs/<run>/baseline.jsonl   (first pass, frozen, never edited)
          ▼
   L1 rule checks (code) → L2 quote check (code) → L3 critic agent (AI)
   → L4 Composio catalog cross-check (API) → L5 targeted re-research (agent)
          │  runs/<run>/final.jsonl + corrections.jsonl (before → after → why)
          ▼
   Blind human audit (20 apps) → audit/scores.json → analysis → site/index.html
```

**Why an agent and not a script:** the research path is different for every app (some have one auth page,
others need pricing pages, help-centre articles, release notes or GitHub). The model decides *what to read
next*; the code decides the rules: which tools exist, call budgets, the output schema, where evidence is
stored and how it is checked. In short: **the model does the judging, the code enforces discipline.**

**Why Composio for the tools:** search and fetch go through `@composio/core` sessions
(`KEENABLE_SEARCH_WEB_PUBLIC`, `KEENABLE_FETCH_URL_PUBLIC`, which need no extra account). They are wrapped
as in-process MCP tools so every call can be logged, budgeted and **its page text cached**. The cache is what
lets L2 re-check quotes and lets the critic see exactly what the agent saw. Composio's **toolkit catalog API**
(1,842 toolkits) is used separately as an independent check on auth (L4) and to find gaps ("easy wins not in
Composio").

---

## 3. The record: what is captured per app

Defined in [`src/schema.ts`](src/schema.ts) (zod). The agent's output must validate against it.

| Field | Values | Meaning |
|---|---|---|
| `identity` | canonical name, website, docs URL, note | Resolves ambiguous names (Close, Plain, Front, Grain, Sherlock) via the hint domain |
| `summary` | one sentence | What the product does |
| `auth.methods` | `oauth2` `api_key` `personal_token` `basic` `service_account_or_jwt` `none` `other` | How a developer **obtains** credentials. "Bearer header" is transport, not a method. |
| `access.dev_access` | `free` `free_trial` `paid_plan` `admin_approval` `app_review` `partner_or_sales` `not_applicable` `unknown` | What a developer needs to build and test |
| `access.production_access` | same | What a customer needs for the API to work in their account |
| `access.public_app_review` | `yes` `no` `unknown` `not_applicable` | Must the vendor approve a third-party OAuth app before it serves many customers? |
| `access.gates` | list | Every condition found, in words |
| `api.types` / `api.breadth` | REST, GraphQL, SDK, CLI, webhooks… / narrow (1–2 resource families), moderate (3–5), broad (6+) | API surface |
| `mcp.status` | `official` `community` `announced` `none_found` `unknown` | Official = published by the vendor |
| `verdict` + `blocker` | see rubric | Buildability and the main blocker |
| `confidence`, `open_questions` | | Uncertainty is recorded, not hidden |
| `claims[]` | `{field, text, url, quote}` | **Evidence**: verbatim quote (10–40 words) from a page the agent fetched |

---

## 4. The rubric: how findings are classified

The **rubric** is the rule book of definitions: the *conditions* used to label findings. It is not the agent.
The agent applies it while researching, the critic checks against it, the L1 rules enforce parts of it in code,
and the human auditor applies it to produce ground truth. It lives inside the research prompt
([`prompts/research.md`](prompts/research.md)).

**Verdicts**

| Verdict | Definition |
|---|---|
| `build_now` | Useful documented API + a developer can get credentials free or on a trial + no unresolved material gate |
| `build_with_conditions` | Feasible, but needs a named condition: API tier/add-on, unusual org-admin enablement, vendor app approval for production access |
| `outreach_required` | A partnership, sales contact or vendor approval is needed before **any** developer access |
| `limited` | Positive evidence of a material restriction (no public API, read-only, local-only tool) |
| `needs_research` | Evidence missing, ambiguous or conflicting. Absence from search ≠ "no API". |

**Definitions decided by a human after the pilot (rubric v1, used for the 100-app baseline)**
1. A customer's own admin clicking "Allow" or creating a key is **normal**, not `admin_approval`.
2. Vendor review of a public OAuth app goes in `public_app_review` and **does not by itself change the verdict**.
3. A **paid product with the API on every plan is not a paid-plan gate** (`production_access = free`); `paid_plan` only for a higher tier / add-on / separate API purchase.

**Rubric v2 (experiments):** rule 3 changed to "**any paid plan required = `paid_plan`**", matching how the human audit was
done. See [`prompts/research_v2_rubric.md`](prompts/research_v2_rubric.md) and section 8.

---

## 5. Verification loop (L1–L5 + human audit)

A flag never edits a record by itself; it sends the app back to research (L5) with the objection attached.
Every change is logged in `runs/<run>/corrections.jsonl` as `{field, before, after, triggered_by, issues}`.

### L1 — Rule checks (code, no AI) · [`src/verify/checks.ts`](src/verify/checks.ts)
| Rule | Logic | Catches |
|---|---|---|
| R0 Research completed | failed/timed-out runs are flagged and retried | silent gaps |
| R1 Verdict follows access | re-derives the verdict from dev + production access and compares | self-contradiction (pilot: HubSpot/Close got "conditions" only for app review) |
| R2 Every field has evidence | auth, access, API (and positive MCP) each need ≥1 claim | unsupported fields |
| R3 Official MCP on vendor domain | an official MCP URL must be on the vendor's site/docs domain or GitHub | third-party servers labelled official (false alarms on vendor-owned second domains such as sentry.dev) |
| R4 API needs an auth method | API found ⇒ ≥1 auth method | skipped auth field |
| R5 Breadth matches resources | broad ⇒ ≥5 listed resource families; narrow ⇒ ≤3 | inflated/deflated breadth |
| R6 Confidence matches evidence | high confidence ⇒ ≥3 claims | over-confidence |

### L2 — Quote check (code) · `quoteChecks()`, `matchQuote()`
For every claim, the cached page and the quote are normalised (markdown, link targets, curly quotes, dashes, whitespace)
and the quote must appear on the page. Fallback: a near match if ≥80% of the quote's 5-word shingles are on the page.
**Result: 721/721 verbatim.** It proves quotes are real, but not that they are *interpreted* correctly.

### L3 — Critic agent (AI, separate) · [`src/verify/critic.ts`](src/verify/critic.ts), [`prompts/critic.md`](prompts/critic.md)
A second model call with a **fresh context and no tools**, prompted to find errors. It sees the record plus a ±700-character
excerpt around each quote and labels each field `supported` / `contradicted` / `insufficient` / `suspect`
("from what I know, a condition is probably missing: go check"). Its suspicions are only acted on through L5 re-research with sources.

### L4 — Composio catalog cross-check (API, no AI) · [`src/verify/catalog.ts`](src/verify/catalog.ts)
Downloads Composio's toolkit catalog, matches the app, maps scheme names (OAUTH2 → oauth2, API_KEY/BEARER_TOKEN →
api_key/personal_token, BASIC, SERVICE_ACCOUNT…), and flags any Composio scheme our record doesn't list. It is a
**subset** check, because Composio may implement fewer methods than a vendor offers. It caught OAuth2 missing for Ahrefs,
Neo4j and Datadog (Neo4j fixed by re-research).

### L5 — Targeted re-research (agent) · [`src/verify/run.ts`](src/verify/run.ts) stage `fix`
Each flagged app is researched again with its issues and previous record in the prompt. The agent must verify each issue
against official sources, keep what is right, fix what is wrong, and fall back to `unknown`/`needs_research` rather than guess.
**Result: 36 apps changed, 69 field changes, 22 verdict changes.**

### Human — Blind audit · [`audit/`](audit/), [`src/evaluate.ts`](src/evaluate.ts)
20 apps (2 per category, seed `20261123`, pilot apps excluded), split into 10 **calibration** and 10 **holdout**.
The human filled 5 fields per app from official docs *before* seeing agent output ([`audit/HOW_TO_AUDIT.md`](audit/HOW_TO_AUDIT.md)).

---

## 6. Measuring accuracy

Each audited field is graded **C** (correct), **I** (incorrect) or **U** (unresolved: the agent or the human said unknown).

| Field | Rule |
|---|---|
| auth | same set of methods (`api_key` ≡ `personal_token`) |
| access | dev **and** production both match |
| API | same core type (REST/GraphQL/CLI/SOAP) and breadth within one step |
| MCP | exact |
| verdict | exact |

Reported as "correct of all fields" = C / (C + I + U), so unknowns count against the agent, and
"correct of decidable" = C / (C + I). Calibration and holdout are reported separately. **Holdout is the honest test:
it was never used to tune anything.**

**Why the remaining 24 final fields disagree** ([`audit/disagreements.json`](audit/disagreements.json)):

| Cause | Fields |
|---|---|
| Definition: "paid product = paid plan?" (the audit guide didn't state the rubric rule, which was our process error) | 9 |
| Agent missed a second auth method (Vonage OAuth2, Zoho Cliq key, Bright Data basic, Snowflake other) | 4 |
| MCP classification (official / community / announced) | 3 |
| Gate type (app review vs outreach vs paid) | 3 |
| API types / breadth | 2 |
| Human listed two values (strict grader counts a miss) | 2 |
| Verdict judgement | 1 |

**Takeaway:** no fabricated facts. The errors are **omissions** and **definitions**, and both are fixable (see section 8).

---

## 7. Where a human was needed

| Stage | Human action | Why not the agent |
|---|---|---|
| Scope and rubric | Defined verdicts and gates; after the pilot ruled on admin consent, app review, paid product | Business definitions for Composio, not facts in any doc |
| Tool choice | Chose Composio toolkits that work without paid accounts | Cost and account decisions |
| Pilot review and prompt freeze | Reviewed 6 pilot records, approved fixes, froze the prompt for all 100 | The agent can't judge its own rubric; freezing keeps before/after fair |
| Credentials and safety | Created keys, kept them in `.env`, scanned before every push | Secrets stay with a human |
| Blind audit | 20 apps × 5 fields from official docs | Ground truth can't come from the system under test |
| Disagreement analysis | Classified every remaining disagreement by cause | Needs judgement about who is right and why |
| Rule triage | Classified R3 false alarms on vendor-owned second domains | A rule can't know which domains a vendor owns |

The page also has a **review queue**: the 15 riskiest unaudited records ranked by risk (low confidence, needs research, critic
objections, rule/catalog flags, gated access). That's where the next hour of human checking buys the most accuracy.

---

## 8. Experiments: other models, prompts, rubrics

Re-run the study with a **different model** (any tool-calling model on OpenRouter, or Claude), a **different prompt/rubric**
and a **different L1 rule set**, without touching the baseline. Each experiment writes only to `runs/<name>/`
(protected names `baseline-v1` and `pilot*` are refused) and is scored against the **same 20 human answers**, so runs compare like for like.

**From the browser:** `npm run ui` → http://127.0.0.1:8787/experiment. Pick an engine and model, choose or edit the prompt
(edits are saved as `prompts/exp-<name>.md`), the critic prompt, which rules R0–R6 apply, and the scope (20 audited or all 100). The log
streams live and the comparison table updates.

**From the CLI:**
```bash
# .env: OPENROUTER_API_KEY=...
npm run experiment -- --config experiments/or-rubric-v2.json             # 20 audited apps
npm run experiment -- --config experiments/or-rubric-v2.json --scope all # all 100
npm run compare                                                           # all runs vs the human audit
```

Prepared configs ([`experiments/`](experiments/)):

| Config | What changes | Purpose |
|---|---|---|
| `or-rubric-v2.json` | OpenRouter model + rubric v2 (paid product = paid plan) | Model + definition change |
| `claude-rubric-v2.json` | Claude + rubric v2 | Isolates the rubric change from the model change |
| `or-v3-lessons.json` | OpenRouter + rubric v2 + calibration lessons (list every auth method, vendor-first MCP search, production access from the pricing page) | Tests the prompt fixes the audit suggested |

The OpenRouter engine ([`src/agent/openrouter.ts`](src/agent/openrouter.ts)) is a standard tool-calling loop that uses the **same
Composio-backed tools, budgets, page cache and schema**. The final record is submitted through a `submit_record` tool and validated
with zod (with up to 2 repair attempts). Cost per app comes from OpenRouter's usage report.

**Doing it honestly:** tune using calibration apps only, and score the holdout once per configuration. If a run is tuned until the
holdout rises, the holdout stops being a test.

---

## 9. Adding new apps

```bash
npm run research -- --app "Calendly" --hint calendly.com --category "Scheduling" --add
```
or tick **"Add to the case-study list"** in the local UI. The app is researched by the same agent, then checked (rules, quotes, critic),
saved to `data/added.jsonl` with id 101+, and the page is rebuilt. Added apps appear in the table tagged *"Added later · automated checks
only"* and are **excluded from all study statistics** (those describe the audited 100). Commit and push `site/` + `data/added.jsonl` to publish.

---

## 10. Setup and commands

Requires **Node 22+**, a **Composio API key**, and either a **Claude Code login** on the machine or `ANTHROPIC_API_KEY`.
`OPENROUTER_API_KEY` is optional, for experiments only.

```bash
npm install
cp .env.example .env          # COMPOSIO_API_KEY=..., optional ANTHROPIC_API_KEY / OPENROUTER_API_KEY
npm run preflight             # 1 Composio search + 1 fetch + catalog lookup + agent smoke test
```

| Command | What it does |
|---|---|
| `npm run research -- --app "X" [--hint d] [--add]` | Research one app (any app) |
| `npm run research -- --all --run <id> [--concurrency 2]` | Research the 100 (resumable, so it skips finished apps) |
| `npm run verify -- --run <id> --stage checks\|critic\|fix [--mode full]` | L1+L2+L4 / L3 / L5 |
| `npm run evaluate -- --run <id>` | Score vs `audit/human.csv` → `runs/<id>/scores.json` |
| `npm run analyze -- --run <id>` | Patterns → `runs/<id>/analysis.json` |
| `npm run render -- --run baseline-v1` | Rebuild `site/` from saved data (no network, no LLM) |
| `npm run finish -- --run <id>` | Run every remaining stage, safe to repeat |
| `npm run experiment -- --config <file>` | Model/prompt/rubric experiment (section 8) |
| `npm run compare` | All runs vs the human audit |
| `npm run ui` | Local UI: research any app, add to list, experiments |

---

## 11. Repository layout

```
data/apps.json             the 100 apps (exactly as given)    data/added.jsonl   apps added later
prompts/                   research.md (rubric v1, baseline), research_v2_rubric.md, research_v3.md, critic*.md
experiments/               experiment configs
src/agent/                 research.ts (Claude Agent SDK), openrouter.ts (OpenRouter engine), tools.ts (Composio tools + page cache)
src/verify/                checks.ts (L1, L2), critic.ts (L3), catalog.ts (L4), run.ts (orchestration + L5)
src/evaluate.ts            grading vs human audit           src/analyze.ts   patterns
src/render.ts, render_extra.ts   the case-study page       src/server.ts, src/ui/   local UI
src/experiment.ts          experiment runner + comparison  src/added.ts     add-to-list
runs/baseline-v1/          baseline.jsonl (frozen first pass), final.jsonl, corrections.jsonl, verify/, trace.jsonl, prompt.md
runs/pilot*/               the 6-app pilot that shaped the rubric
audit/                     sample.json (seed), human.csv (blind audit), scores.json, disagreements.json, HOW_TO_AUDIT.md
site/                      the published page + data/records.json|csv, summary.md (machine-readable)
docs/                      PLAN.md, DESIGN.md
```

---

## 12. Design decisions and trade-offs

- **Quote-backed claims.** Requiring a verbatim quote per claim turns "did the agent make this up?" into a cheap, deterministic check (L2).
- **Frozen first pass.** The baseline file is never edited; fixes go to `final.jsonl` with a correction log, so the before/after comparison is real.
- **Calibration vs holdout.** Only calibration findings may change the process; holdout measures whether improvements generalise.
- **Flags don't auto-edit.** Rules and the critic can be wrong (R3 false alarms, critic hallucination), so they trigger re-research with sources instead of overwriting answers.
- **Composio catalog as an oracle.** It's independent of our agent; using a subset check accounts for Composio implementing fewer auth methods than a vendor offers.
- **Static page, local agent.** The published page needs no backend and exposes no keys; the agent (and experiments) run locally with the user's keys.
- **Pluggable engine.** Claude Agent SDK for the baseline; an OpenRouter tool-calling loop for model comparisons, with the same tools, schema and checks.

## 13. Limitations

- **Docs-checked, not call-tested:** no authenticated API calls were made to the 100 apps.
- **A 20-app audit is a sample:** the rates describe the sample, not an exact accuracy for all 100.
- **The weakest fields are access (45% correct after the loop) and verdict (60%).** Pricing pages are ambiguous and the "paid product" definition differed between the audit guide and the agent's rubric.
- **The MCP "official" label may be over-applied** (85/100). In the audit the MCP field was 80% correct.
- **The critic is also an LLM:** its notes are prompts for re-research, not truth.
- **Composio's catalog covers 74/100 apps;** L4 can't check the rest.
- **Fetched page text is cached locally (`.cache/`)** and not committed (third-party content); `runs/` keeps every record, flag, critic judgement and correction.
