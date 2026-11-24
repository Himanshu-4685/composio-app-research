// L3: a second model, fresh context, no tools, judges each field against the cited evidence.
import { readFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AppRecord } from "../schema.js";
import { cachedPage } from "../agent/tools.js";
import { normText } from "./checks.js";

const CRITIC_PROMPT = readFileSync("prompts/critic.md", "utf8");
const Judgement = z.object({ status: z.enum(["supported", "contradicted", "insufficient", "suspect"]), reason: z.string() });
export const CriticOutput = z.object({ auth: Judgement, access: Judgement, api: Judgement, mcp: Judgement, verdict: Judgement });
export type CriticOutput = z.infer<typeof CriticOutput>;

function excerpt(url: string, quote: string, radius = 700): string {
  const page = cachedPage(url)?.content;
  if (!page) return "(page not in cache)";
  const flat = page.replace(/\s+/g, " ");
  const probe = quote.replace(/\s+/g, " ").slice(0, 40);
  let i = flat.indexOf(probe);
  if (i < 0) i = normText(flat).indexOf(normText(probe)); // approximate position
  if (i < 0) return "(quoted text not found on cited page) Page start: " + flat.slice(0, 600);
  return flat.slice(Math.max(0, i - radius), i + quote.length + radius);
}

// Sonnet: one short turn per app fits the Pro-plan budget. Independence comes from a fresh context + adversarial prompt.
export interface CriticOptions { model?: string; promptPath?: string }

export async function critique(r: AppRecord, modelOrOpts: string | CriticOptions = "sonnet"): Promise<{ out: CriticOutput | null; usd: number; error?: string }> {
  const o: CriticOptions = typeof modelOrOpts === "string" ? { model: modelOrOpts } : modelOrOpts;
  const model = o.model ?? "sonnet";
  const system = o.promptPath ? readFileSync(o.promptPath, "utf8") : CRITIC_PROMPT;
  const { stats, claims, run_id, researched_at, pass, status, ...fields } = r as any;
  const evidence = claims.map((c: any, i: number) => `[${i + 1}] field=${c.field} url=${c.url}\nclaim: ${c.text}\nquote: "${c.quote}"\npage excerpt: ${excerpt(c.url, c.quote)}`).join("\n\n");
  const prompt = `RECORD:\n${JSON.stringify(fields, null, 1)}\n\nEVIDENCE:\n${evidence || "(no claims)"}`;
  let result: any = null;
  try {
    for await (const m of query({
      prompt,
      options: {
        model, systemPrompt: system, settingSources: [], tools: [], maxTurns: 3,
        outputFormat: { type: "json_schema", schema: (() => { const s: any = z.toJSONSchema(CriticOutput); delete s.$schema; return s; })() },
      } as any,
    })) if (m.type === "result") result = m;
  } catch (e: any) { return { out: null, usd: 0, error: String(e?.message ?? e) }; }
  const parsed = CriticOutput.safeParse(result?.structured_output);
  return parsed.success ? { out: parsed.data, usd: result?.total_cost_usd ?? 0 } : { out: null, usd: result?.total_cost_usd ?? 0, error: result?.subtype ?? "invalid critic output" };
}
