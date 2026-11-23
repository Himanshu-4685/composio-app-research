# App toolkit research agent

An agent that researches whether an app can become an AI-agent toolkit (for Composio), plus a
verification loop that measures and improves its accuracy.

**Case study (live page):** see the GitHub Pages link in the repo description. It is built from `site/index.html`.

For each app it records: category and one-line summary, **auth methods**, **developer vs production access**
(self-serve / paid tier / admin / partner), **public OAuth app review**, **API surface** and breadth, **MCP**
(official / community / none), a **buildability verdict** with the main blocker, and **evidence**: every claim has
a URL plus a verbatim quote from that page.

## How it works

```
apps.json ─► research agent (Claude Agent SDK, Sonnet)
               tools: web_search, fetch_page  ── executed via Composio SDK (Keenable toolkit), served as MCP tools
               └─► schema-validated record + quotes ─► runs/<id>/baseline.jsonl  (frozen first pass)
verification:
  L1 rules (code)          contradictions, missing evidence, MCP domain checks
  L2 quote check (code)    every quote must appear on its cited page
  L3 critic agent          fresh context; judges each field: supported / contradicted / insufficient / suspect
  L4 Composio catalog      Composio's own auth schemes must be a subset of ours
  L5 re-research           only flagged apps, with the objections in the prompt ─► final.jsonl + corrections.jsonl
  Human audit              20 apps (seeded sample, calibration + holdout), blind ─► audit/scores.json
render ─► site/index.html (+ site/data/records.json|csv, summary.md)
```

Design and plan: [docs/DESIGN.md](docs/DESIGN.md), [docs/PLAN.md](docs/PLAN.md). Prompts: [prompts/](prompts/).

## Run it

Requires Node 22+, a [Composio](https://platform.composio.dev) API key, and either a Claude Code login on the
machine or `ANTHROPIC_API_KEY`.

```bash
npm install
cp .env.example .env                   # add COMPOSIO_API_KEY (and optionally ANTHROPIC_API_KEY)
npm run preflight                      # 1 Composio search + 1 fetch + catalog + agent smoke test

# Research ANY app (not just the 100) and print the record
npm run research -- --app "Calendly" --hint calendly.com

# Local web UI with a "Research any app" box (http://127.0.0.1:8787)
npm run ui

# The full study
npm run research -- --all --run baseline-v1 --concurrency 2   # resumable
npm run verify -- --run baseline-v1 --stage checks            # L1, L2, L4 (no LLM)
npm run verify -- --run baseline-v1 --stage critic            # L3
npm run verify -- --run baseline-v1 --stage fix               # L5 (trimmed); --mode full re-researches deferred apps
npm run evaluate -- --run baseline-v1                         # score vs audit/human.csv
npm run render -- --run baseline-v1                           # rebuild site/ from saved data (no network)

npm run finish -- --run baseline-v1    # does all remaining stages; safe to re-run after a usage-limit reset
```

## Where a human was involved
- Rubric decisions after the pilot (customer admin consent is normal; vendor app review tracked separately; a paid product ≠ a paid API).
- Freezing the prompt before the 100-app baseline.
- The blind audit (`audit/human.csv`, guide in [audit/HOW_TO_AUDIT.md](audit/HOW_TO_AUDIT.md)).
- Resuming after Claude Pro usage-limit resets.

## Limits
Findings come from official docs and were not tested with authenticated API calls. The 20-app audit measures the
sample, not an exact accuracy for all 100. Fetched page text is cached locally (`.cache/`, not committed); `runs/`
holds every record, flag, critic judgment and correction.
