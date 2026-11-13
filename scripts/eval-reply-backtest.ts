/**
 * Reply accuracy backtest on the deal book.
 *
 *   npx tsx --env-file=.env.local scripts/eval-reply-backtest.ts                # 40 pairs
 *   npx tsx --env-file=.env.local scripts/eval-reply-backtest.ts --limit 100 --seed 7
 *   npx tsx --env-file=.env.local scripts/eval-reply-backtest.ts --facts        # also give deal facts (leaks the future)
 *   npx tsx --env-file=.env.local scripts/eval-reply-backtest.ts --no-judge     # wording + facts only
 *   npx tsx --env-file=.env.local scripts/eval-reply-backtest.ts --prompts v1,v2 # old vs new prompt, same mails
 *
 * For each sampled pair (a mail from outside → the reply an SNSPL person sent):
 *   1. Copilot drafts a reply with the inbox prompt, seeing ONLY the thread up to
 *      that mail — never the real reply or anything later.
 *   2. The draft is scored against the real reply (wording, facts, AI judge).
 * Writes data/reply-eval/<run>.json and data/reply-eval/latest.json (gitignored:
 * it contains mail text). scripts/reply-eval-report.ts turns a run into CSV + numbers.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { invokeTradeSuiteRds } from "../src/lib/rdsProxy";
import { freshText } from "../src/lib/mail/inbox";
import type { InboxItem, InboxMessage } from "../src/lib/mail/inboxTypes";
import { askCopilot, copilotRewrite, replyPrompt, replyPromptV1 } from "../src/lib/mail/replyAgent";
import { AGENT_NAMES, firstName } from "../src/lib/mail/replyDraft";
import {
  coreText,
  judgePrompt,
  parseJudge,
  scoreFacts,
  similarity,
  summarize,
  type ReplyEvalCase,
  type ReplyEvalRun,
} from "../src/lib/mail/replyEval";
import { threadKeyFor } from "../src/lib/mail/thread";
import type { EvidenceMessage, ProcessedDealRow } from "../src/lib/trade/processedDealMapper";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) || fallback : fallback;
};
const LIMIT = opt("limit", 40);
const SEED = opt("seed", 1);
const CONCURRENCY = opt("concurrency", 4);
const PROMPTS = { v1: replyPromptV1, v2: replyPrompt } as const;
type Variant = keyof typeof PROMPTS;
const VARIANTS = ((args.includes("--prompts") ? args[args.indexOf("--prompts") + 1] : "") || "v2")
  .split(",")
  .filter((v): v is Variant => v in PROMPTS);
const WITH_FACTS = flag("facts");
const JUDGE = !flag("no-judge");

const INTERNAL = /@snspl\.(in|ml)\s*>?\s*$/i;
const FORWARD = /^\s*(fw|fwd)\s*:/i;
const NOISE = /no-?reply|mailer-daemon|postmaster|notification|automatic reply|out of office|undeliverable/i;
const MAX_GAP_MS = 10 * 24 * 3600_000;
const HISTORY = 6;

/* deterministic shuffle */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function shuffle<T>(list: T[], rand: () => number) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function rds<T>(payload: Record<string, unknown>) {
  const res = await invokeTradeSuiteRds<T>(payload);
  if (!res.success) throw new Error(res.error || `${payload.action} failed`);
  return res.data as T;
}

async function allDeals() {
  const out: ProcessedDealRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = (await rds<ProcessedDealRow[]>({ action: "list_deals", limit: 500, offset })) || [];
    out.push(...page);
    if (page.length < 500) return out;
  }
}

const email = (s: string | undefined) => (/[\w.+-]+@[\w.-]+/.exec(s || "")?.[0] || "").toLowerCase();
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : v || "");

function toInbox(m: EvidenceMessage): InboxMessage {
  const from = email(m.from);
  return {
    id: m.id || `${from}-${m.date}`,
    from,
    fromName: (m.from_name || "").replace(/["']/g, "").trim(),
    to: list(m.to),
    cc: list(m.cc),
    date: m.date || null,
    subject: m.subject || "",
    body: freshText(m.body || ""),
    attachments: (m.attachments || []).map((a) => a.name || "").filter(Boolean),
    internal: INTERNAL.test(from),
  };
}

type Pair = { deal: ProcessedDealRow; history: InboxMessage[]; incoming: InboxMessage; human: InboxMessage };

/** Real "their mail → our direct reply" pairs in one deal. */
function pairsIn(deal: ProcessedDealRow, messages: EvidenceMessage[]): Pair[] {
  const seen = new Set<string>();
  const msgs = messages
    .filter((m) => m.date && m.from && !seen.has(m.id || `${m.from}${m.date}`) && seen.add(m.id || `${m.from}${m.date}`))
    .sort((a, b) => a.date!.localeCompare(b.date!))
    .map(toInbox);
  const pairs: Pair[] = [];
  msgs.forEach((human, i) => {
    if (!human.internal || FORWARD.test(human.subject)) return;
    const core = coreText(human.body);
    if (core.length < 30 || core.length > 1200) return;
    const key = threadKeyFor(human.subject, human.id);
    const thread = msgs.slice(0, i).filter((m) => threadKeyFor(m.subject, m.id) === key);
    const last = thread[thread.length - 1];
    // Direct answer: the newest mail in the thread is theirs, and our reply goes to them.
    if (!last || last.internal || NOISE.test(`${last.from} ${last.subject}`)) return;
    if (coreText(last.body).length < 20 || /^-+\s*forwarded message/im.test(last.body.slice(0, 80))) return;
    if (Date.parse(human.date!) - Date.parse(last.date!) > MAX_GAP_MS) return;
    // Addressed to them (To, not only Cc) — otherwise it is a forward to someone else, not an answer.
    if (!human.to.toLowerCase().includes(last.from)) return;
    pairs.push({ deal, history: thread.slice(-HISTORY), incoming: last, human });
  });
  return pairs;
}

function itemFor(p: Pair): InboxItem {
  // The deal row holds its FINAL stage and summary — handing those over would tell the draft how the deal ends
  // (and mislabel early mails, e.g. an inspection mail as "commission"). Thread-only unless --facts.
  const slot = WITH_FACTS ? p.deal.slot || null : null;
  return {
    id: `eval-${p.deal.id}`,
    subject: p.incoming.subject,
    latest: p.incoming,
    thread: p.history,
    outcome: "draft_ready",
    note: null,
    stage: WITH_FACTS ? p.deal.primary_stage || null : null,
    slot,
    agentName: (slot && AGENT_NAMES[slot]) || "Stage worker",
    agentId: p.deal.agent_id || null,
    summary: WITH_FACTS ? p.deal.summary || null : null,
    confidence: null,
    facts: [],
    poNumbers: [],
    signer: firstName(p.human.fromName.includes("@") ? "" : p.human.fromName, p.human.from),
    draft: null,
    dealId: p.deal.id,
    mailbox: { connectionId: "backtest", mailboxEmail: p.human.from, mailboxName: null, messageId: "", internetMessageId: null, threadKey: "" },
  };
}

async function runCase(p: Pair, n: number, variant: Variant): Promise<ReplyEvalCase> {
  const item = itemFor(p);
  const base: ReplyEvalCase = {
    id: `${p.deal.id}#${p.human.id}`,
    variant,
    dealId: p.deal.id,
    stage: p.deal.primary_stage || null,
    slot: p.deal.slot || null,
    agentName: (p.deal.slot && AGENT_NAMES[p.deal.slot]) || "Stage worker",
    subject: p.incoming.subject,
    incoming: { from: p.incoming.from, fromName: p.incoming.fromName, date: p.incoming.date, body: p.incoming.body },
    human: { from: p.human.from, fromName: p.human.fromName, date: p.human.date, body: p.human.body },
    draft: null,
    draftMs: null,
    error: null,
    similarity: null,
    facts: null,
    judge: null,
  };
  const t0 = Date.now();
  try {
    base.draft = await copilotRewrite(item, item.signer, PROMPTS[variant]);
    base.draftMs = Date.now() - t0;
  } catch (err) {
    base.error = `draft: ${err instanceof Error ? err.message : String(err)}`;
    console.log(`  [${n}] ✗ draft failed — ${base.error}`);
    return base;
  }
  const context = [...p.history.map((m) => `${m.subject}\n${m.body}`), WITH_FACTS ? p.deal.summary || "" : ""].join("\n");
  base.similarity = similarity(base.draft, p.human.body);
  base.facts = scoreFacts(base.draft, p.human.body, context);
  if (JUDGE) {
    try {
      const text = await askCopilot(judgePrompt(base), "reply-eval-judge", 60_000);
      base.judge = parseJudge(text);
      if (!base.judge) base.error = `judge: unparseable answer: ${text.slice(0, 120)}`;
    } catch (err) {
      base.error = `judge: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  console.log(
    `  [${n} ${variant}] ${base.judge?.verdict ?? "—"} · sim ${base.similarity.toFixed(2)} · facts ${base.facts.matched.length}/${base.facts.expected.length}` +
      `${base.facts.invented.length ? ` · invented ${base.facts.invented.length}` : ""} · ${p.deal.id}`,
  );
  return base;
}

async function main() {
  const startedAt = new Date().toISOString();
  const rand = rng(SEED);
  console.log(`Reply backtest · prompts ${VARIANTS.join("+")} · limit ${LIMIT} · seed ${SEED} · facts ${WITH_FACTS ? "on (leaks future)" : "off"} · judge ${JUDGE ? "on" : "off"}`);
  const deals = (await allDeals()).filter((d) => d.status === "completed" && (d.message_count || 0) >= 2);
  console.log(`${deals.length} deals with mail`);

  // Round-robin across stages so one busy stage doesn't dominate; one pair per deal.
  const byStage = new Map<string, ProcessedDealRow[]>();
  for (const d of shuffle(deals, rand)) {
    const k = d.primary_stage || "other";
    byStage.set(k, [...(byStage.get(k) || []), d]);
  }
  const queues = [...byStage.values()];
  const picked: Pair[] = [];
  let scanned = 0;
  let found = 0;
  while (picked.length < LIMIT && queues.some((q) => q.length)) {
    for (const q of queues) {
      const deal = q.shift();
      if (!deal || picked.length >= LIMIT) continue;
      scanned++;
      const row = await rds<ProcessedDealRow>({ action: "get_evidence", id: deal.id }).catch(() => null);
      const pairs = pairsIn(deal, row?.evidence_json?.messages || []);
      found += pairs.length;
      if (pairs.length) picked.push(pairs[Math.floor(rand() * pairs.length)]!);
    }
  }
  console.log(`Scanned ${scanned} deals · ${found} reply pairs · testing ${picked.length}\n`);

  const jobs = picked.flatMap((p, i) => VARIANTS.map((v) => ({ p, n: i + 1, v })));
  const cases: ReplyEvalCase[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        const job = jobs[i]!;
        cases[i] = await runCase(job.p, job.n, job.v);
      }
    }),
  );

  const run: ReplyEvalRun = {
    id: startedAt.replace(/[:.]/g, "-"),
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: "backtest",
    withFacts: WITH_FACTS,
    seed: SEED,
    pairsFound: found,
    dealsScanned: scanned,
    variants: VARIANTS,
    cases,
  };
  const dir = path.join(process.cwd(), "data", "reply-eval");
  await mkdir(dir, { recursive: true });
  const json = JSON.stringify(run, null, 1);
  await writeFile(path.join(dir, `${run.id}.json`), json);
  await writeFile(path.join(dir, "latest.json"), json);

  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  for (const v of VARIANTS) {
    const s = summarize(cases.filter((c) => c.variant === v));
    console.log(`\n== Prompt ${v} ==`);
    console.log(`Drafted ${s.drafted}/${s.cases} · judged ${s.judged}`);
    console.log(`Usable (send as is + minor edits): ${pct(s.usable)} · on answerable mails (${s.answerable}): ${pct(s.usableAnswerable)}`);
    console.log(`Verdicts: ${JSON.stringify(s.verdicts)}`);
    console.log(`Same intent ${pct(s.sameIntent)} · fact recall ${pct(s.factRecall)} · drafts with invented facts ${pct(s.inventedRate)}`);
    console.log(`Wording similarity ${s.similarity?.toFixed(2) ?? "—"} · avg score ${s.avgScore?.toFixed(1) ?? "—"}/5`);
  }
  console.log(`\nSaved data/reply-eval/${run.id}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
