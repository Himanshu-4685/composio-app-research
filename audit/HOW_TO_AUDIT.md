# How to do the blind audit

You are the ground truth. The agent's accuracy is measured against what you write here,
so **do not look at any agent output for these 20 apps** (`runs/` folder, terminal logs)
until your row is filled in.

**File:** `audit/human.csv` (open in Excel or VS Code). One row per app, 20 rows.
**Time box:** about 4 minutes per app. If you can't decide within the time, write `unknown` and a note.
That's a valid answer, and better than a guess.

## Steps for each app
1. Google `<app> API authentication` and `<app> API pricing` (or `<app> developer`). Use **official** pages only:
   vendor docs, help centre, pricing page, vendor GitHub.
2. Fill in the columns below. Separate multiple values with `;` (e.g. `oauth2;api_key`).
3. Paste the 1–3 URLs you relied on into `source_urls` (separated by spaces).

## Columns and allowed values

| Column | Allowed values | Question you're answering |
|---|---|---|
| `auth_methods` | `oauth2` `api_key` `personal_token` `basic` `service_account_or_jwt` `none` `other` | How does a developer **get** credentials? ("Bearer header" is how it's sent, not a method.) |
| `dev_access` | `free` `free_trial` `paid_plan` `admin_approval` `app_review` `partner_or_sales` `not_applicable` `unknown` | Can a developer get working credentials to build/test? What does it take? |
| `production_access` | same as above | What does a **customer** need for the API to work in their account (e.g. API only on a paid tier)? |
| `public_app_review` | `yes` `no` `unknown` `not_applicable` | Must the vendor approve/verify/publish a third-party OAuth app before it serves many customers? |
| `api_types` | `rest` `graphql` `sdk` `cli` `webhooks` `soap` `other` `none_found` | What documented interfaces exist? |
| `api_breadth` | `narrow` (1–2 resource families) `moderate` (3–5) `broad` (6+) `unknown` | How much can you do? |
| `mcp_status` | `official` `community` `announced` `none_found` `unknown` | Search `<app> MCP server`. Official = published by the vendor. |
| `verdict` | `build_now` `build_with_conditions` `outreach_required` `limited` `needs_research` | See the rubric below |

## Rules to apply (same as the agent's)
- A customer's own admin clicking "Allow" or creating a key is **normal**. It's not `admin_approval`.
- Vendor review of a public OAuth app goes in `public_app_review` and does **not** by itself change the verdict.
- "Can't find an API" ≠ "no API". Use `none_found` / `unknown` and add a note.

| Verdict | When |
|---|---|
| `build_now` | Useful API + a developer gets credentials free or on a trial + no unresolved gate |
| `build_with_conditions` | Feasible but needs a named thing: paid plan/tier with API, unusual admin enablement, etc. |
| `outreach_required` | Partnership / sales / vendor approval needed before **any** developer access |
| `limited` | Positive evidence of a big restriction (no public API, read-only, deprecated) |
| `needs_research` | You genuinely can't tell |

## How it's scored
Five fields are graded per app: **auth**, **access** (dev + production), **API** (types + breadth),
**MCP**, **verdict**. Each gets C (correct) / I (incorrect) / U (unresolved). `public_app_review`
is recorded for the patterns, not graded. Calibration rows may be used to improve the agent.
Holdout rows are scored once at the end.
