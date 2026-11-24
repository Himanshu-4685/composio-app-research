// OpenRouter engine: run the SAME research task with any OpenRouter model (OpenAI-compatible tool calling).
// Same tools (Composio-backed web_search / fetch_page with the same budgets and page cache), same schema,
// same downstream checks. Only the model and the agent loop implementation differ from the Claude Agent SDK path.
// Needs OPENROUTER_API_KEY in .env. The model must support tool calling.
import "dotenv/config";
import { z } from "zod";
import { webSearch, fetchPage, focusText, type ToolCallLog } from "./tools.js";

const URL_ = "https://openrouter.ai/api/v1/chat/completions";
type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: any[]; tool_call_id?: string };

export interface ORUsage { prompt_tokens: number; completion_tokens: number; cost: number; calls: number }

async function chat(model: string, messages: Msg[], tools: any[], signal: AbortSignal, usage: ORUsage) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set in .env");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(URL_, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "app-research-agent" },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0, usage: { include: true } }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    const j: any = await res.json();
    if (!res.ok || j.error) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    usage.calls++;
    usage.prompt_tokens += j.usage?.prompt_tokens ?? 0;
    usage.completion_tokens += j.usage?.completion_tokens ?? 0;
    usage.cost += j.usage?.cost ?? 0;
    return j.choices?.[0]?.message ?? { content: "" };
  }
  throw new Error("OpenRouter: too many retries (rate limit / server error)");
}

const fn = (name: string, description: string, parameters: any) => ({ type: "function", function: { name, description, parameters } });

/**
 * Generic agent loop: research tools + a `submit` tool whose arguments must match `schema`.
 * Returns the validated object, the tool log and usage.
 */
export async function runAgentLoop<T>(opts: {
  model: string; system: string; user: string; schema: z.ZodType<T>; submitName: string; submitDescription: string;
  withResearchTools: boolean; maxTurns?: number; timeoutMs?: number; budget?: { searches: number; fetches: number };
  onEvent?: (e: { type: "tool" | "text"; detail: string }) => void;
}): Promise<{ out: T | null; error?: string; log: ToolCallLog[]; usage: ORUsage; turns: number }> {
  const log: ToolCallLog[] = [];
  const usage: ORUsage = { prompt_tokens: 0, completion_tokens: 0, cost: 0, calls: 0 };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 300_000);
  const budget = opts.budget ?? { searches: 12, fetches: 14 };
  let searches = 0, fetches = 0, repairs = 0, nudges = 0, turns = 0;
  const submitSchema: any = z.toJSONSchema(opts.schema); delete submitSchema.$schema;
  const tools = [
    ...(opts.withResearchTools ? [
      fn("web_search", "Search the web. Returns up to 8 results (title, url, snippet). Use site: filters to target official docs.", { type: "object", properties: { query: { type: "string" } }, required: ["query"] }),
      fn("fetch_page", "Fetch a public web page as markdown. Pass `focus` keywords to get only matching sections. Quotes you cite MUST be copied verbatim from text returned here.", { type: "object", properties: { url: { type: "string" }, focus: { type: "array", items: { type: "string" } } }, required: ["url"] }),
    ] : []),
    fn(opts.submitName, opts.submitDescription, submitSchema),
  ];
  const messages: Msg[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.user }];
  try {
    while (turns < (opts.maxTurns ?? 30)) {
      turns++;
      const m = await chat(opts.model, messages, tools, abort.signal, usage);
      messages.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
      if (!m.tool_calls?.length) {
        if (++nudges > 2) return { out: null, error: "model stopped without submitting", log, usage, turns };
        messages.push({ role: "user", content: `Call the ${opts.submitName} tool now with your complete answer.` });
        continue;
      }
      for (const tc of m.tool_calls) {
        const name = tc.function?.name; let args: any = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { args = { __bad: tc.function?.arguments }; }
        const reply = (content: string) => messages.push({ role: "tool", tool_call_id: tc.id, content });
        if (name === opts.submitName) {
          const parsed = opts.schema.safeParse(args);
          if (parsed.success) return { out: parsed.data, log, usage, turns };
          if (++repairs > 2) return { out: null, error: `invalid ${opts.submitName}: ${parsed.error.message.slice(0, 200)}`, log, usage, turns };
          reply(`Schema validation failed, fix and call ${opts.submitName} again: ${parsed.error.message.slice(0, 1500)}`);
          continue;
        }
        const t0 = Date.now();
        try {
          let out = "";
          if (name === "web_search") {
            if (++searches > budget.searches) throw new Error("search budget exhausted; submit with what you have");
            opts.onEvent?.({ type: "tool", detail: `web_search ${JSON.stringify(args)}` });
            out = JSON.stringify(await webSearch(String(args.query ?? "")), null, 1);
          } else if (name === "fetch_page") {
            if (++fetches > budget.fetches) throw new Error("fetch budget exhausted; submit with what you have");
            opts.onEvent?.({ type: "tool", detail: `fetch_page ${JSON.stringify(args)}` });
            out = focusText((await fetchPage(String(args.url ?? ""))).content, Array.isArray(args.focus) ? args.focus : undefined);
          } else throw new Error(`unknown tool ${name}`);
          log.push({ tool: name, input: JSON.stringify(args).slice(0, 300), ok: true, ms: Date.now() - t0, chars: out.length });
          reply(out);
        } catch (e: any) {
          const msg = String(e?.message ?? e).slice(0, 300);
          log.push({ tool: name, input: JSON.stringify(args).slice(0, 300), ok: false, ms: Date.now() - t0, chars: 0, error: msg });
          reply(`ERROR: ${msg}`);
        }
      }
    }
    return { out: null, error: "max turns reached", log, usage, turns };
  } catch (e: any) {
    return { out: null, error: abort.signal.aborted ? "timeout" : String(e?.message ?? e), log, usage, turns };
  } finally { clearTimeout(timer); }
}
