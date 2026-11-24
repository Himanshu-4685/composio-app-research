# App toolkit research: summary (machine-readable)

Run baseline-v1. 100 apps. Source of truth: records.json.

## Headlines
- 58 of 100 apps can be built as agent toolkits today: documented API, and a developer can get credentials free or on a trial.
- Auth is not the bottleneck; access is. 72/100 offer OAuth2, 83/100 offer an API key or personal token, and 58 offer both. The real blockers are commercial: paid tier or API add-on (16), vendor app approval (10), partner / sales gate (6).
- Self-serve varies by category. Most open: Developer, Infra and Data platforms (10/10), CRM and Sales (9/10). Most gated: Finance and Fintech (6/10), AI, Research and Media-native (7/10).
- 74/100 already exist in Composio's catalog. Of the 26 that don't, 11 are "build now": the easiest new toolkits (LiveAgent, Vonage, GoHighLevel, systeme.io, WooCommerce, Amazon Selling Partner, …).
- 6 need a sales or partner conversation before any developer access (DealCloud, Gladly, Aircall, Salesforce Commerce Cloud, Waterfall.io, PitchBook). 85/100 already ship an official MCP server.

## Verdicts
- build_with_conditions: 32
- build_now: 58
- outreach_required: 6
- needs_research: 3
- limited: 1

## Easy wins not in Composio
- LiveAgent (Support and Helpdesk)
- Vonage (Communications and Messaging)
- GoHighLevel (Marketing, Ads, Email and Social)
- systeme.io (Marketing, Ads, Email and Social)
- WooCommerce (Ecommerce)
- Amazon Selling Partner (Ecommerce)
- SE Ranking (Data, SEO and Scraping)
- Netlify (Developer, Infra and Data platforms)
- MongoDB Atlas (Developer, Infra and Data platforms)
- Binance (Finance and Fintech)
- Reducto (AI, Research and Media-native)

## Outreach required
- DealCloud: No self-serve developer access. Getting credentials needs a DealCloud site, so a developer needs a customer tenant or a sandbox from Intapp. Sandboxes are offered to Intapp clients. Each customer must also have an admin enable the API capability and issue a per-user API key. Whether the API is a separately licensed add-on is unconfirmed.
- Gladly: No self-serve or trial developer access was found. Credentials require an existing Gladly customer org with the API User permission, and a sandbox must be purchased through a Gladly CSM or Support. A customer or Gladly contact is needed to start.
- Aircall: A multi-tenant OAuth integration needs approval as an Aircall Technology Partner, which Aircall can decline. Aircall issues the sandbox and the OAuth credentials only after approval. Basic Auth keys work now but only for a single customer's own account.
- Salesforce Commerce Cloud: No self-serve or free developer route to a B2C Commerce instance. Dev credentials and sandboxes require a licensed tenant and purchased sandbox credits through a Salesforce Account Executive. Each customer's Account Manager admin must then create an API client or SLAS client. No central OAuth app exists.
- Waterfall.io: API keys are not self-serve; developers must contact the Waterfall team for access and pricing before they can get credentials.
- PitchBook: There is no self-serve developer access. The API needs a standalone contract with PitchBook's Direct Data team, an API key from PitchBook, a sandbox key from the account manager, and purchased credits. MCP access also needs a PitchBook license or a request to PitchBook.
