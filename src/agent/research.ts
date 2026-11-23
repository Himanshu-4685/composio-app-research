// researchApp(): one app in, one validated record out. Used by the batch CLI and the local UI.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { AgentOutput, agentOutputJsonSchema, type AppInput, type AppRecord } from "../schema.js";
import { researchToolServer, type ToolCallLog } from "./tools.js";

export const RESEARCH_PROMPT = readFileSync("prompts/research.md", "utf8");
export const PROMPT_VERSION = createHash("sha1").update(RESEARCH_PROMPT).digest("hex").slice(0, 8);

export interface ResearchOptions {
  runId: string;
  model?: string;          // "sonnet" by default
  timeoutMs?: number;      // per-app cap
  extraInstructions?: string; // used by re-research (L5) to pass the critic's objection
  onEvent?: (e: { type: "tool" | "text"; detail: string }) => void;
}

export async function researchApp(app: Omit<AppInput, "id"> & { id?: number }, opts: ResearchOptions): Promise<{ record: AppRecord; toolLog: ToolCallLog[] }> {
  const log: ToolCallLog[] = [];
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 300_000);

  const userPrompt = [
    `App: ${app.name}`,
    `Category (given): ${app.category || "unknown"}`,
    `Hint: ${app.hint || "none"}`,
    opts.extraInstructions ? `\n${opts.extraInstructions}` : "",
  ].join("\n");

  let result: any = null, model = "";
  const base = {
    id: app.id ?? 0, name: app.name, category: app.category, hint: app.hint,
    run_id: opts.runId, pass: "baseline" as const, researched_at: new Date().toISOString(),
  };
  try {
    for await (const m of query({
      prompt: userPrompt,
      options: {
        model: opts.model ?? "sonnet",
        systemPrompt: RESEARCH_PROMPT,        // replaces Claude Code's long default prompt (token saving)
        settingSources: [],                   // ignore local CLAUDE.md / settings
        tools: [],                            // no built-in tools at all
        mcpServers: { research: researchToolServer(log) },
        allowedTools: ["mcp__research__web_search", "mcp__research__fetch_page"],
        maxTurns: 30,
        abortController: abort,
        outputFormat: { type: "json_schema", schema: agentOutputJsonSchema() },
      } as any,
    })) {
      if (m.type === "system" && (m as any).subtype === "init") model = (m as any).model;
      if (m.type === "assistant" && opts.onEvent) {
        for (const b of (m as any).message?.content ?? []) {
          if (b.type === "tool_use") opts.onEvent({ type: "tool", detail: `${b.name.replace("mcp__research__", "")} ${JSON.stringify(b.input)}` });
        }
      }
      if (m.type === "result") result = m;
    }
  } catch (e: any) {
    result = { subtype: abort.signal.aborted ? "timeout" : "exception", error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }

  const u = result?.usage ?? {};
  const stats = {
    turns: result?.num_turns ?? 0,
    tool_calls: log.length,
    searches: log.filter((l) => l.tool === "web_search").length,
    fetches: log.filter((l) => l.tool === "fetch_page").length,
    seconds: Math.round((Date.now() - started) / 1000),
    notional_usd: Number((result?.total_cost_usd ?? 0).toFixed(4)),
    input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    output_tokens: u.output_tokens ?? 0,
    model,
  };

  const parsed = AgentOutput.safeParse(result?.structured_output);
  if (!parsed.success) {
    const error = result?.subtype && result.subtype !== "success"
      ? `${result.subtype}: ${result.error ?? (result.errors ?? []).join("; ")}`
      : `invalid output: ${parsed.error.message.slice(0, 300)}`;
    return { record: { ...base, ...emptyOutput(), status: "failed", error, stats }, toolLog: log };
  }
  return { record: { ...base, ...parsed.data, status: "ok", stats }, toolLog: log };
}

function emptyOutput(): AgentOutput {
  return {
    identity: { canonical_name: "", website: "", docs_url: "", note: "" }, summary: "",
    auth: { methods: [], detail: "" },
    access: { dev_access: "unknown", production_access: "unknown", gates: [], public_app_review: "unknown" },
    api: { types: [], breadth: "unknown", resource_families: [], note: "" },
    mcp: { status: "unknown", url: "", note: "" },
    verdict: "needs_research", blocker: "research failed", confidence: "low", open_questions: [], claims: [],
  };
}
