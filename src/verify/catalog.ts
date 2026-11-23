// L4: Composio's own toolkit catalog as an independent check on auth (and "does Composio already have it?").
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Composio } from "@composio/core";
import type { AppInput } from "../schema.js";

export interface CatalogEntry { slug: string; name: string; auth_schemes: string[]; tools_count: number; app_url: string }
const CACHE = ".cache/composio_catalog.json";

export async function loadCatalog(): Promise<CatalogEntry[]> {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const c: any = new Composio({ apiKey: process.env.COMPOSIO_API_KEY, allowTracking: false, disableVersionCheck: true } as any);
  const all: CatalogEntry[] = [];
  let cursor: string | undefined;
  do {
    const page: any = await c.client.toolkits.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const t of page.items) all.push({ slug: t.slug, name: t.name, auth_schemes: t.auth_schemes ?? [], tools_count: t.meta?.tools_count ?? 0, app_url: t.meta?.app_url ?? "" });
    cursor = page.next_cursor || undefined;
  } while (cursor);
  mkdirSync(".cache", { recursive: true });
  writeFileSync(CACHE, JSON.stringify(all));
  return all;
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
// Names that don't normalise to the same string as Composio's toolkit name/slug. Checked by hand against the catalog.
const ALIASES: Record<string, string[]> = {
  "Lark (Larksuite)": ["lark", "larksuite"], "Magento (Adobe Commerce)": ["magento", "adobecommerce"],
  "Threads (Meta)": ["threads", "metathreads"], "Meta Ads": ["metaads", "facebookads"], "WhatsApp Business": ["whatsapp", "whatsappbusiness"],
  "Amazon Selling Partner": ["amazonsellingpartner", "amazonsp", "amazonsellercentral"], "Otter AI": ["otter", "otterai"],
  "Monday.com": ["monday", "mondaycom"], "Waterfall.io": ["waterfall", "waterfallio"], "systeme.io": ["systemeio", "systeme"],
  "Google Ads": ["googleads"], "LinkedIn Ads": ["linkedinads", "linkedin"], "Salesforce Commerce Cloud": ["salesforcecommercecloud"],
  "YouTube Transcript": ["youtubetranscript", "transcriptapi"], "Mermaid CLI": ["mermaid", "mermaidcli"], "Zoho CRM": ["zohocrm", "zoho"],
};

export function matchToolkit(app: Pick<AppInput, "name">, catalog: CatalogEntry[]): CatalogEntry | null {
  const keys = ALIASES[app.name] ?? [norm(app.name)];
  for (const k of keys) {
    const hit = catalog.find((t) => norm(t.slug) === k) ?? catalog.find((t) => norm(t.name) === k);
    if (hit) return hit;
  }
  return null;
}

// Composio scheme -> our auth method vocabulary
const SCHEME_MAP: Record<string, string[]> = {
  OAUTH2: ["oauth2"], OAUTH1: ["oauth2", "other"], API_KEY: ["api_key", "personal_token"], BEARER_TOKEN: ["api_key", "personal_token", "oauth2"],
  BASIC: ["basic", "api_key"], BASIC_WITH_JWT: ["basic", "service_account_or_jwt"], SERVICE_ACCOUNT: ["service_account_or_jwt"],
  GOOGLE_SERVICE_ACCOUNT: ["service_account_or_jwt"], NO_AUTH: ["none"],
};

/** Returns Composio schemes that our record does not account for. */
export function authDisagreements(ourMethods: string[], composioSchemes: string[]): string[] {
  return composioSchemes.filter((s) => SCHEME_MAP[s] && !SCHEME_MAP[s].some((m) => ourMethods.includes(m)));
}
