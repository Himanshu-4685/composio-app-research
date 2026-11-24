// Apps researched after the 100-app study, added to the case-study list on request.
// They get the same agent + automatic checks (L1 rules, L2 quotes, L3 critic) but no human audit,
// and they are kept OUT of the study's headline patterns and accuracy numbers.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AppRecord } from "./schema.js";
import { ruleChecks, quoteChecks, type Flag } from "./verify/checks.js";
import { critique, type CriticOutput } from "./verify/critic.js";

export const ADDED_PATH = "data/added.jsonl";
export type AddedRecord = AppRecord & { added: true; added_at: string; auto_checks: { flags: Flag[]; quotes_found: string }; critic: CriticOutput | null };

export function readAdded(): AddedRecord[] {
  return existsSync(ADDED_PATH) ? readFileSync(ADDED_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

/** Run the automatic checks on a fresh record and save it to the added list (same name replaces the old entry). */
export async function verifyAndAdd(record: AppRecord, precomputed?: { flags: Flag[]; quotes_found: string; critic: CriticOutput | null }): Promise<AddedRecord> {
  if (record.status !== "ok") throw new Error(`not adding ${record.name}: research ${record.status} (${record.error})`);
  let checks = precomputed;
  if (!checks) {
    const q = await quoteChecks(record);
    const c = await critique(record);
    checks = { flags: [...ruleChecks(record), ...q.flags], quotes_found: `${q.results.filter((x) => x.result === "verbatim" || x.result === "near").length}/${q.results.length}`, critic: c.out };
  }
  const existing = readAdded().filter((r) => r.name.toLowerCase() !== record.name.toLowerCase());
  const id = existing.length ? Math.max(100, ...existing.map((r) => r.id)) + 1 : 101; // ids 101+ never clash with the study's 1–100
  const rec: AddedRecord = { ...record, id, category: record.category || "Added later", added: true, added_at: new Date().toISOString(), auto_checks: { flags: checks.flags, quotes_found: checks.quotes_found }, critic: checks.critic };
  writeFileSync(ADDED_PATH, [...existing, rec].map((r) => JSON.stringify(r)).join("\n") + "\n");
  return rec;
}
