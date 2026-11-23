// Preflight: proves each external dependency works before a long run.
// 1) Composio search  2) Composio fetch  3) Composio catalog  4) Agent SDK using our Composio-backed tools.
import "dotenv/config";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Composio } from "@composio/core";
import { webSearch, fetchPage, researchToolServer, type ToolCallLog } from "./agent/tools.js";

const ok = (s: string) => console.log("  PASS", s);

console.log("1. Composio search (KEENABLE_SEARCH_WEB_PUBLIC)");
const hits = await webSearch("Attio REST API authentication");
ok(`${hits.length} results, first: ${hits[0]?.url}`);

console.log("2. Composio fetch (KEENABLE_FETCH_URL_PUBLIC)");
const page = await fetchPage("https://docs.attio.com/rest-api/guides/authentication", { fresh: true });
ok(`${page.content.length} chars; contains "OAuth 2.0": ${page.content.includes("OAuth 2.0")}`);

console.log("3. Composio toolkit catalog");
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY, allowTracking: false, disableVersionCheck: true } as any);
const tk: any = await composio.toolkits.get("attio");
ok(`attio toolkit exists, auth modes: ${tk.composioManagedAuthSchemes?.join(",")}`);

console.log("4. Agent SDK + Composio-backed MCP tools");
const log: ToolCallLog[] = [];
let answer: any = null, cost = 0, model = "";
for await (const m of query({
  prompt: "Using the research tools, find which authentication methods the Attio REST API supports. Cite one verbatim quote and its URL.",
  options: {
    model: "sonnet",
    mcpServers: { research: researchToolServer(log) },
    allowedTools: ["mcp__research__web_search", "mcp__research__fetch_page"],
    tools: [], // no built-in tools (no shell, no file access, no built-in web)
    maxTurns: 8,
    outputFormat: { type: "json_schema", schema: { type: "object", properties: { methods: { type: "array", items: { type: "string" } }, quote: { type: "string" }, url: { type: "string" } }, required: ["methods", "quote", "url"] } },
  } as any,
})) {
  if (m.type === "system" && m.subtype === "init") model = (m as any).model;
  if (m.type === "result") { answer = (m as any).structured_output ?? (m as any).result; cost = (m as any).total_cost_usd; }
}
ok(`model ${model}; ${log.length} tool calls (${log.map((l) => l.tool).join(", ")})`);
console.log("  answer:", JSON.stringify(answer));
console.log(`  notional cost: $${cost?.toFixed?.(3)} (billed to Claude Code subscription when no API key)`);
