# Plan: App Research Agent for Composio

> Version 1.0, 23 Nov 2026 17:15 IST. Builds on `Composio_Assignment_Plan.docx` and
> records the decisions made since then. **No research results exist yet.**

## 1. Goal in one sentence

Build an agent that researches whether an app can become a Composio toolkit. Run it on
the 100 given apps, **show with numbers that its answers are correct**, find the
patterns, and present everything on one page. Reviewers can also type in any *new*
app and watch the same agent research it.

## 2. Decisions made

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Language | **TypeScript on Node 22** | Already installed (Python isn't). Composio and Claude have TS SDKs. The same code runs the CLI and the web endpoint. |
| D2 | LLM | **Claude Agent SDK on your Claude Code login** for local and batch runs. Also accepts `ANTHROPIC_API_KEY`. | You have Claude Code. A key is needed only for the hosted box (see D4). |
| D3 | Research tools | **Composio SDK → Keenable public search + fetch** (no extra account needed), served to the agent as MCP tools. Composio catalog used for the auth cross-check. | Confirmed by preflight (DESIGN §7). Tavily/Firecrawl need their own accounts, so they're skipped. |
| D4 | Apps outside the 100 | **Local only.** `npm run ui` opens a local page with a "Research any app" box. `npm run research -- --app "X"` does the same from the terminal. The live page has a "Try any app" section with the 2 commands and **2–3 recorded runs of apps outside the 100**, clearly labelled as recordings. | No API key, so nothing hosted can call the LLM. Reviewers with Claude Code or an `ANTHROPIC_API_KEY` can run it in about 2 minutes. |
| D5 | Deadline | **Submit by ~23:00 IST tonight** | The brief's "<8 hrs after receiving" hint (received 15:00). |
| D6 | Hosting | **Static page only** (GitHub Pages or Vercel) and a public GitHub repo | No backend needed, because the page is built from saved data. |

## 3. What "done" means

1. `data/apps.json`: exactly the 100 apps, IDs 1–100.
2. A **first-pass run** saved unchanged (`baseline.jsonl`), and a **final** version
   after verification (`final.jsonl`), plus a log of every change with the reason.
3. A **human audit** by you of 20 apps (10 calibration + 10 holdout), scored
   for both baseline and final, so we can show the accuracy change honestly.
4. Patterns calculated from the final data, not decided in advance.
5. One live HTML page: headline patterns → priorities → verification → filterable
   100-app matrix → how the agent works → the research box → how to reproduce.
6. A repo with a README: install, one-app run, full run, verify, render.
7. You can explain one full record, one real correction, and the architecture.

## 4. Schedule (now → 23:00)

Steps marked **[YOU]** need your time and judgment. The rest runs while you do them.

| Time | Step | Exit condition |
|---|---|---|
| 17:15–17:40 | Review PLAN + DESIGN, ask questions, lock decisions | You can explain the verdict scale and the verification loop |
| 17:40–18:20 | Setup and **preflight**: Composio key, Agent SDK auth, one search call + one fetch call | Real tool calls succeed, or we choose a fallback and note it |
| 18:20–18:45 | **One app end to end** (e.g. Attio), then a **5-app pilot** (OAuth, API key, gated, CLI, ambiguous) | Records validate. Schema fixed *before* scaling. |
| 18:45–19:45 | **Run all 100** (3 at a time, resumable). **Baseline frozen** afterwards. | 100 records or explicit "failed / unresolved" |
| 18:45–19:45 | **[YOU] Blind audit**: fill the worksheet for the 20 sampled apps *before seeing agent output* | 20 × 5 fields with your answer and source URL |
| 19:45–20:35 | **Verification loop**: deterministic checks → evidence check → critic agent → targeted re-research → Composio catalog cross-check | `final.jsonl` + `corrections.jsonl` |
| 20:35–20:50 | Score baseline vs final on calibration, fix general rules, score holdout once | Accuracy table with counts |
| 20:50–21:15 | Pattern analysis | Headline + 4–6 patterns with numbers |
| 21:15–22:15 | Build the page and the research box | Page works offline from saved data |
| 22:15–22:45 | Repo, README, deploy, check in a signed-out window | Both links open for a stranger |
| 22:45–23:00 | Buffer, then **[YOU]** submit | — |

**If we fall behind, cut in this order:** visual polish → local UI (keep the CLI) →
browser-check layer. **Never cut:** baseline freeze, human audit, honest reporting.

## 5. Your human audit (most important task for you)

- 20 apps, 2 per category, picked with a recorded random seed. Within each category,
  one is **calibration** and one is **holdout**. The pilot apps are excluded.
- For each app, check 5 fields: **auth**, **credential access (self-serve/gated)**,
  **API surface**, **MCP**, **buildability**. I prepare a worksheet with the doc links.
- Do it **blind**, before looking at the agent's answer. That keeps your check
  independent.
- Scoring per field: **C** supported, **I** incorrect, **U** unresolved. We report
  `C/N` and `C/(C+I)` with the raw counts.
- Calibration results can change the process. Holdout results are scored once
  on the frozen final data. Any later fixes are marked "after audit".
- Expected time: about 4 minutes per app, about 80 minutes total.

## 6. Pattern questions (answers come from the data only)

1. Which auth methods dominate, overall and per category? (They overlap, so totals exceed 100%.)
2. Which categories are self-serve and which are gated, and what kind of gate (paid / admin / review / partner)?
3. The most common blocker.
4. Easy wins: Build now + broad API + self-serve.
5. Outreach list: partner or sales gated.
6. Where an official MCP server already exists, and whether Composio already has a toolkit.
7. Which fields were hardest for the agent (from verification). This is a finding about the process itself.

## 7. Honesty rules (on the page as well)

- No made-up results, baselines, human checks or API calls.
- "No public API found in docs" ≠ "has no API".
- Checking docs ≠ making a live authenticated API call. The page says which was done.
- Failures and wrong answers are shown, with examples.
- New-app results from the box are labelled "automated check only, not human audited".

## 8. Open questions for you

1. ~~Anthropic API key for a hosted box~~ → decided: local only (D4).
2. **Static hosting**: GitHub Pages (needs only your GitHub account) or Vercel.
3. **Composio**: please create an account at composio.dev and keep the API key ready.
   You'll paste it into `.env` yourself, never into chat.
