/**
 * Re-score criterion 1 (categorise) with the current classifier, reusing the AI judgements already
 * cached by eval-mail-criteria.ts so no model calls are made. Learned roles are computed in memory
 * (nothing is written to S3). Updates data/mail-criteria/cache/c1.json in place.
 *
 *   npx tsx --env-file=.env.local scripts/rescore-categorise.ts
 *   npx tsx --env-file=.env.local scripts/eval-mail-criteria.ts --only 1     # reads the patched cache
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { preferredStage } from "../src/lib/mail/agentStage";
import { partyRole, setLearnedRoles, stageOf } from "../src/lib/mail/classify";
import { learnRoles, type RoleObservation } from "../src/lib/mail/learnedRoles";
import { getMailStore } from "../src/lib/mail/store";
import type { StoredAttachment } from "../src/lib/mail/types";

type Mail = { key: string; subject: string; from: string; fresh: string; status: string; dealKey: string | null };
type Row = { key: string; mailbox: string; subject: string; from: string; system: { trade: boolean; stage: string; role: string }; ai: unknown };

const DIR = path.join(process.cwd(), "data", "mail-criteria", "cache");

async function main() {
  const mailsFile = JSON.parse(await readFile(path.join(DIR, "mails.json"), "utf8")) as { mails: Mail[] };
  const byKey = new Map(mailsFile.mails.map((m) => [m.key, m]));
  const rows = JSON.parse(await readFile(path.join(DIR, "c1.json"), "utf8")) as Row[];
  const store = getMailStore();
  const ownEmails = [...new Set(mailsFile.mails.map((m) => (m as unknown as { mailbox: string }).mailbox))];

  // Learned roles, in memory only.
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const msgs = await store.recentMessages({ limit: 6000 });
  const observations: RoleObservation[] = [];
  for (const m of msgs) {
    if (!m.deal_key || !m.from_email) continue;
    const files = ((m.attachments_json || []) as StoredAttachment[]).filter((a) => !a.inline).map((a) => a.name);
    observations.push({ dealKey: m.deal_key, from: m.from_email, subject: m.subject || "", files, internal: own.has(m.from_email.toLowerCase()) });
  }
  const roles = learnRoles(observations, (email) => partyRole(email, { ownEmails }) !== "other");
  setLearnedRoles(roles);
  console.log(`learned roles for ${Object.keys(roles).length} domains`);

  const agentByDeal = new Map<string, { slot: string | null; confidence: number | null; stage: string | null }>();
  for (const deal of await store.recentDeals(20000)) {
    const result = deal.result_json as { agent_stage?: unknown } | null;
    agentByDeal.set(deal.id, { slot: deal.slot ?? null, confidence: deal.confidence ?? null, stage: typeof result?.agent_stage === "string" ? result.agent_stage : null });
  }

  let changedStage = 0;
  let changedRole = 0;
  for (const r of rows) {
    const m = byKey.get(r.key);
    if (!m) continue;
    const agent = m.dealKey ? agentByDeal.get(m.dealKey) : undefined;
    const stage = preferredStage(stageOf(m.subject, m.fresh), agent);
    const role = partyRole(m.from, { ownEmails });
    if (stage !== r.system.stage) changedStage += 1;
    if (role !== r.system.role) changedRole += 1;
    r.system = { trade: m.status !== "noise", stage, role };
  }
  await writeFile(path.join(DIR, "c1.json"), JSON.stringify(rows));
  console.log(`re-scored ${rows.length} mails: stage changed on ${changedStage}, role changed on ${changedRole}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
