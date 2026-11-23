// The record every app gets. The agent fills AgentOutput; our code adds the rest.
import { z } from "zod";

export const AUTH_METHODS = ["oauth2", "api_key", "personal_token", "basic", "service_account_or_jwt", "none", "other"] as const;
export const ACCESS = ["free", "free_trial", "paid_plan", "admin_approval", "app_review", "partner_or_sales", "not_applicable", "unknown"] as const;
export const API_TYPES = ["rest", "graphql", "sdk", "cli", "webhooks", "soap", "other", "none_found"] as const;
export const BREADTH = ["narrow", "moderate", "broad", "unknown"] as const;
export const MCP_STATUS = ["official", "community", "announced", "none_found", "unknown"] as const;
export const VERDICTS = ["build_now", "build_with_conditions", "outreach_required", "limited", "needs_research"] as const;
export const FIELDS = ["identity", "auth", "access", "api", "mcp"] as const;

export const Claim = z.object({
  field: z.enum(FIELDS).describe("Which part of the record this claim supports"),
  text: z.string().describe("The fact, in your own words"),
  url: z.string().describe("Page the quote was copied from (must be a page you fetched)"),
  quote: z.string().describe("Short VERBATIM passage (10-40 words) copied exactly from the fetched page text"),
});

export const AgentOutput = z.object({
  identity: z.object({
    canonical_name: z.string(),
    website: z.string(),
    docs_url: z.string().describe("Main developer/API docs URL, or empty string if none found"),
    note: z.string().describe("Ambiguity or edition notes; empty string if none"),
  }),
  summary: z.string().describe("One sentence: what the product does"),
  auth: z.object({
    methods: z.array(z.enum(AUTH_METHODS)).describe("How a developer OBTAINS credentials. Not how they are sent (Bearer header is transport, not a method)."),
    detail: z.string().describe("e.g. 'OAuth2 authorization code for multi-workspace apps; workspace API key for single workspace'"),
  }),
  access: z.object({
    dev_access: z.enum(ACCESS).describe("What a developer needs to get working credentials to build/test"),
    production_access: z.enum(ACCESS).describe("What a customer/end user needs for the API to work in their account"),
    gates: z.array(z.string()).describe("Every condition found, e.g. 'API only on Professional plan', 'public OAuth apps need marketplace review'"),
    public_app_review: z.enum(["yes", "no", "unknown", "not_applicable"]).describe("Must the vendor review/approve/publish a third-party OAuth app before it can serve many customers (e.g. verification, marketplace listing, install caps)? not_applicable if there is no OAuth app model"),
  }),
  api: z.object({
    types: z.array(z.enum(API_TYPES)),
    breadth: z.enum(BREADTH).describe("narrow = 1-2 resource families, moderate = 3-5, broad = 6+"),
    resource_families: z.array(z.string()).describe("e.g. ['contacts','deals','notes']"),
    note: z.string().describe("Limits, versioning, rate limits worth knowing; empty string if none"),
  }),
  mcp: z.object({
    status: z.enum(MCP_STATUS).describe("official = published by the vendor; community = third party; announced = vendor announced but not available"),
    url: z.string().describe("Server or repo URL, or empty string"),
    note: z.string(),
  }),
  verdict: z.enum(VERDICTS),
  blocker: z.string().describe("Main blocker or condition in plain words; empty string if build_now"),
  confidence: z.enum(["high", "medium", "low"]),
  open_questions: z.array(z.string()),
  claims: z.array(Claim).describe("Evidence. At least one claim each for auth, access, api; plus mcp if status is official/community/announced"),
});
export type AgentOutput = z.infer<typeof AgentOutput>;

export interface AppInput { id: number; name: string; category: string; hint: string }

export interface AppRecord extends AgentOutput {
  id: number; name: string; category: string; hint: string;
  run_id: string; pass: "baseline" | "final"; researched_at: string;
  status: "ok" | "failed";
  error?: string;
  stats: { turns: number; tool_calls: number; searches: number; fetches: number; seconds: number; notional_usd: number; input_tokens: number; output_tokens: number; model: string };
}

/** JSON schema for the Agent SDK's structured output. */
export function agentOutputJsonSchema() {
  const s: any = z.toJSONSchema(AgentOutput);
  delete s.$schema;
  return s;
}
