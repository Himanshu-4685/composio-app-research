# App toolkit research: summary (machine-readable)

Run baseline-v1. 100 apps. Source of truth: records.json.

## Headlines
- 70 of 100 apps can be built as agent toolkits today: documented API, and a developer can get credentials free or on a trial.
- Auth is not the bottleneck; access is. 68/100 offer OAuth2, 84/100 offer an API key or personal token, and 55 offer both. The real blockers are commercial: paid tier or API add-on (12), vendor app approval (8), partner / sales gate (5).
- Self-serve varies by category. Most open: Developer, Infra and Data platforms (10/10), CRM and Sales (9/10). Most gated: Ecommerce (6/10), AI, Research and Media-native (7/10).
- 74/100 already exist in Composio's catalog. Of the 26 that don't, 13 are "build now": the easiest new toolkits (LiveAgent, Vonage, GoHighLevel, systeme.io, WooCommerce, Magento (Adobe Commerce), …).
- 5 need a sales or partner conversation before any developer access (DealCloud, Pylon, Gladly, Waterfall.io, PitchBook). 85/100 already ship an official MCP server.

## Verdicts
- build_with_conditions: 22
- build_now: 70
- outreach_required: 5
- limited: 2
- needs_research: 1

## Easy wins not in Composio
- LiveAgent (Support and Helpdesk)
- Vonage (Communications and Messaging)
- GoHighLevel (Marketing, Ads, Email and Social)
- systeme.io (Marketing, Ads, Email and Social)
- WooCommerce (Ecommerce)
- Magento (Adobe Commerce) (Ecommerce)
- fanbasis (Ecommerce)
- SE Ranking (Data, SEO and Scraping)
- Netlify (Developer, Infra and Data platforms)
- MongoDB Atlas (Developer, Infra and Data platforms)
- Binance (Finance and Fintech)
- iPayX (Finance and Fintech)
- Reducto (AI, Research and Media-native)

## Outreach required
- DealCloud: No self-serve developer access. Getting credentials needs a DealCloud site, so a developer needs a customer tenant or a sandbox from Intapp. Each customer must also have an admin enable the API capability and issue a per-user API key.
- Pylon: There is no self-serve developer access. Pylon trials are set up by a sales rep as a demo org for prospects, and the API is a paid-plan feature (no free tier). A developer needs a trial or partner workspace from Pylon sales before they can get an API token.
- Gladly: No self-serve developer access found. Credentials need a Gladly customer org with the API User permission, and the sandbox is enabled by Gladly, so a customer or Gladly contact is needed to get started.
- Waterfall.io: API keys are not self-serve; developers must contact the Waterfall team for access and pricing before they can get credentials.
- PitchBook: There is no self-serve developer access. The API needs a standalone contract with PitchBook's Direct Data team, an API key from PitchBook, a sandbox key from the account manager, and purchased credits.
