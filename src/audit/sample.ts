// Picks the human-audit sample: 2 apps per category with a recorded seed, excluding pilot apps.
// The first pick per category is calibration (may guide fixes); the second is holdout (scored only).
// Writes audit/sample.json and a blank worksheet audit/human.csv for the blind audit.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import type { AppInput } from "../schema.js";

const SEED = 20261123;
const PILOT_IDS = [2, 4, 8, 52, 90, 98]; // used to develop the agent, so excluded from evaluation

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const apps: AppInput[] = JSON.parse(readFileSync("data/apps.json", "utf8"));
const rand = mulberry32(SEED);
const categories = [...new Set(apps.map((a) => a.category))];
const picks: (AppInput & { group: "calibration" | "holdout" })[] = [];
for (const cat of categories) {
  const pool = apps.filter((a) => a.category === cat && !PILOT_IDS.includes(a.id));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  picks.push({ ...pool[0], group: "calibration" }, { ...pool[1], group: "holdout" });
}

mkdirSync("audit", { recursive: true });
writeFileSync("audit/sample.json", JSON.stringify({ seed: SEED, excluded_pilot_ids: PILOT_IDS, created_at: new Date().toISOString(), picks }, null, 2));

const cols = ["id", "app", "group", "hint", "auth_methods", "dev_access", "production_access", "public_app_review", "api_types", "api_breadth", "mcp_status", "verdict", "source_urls", "notes"];
if (existsSync("audit/human.csv")) {
  console.log("audit/human.csv already exists; not overwriting your work.");
} else {
  const rows = picks.map((p) => [p.id, p.name, p.group, p.hint, "", "", "", "", "", "", "", "", "", ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  writeFileSync("audit/human.csv", [cols.join(","), ...rows].join("\n") + "\n");
}
console.log(`seed ${SEED}:`);
for (const p of picks) console.log(`  ${p.group.padEnd(11)} #${String(p.id).padStart(3)} ${p.name} (${p.category})`);
