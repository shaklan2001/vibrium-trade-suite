/**
 * End-to-end evaluation of the connected mailboxes against eight criteria:
 *
 *   1 categorise   — trade vs noise, deal stage and sender role for every mail
 *   2 numbers      — figures the stage agents extracted, checked against the mails
 *   3 predict      — next action predicted from several earlier mails vs what the team did
 *   4 bottlenecks  — early warnings: are they real, and what do they miss
 *   5 decisions    — Copilot decision answers: grounded, and linked to the mails they rest on
 *   6 structure    — reply drafts (greeting → answer → next step → sign-off) and quote stripping
 *   7 banking      — payment mails matched to the right PO, amount and person
 *   8 quotations   — quote requests: vendors, last price, agreed vs actual delivery from the book
 *
 *   npx tsx --env-file=.env.local scripts/eval-mail-criteria.ts                 # all criteria
 *   npx tsx --env-file=.env.local scripts/eval-mail-criteria.ts --only 1,2      # some
 *   npx tsx --env-file=.env.local scripts/eval-mail-criteria.ts --refresh       # re-read the mailboxes
 *
 * Criterion 5 talks to the running app (COPILOT_BASE, default http://localhost:3000).
 * The AI checker is the same Copilot model used for the reply-accuracy grader.
 * Everything is written under data/mail-criteria/ (gitignored: it holds mail text).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { freshText } from "../src/lib/mail/inbox";
import { partyRole, poKey, stageOf } from "../src/lib/mail/classify";
import { askCopilot } from "../src/lib/mail/replyAgent";
import { getMailStore } from "../src/lib/mail/store";
import type { InboxMessageRow } from "../src/lib/mail/types";
import { tokens } from "../src/lib/mail/replyLearning";
import { getCopilotBook, type CopilotBook } from "../src/lib/trade/copilot/book";
import { collectEarlyWarnings } from "../src/lib/trade/earlyWarnings";
import { findDealByRef, shortDealHref } from "../src/lib/trade/dealLink";
import type { CommercialDocument, Deal } from "../src/types/trade";

const args = process.argv.slice(2);
const ONLY = new Set(
  (args.includes("--only") ? args[args.indexOf("--only") + 1] : "1,2,3,4,5,6,7,8").split(",").map(Number),
);
const REFRESH = args.includes("--refresh");
const BASE = (process.env.COPILOT_BASE || "http://localhost:3000").replace(/\/$/, "");
const DIR = path.join(process.cwd(), "data", "mail-criteria");
const TODAY = new Date().toISOString().slice(0, 10);
const OURS = /@snspl\.(in|ml)$/i;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const rand = rng(11);
function shuffle<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

async function cached<T>(name: string, build: () => Promise<T>, refresh = false): Promise<T> {
  const file = path.join(DIR, "cache", `${name}.json`);
  if (!refresh) {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      /* build */
    }
  }
  const value = await build();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return value;
}

function firstJson(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start]!;
  const close = open === "[" ? "]" : "}";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Ask the checker model for JSON; one retry. */
async function askJson<T>(prompt: string, tag: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await askCopilot(
        `${prompt}\n\nAnswer with ONLY the JSON, no other text.`,
        `mail-criteria-${tag}`,
        120_000,
      );
      const json = firstJson(text);
      if (json) return json as T;
    } catch {
      /* retry */
    }
  }
  return null;
}

const pct = (k: number, n: number) => (n ? Math.round((100 * k) / n) : null);

/** Wilson 95% range in whole percent. */
function wilson(k: number, n: number) {
  if (!n) return null;
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { pct: Math.round(100 * p), low: Math.round(100 * Math.max(0, c - h)), high: Math.round(100 * Math.min(1, c + h)), k, n };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ */
/* data                                                                */
/* ------------------------------------------------------------------ */

type Mail = {
  key: string;
  mailbox: string;
  connectionId: string;
  threadKey: string;
  dealKey: string | null;
  status: string;
  folder: string | null;
  subject: string;
  from: string;
  fromName: string;
  to: string;
  cc: string;
  date: string;
  body: string;
  fresh: string;
  attachments: string[];
  ours: boolean;
};

async function loadMails(): Promise<{ mails: Mail[]; mailboxes: string[] }> {
  return cached(
    "mails",
    async () => {
      const store = getMailStore();
      const conns = (await store.listConnections()).filter((c) => c.status === "active");
      const ids = conns.map((c) => c.id);
      const emailOf = new Map(conns.map((c) => [c.id, c.email]));
      const keys: string[] = [];
      let before: { at: string; key: string } | null = null;
      for (;;) {
        const page = await store.inboxPage({ connectionIds: ids, limit: 100, before });
        keys.push(...page.threads.map((t) => t.thread_key));
        const last = page.threads[page.threads.length - 1];
        if (!page.has_more || !last) break;
        before = { at: last.last_at, key: last.thread_key };
      }
      const seen = new Map<string, Mail>();
      await pool(keys, 6, async (threadKey) => {
        const rows: InboxMessageRow[] = await store.threadMessages({ connectionIds: ids, threadKey, limit: 100 }).catch(() => []);
        for (const r of rows) {
          const key = r.internet_message_id || `${r.connection_id}:${r.provider_message_id}`;
          if (seen.has(key) || !r.sent_at) continue;
          const body = r.body_text || "";
          const from = (r.from_email || "").toLowerCase();
          seen.set(key, {
            key,
            mailbox: emailOf.get(r.connection_id) || r.connection_id,
            connectionId: r.connection_id,
            threadKey,
            dealKey: r.deal_key,
            status: r.status,
            folder: r.folder || null,
            subject: r.subject || "",
            from,
            fromName: r.from_name || "",
            to: r.to_text || "",
            cc: r.cc_text || "",
            date: r.sent_at,
            body,
            fresh: freshText(body),
            attachments: (r.attachments_json || []).map((a) => a.filename).filter(Boolean),
            ours: OURS.test(from),
          });
        }
      });
      const mails = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
      console.log(`Loaded ${mails.length} mails from ${keys.length} conversations in ${conns.map((c) => c.email).join(", ")}`);
      return { mails, mailboxes: conns.map((c) => c.email) };
    },
    REFRESH,
  );
}

function mailBlock(m: Mail, chars = 700) {
  return [
    `[${m.key.slice(0, 60)}] ${m.date.slice(0, 16)} · FROM ${m.fromName || m.from} <${m.from}> · TO ${clip(m.to, 160)}${m.cc ? ` · CC ${clip(m.cc, 120)}` : ""}`,
    `Subject: ${m.subject}`,
    m.attachments.length ? `Attachments: ${m.attachments.slice(0, 8).join(", ")}` : "",
    clip(m.fresh, chars),
  ]
    .filter(Boolean)
    .join("\n");
}

function dealMailText(mails: Mail[], max = 12, chars = 600) {
  return mails
    .slice(-max)
    .map((m) => `--- ${m.ours ? "US (SNSPL)" : "THEM"}\n${mailBlock(m, chars)}`)
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* 1. categorise                                                       */
/* ------------------------------------------------------------------ */

const STAGES = ["requirement", "quoting", "samples", "artwork", "pi_po", "inspection", "booking", "payment", "commission", "other"];
const STAGE_HELP =
  "requirement = buyer enquiry / new product need; quoting = prices, quotations, costing sheets; samples = samples, prototypes, lab dips; " +
  "artwork = artwork, dielines, print files, labels; pi_po = purchase orders, proforma invoices, order quantities; inspection = QC / inspection; " +
  "booking = freight, shipping booking, containers, B/L, forwarder; payment = payments, remittances, invoices due; commission = agency commission; " +
  "other = trade mail that fits none of these";

type CatRow = {
  key: string;
  mailbox: string;
  subject: string;
  from: string;
  system: { trade: boolean; stage: string; role: string };
  ai: { trade: boolean; stage: string; role: string } | null;
};

async function criterion1(mails: Mail[], mailboxes: string[]) {
  const rows = await cached("c1", async () => {
    const batches: Mail[][] = [];
    for (let i = 0; i < mails.length; i += 8) batches.push(mails.slice(i, i + 8));
    const out: CatRow[] = [];
    await pool(batches, 4, async (batch, bi) => {
      const ai = await askJson<{ id: number; trade: boolean; stage: string; sender_role: string }[]>(
        [
          "You are checking how a trade-sourcing agency's mailbox (SNSPL, a buying agency between overseas buyers and Indian factories) is categorised.",
          "For EACH mail below decide:",
          '- trade: true if it is about the agency\'s trade business (orders, products, samples, shipping, payments, buyers, factories); false for newsletters, ads, travel, bills, system notifications, spam.',
          `- stage: one of ${STAGES.join(", ")}. ${STAGE_HELP}.`,
          "- sender_role: buyer (overseas customer), factory (supplier/manufacturer), forwarder (freight/logistics/shipping line), internal (anyone @snspl.in), trader, or other.",
          'Return a JSON array: [{"id": <mail number>, "trade": true|false, "stage": "...", "sender_role": "..."}] with one entry per mail.',
          "",
          ...batch.map((m, i) => `### Mail ${i + 1}\n${mailBlock(m, 600)}`),
        ].join("\n"),
        "c1",
      );
      batch.forEach((m, i) => {
        const a = Array.isArray(ai) ? ai.find((x) => Number(x.id) === i + 1) : undefined;
        const role = partyRole(m.from, { ownEmails: mailboxes });
        out.push({
          key: m.key,
          mailbox: m.mailbox,
          subject: m.subject,
          from: m.from,
          system: { trade: m.status !== "noise", stage: stageOf(m.subject, m.fresh), role },
          ai: a
            ? {
                trade: Boolean(a.trade),
                stage: STAGES.includes(a.stage) ? a.stage : "other",
                role: String(a.sender_role || "other").toLowerCase(),
              }
            : null,
        });
      });
      if ((bi + 1) % 10 === 0) console.log(`  c1: ${bi + 1}/${batches.length} batches`);
    });
    return out;
  });
  const judged = rows.filter((r) => r.ai);
  const tradeBoth = judged.filter((r) => r.ai!.trade && r.system.trade);
  const external = judged.filter((r) => !OURS.test(r.from));
  const roleOk = (r: CatRow) => r.system.role === r.ai!.role || (r.system.role === "noise" && !r.ai!.trade);
  const confusion: Record<string, number> = {};
  for (const r of tradeBoth) if (r.system.stage !== r.ai!.stage) confusion[`${r.ai!.stage} → shown as ${r.system.stage}`] = (confusion[`${r.ai!.stage} → shown as ${r.system.stage}`] || 0) + 1;
  const byStage: Record<string, { n: number; ok: number }> = {};
  for (const r of tradeBoth) {
    const s = (byStage[r.ai!.stage] ||= { n: 0, ok: 0 });
    s.n++;
    if (r.system.stage === r.ai!.stage) s.ok++;
  }
  const missedTrade = judged.filter((r) => r.ai!.trade && !r.system.trade);
  const leakedNoise = judged.filter((r) => !r.ai!.trade && r.system.trade);
  return {
    mails: rows.length,
    judged: judged.length,
    tradeVsNoise: wilson(judged.filter((r) => r.ai!.trade === r.system.trade).length, judged.length),
    aiTradeShare: pct(judged.filter((r) => r.ai!.trade).length, judged.length),
    stage: wilson(tradeBoth.filter((r) => r.system.stage === r.ai!.stage).length, tradeBoth.length),
    role: wilson(external.filter(roleOk).length, external.length),
    roleUnknown: pct(external.filter((r) => r.system.role === "other" && r.ai!.role !== "other").length, external.length),
    byStage,
    topConfusions: Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 6),
    missedTrade: missedTrade.length,
    leakedNoise: leakedNoise.length,
    examples: {
      missedTrade: missedTrade.slice(0, 4).map((r) => ({ subject: r.subject, from: r.from })),
      wrongStage: tradeBoth.filter((r) => r.system.stage !== r.ai!.stage).slice(0, 5).map((r) => ({ subject: r.subject, system: r.system.stage, ai: r.ai!.stage })),
    },
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* 2. numbers                                                          */
/* ------------------------------------------------------------------ */

const FACT_KEY = /(amount|price|qty|quantit|total|date|po\b|po_|number|no\b|cbm|weight|etd|eta|due|ready|invoice|container|booking|value|usd|inr|rate|percent|commission|moq|cartons?|pcs|pieces)/i;
const SKIP_KEY = /(confidence|execution|_id$|^id$|agent|score|index|version|days?remaining)/i;

function factsOf(value: unknown, prefix = "", out: { path: string; value: string }[] = []) {
  if (out.length >= 24) return out;
  if (Array.isArray(value)) {
    value.slice(0, 6).forEach((v, i) => factsOf(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEY.test(k)) continue;
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") factsOf(v, p, out);
      else if ((typeof v === "number" || (typeof v === "string" && /\d/.test(v) && v.length <= 40)) && FACT_KEY.test(k)) {
        out.push({ path: p, value: String(v) });
      }
    }
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Is the value written somewhere in the mail text (numbers without separators, dates in common formats)? */
function inText(value: string, text: string) {
  const t = text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1");
  const v = value.toLowerCase().trim();
  if (t.includes(v)) return true;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) {
    const [, y, m, d] = iso;
    const dd = String(Number(d));
    const mm = String(Number(m));
    const mon = MONTHS[Number(m) - 1]!;
    return [
      `${d}.${m}.${y}`, `${d}/${m}/${y}`, `${d}-${m}-${y}`, `${dd}.${mm}.${y}`, `${dd}/${mm}/${y}`,
      `${d}.${m}.${y!.slice(2)}`, `${d}/${m}/${y!.slice(2)}`, `${dd} ${mon}`, `${dd}th ${mon}`, `${dd}st ${mon}`, `${dd}nd ${mon}`, `${dd}rd ${mon}`, `${mon} ${dd}`,
    ].some((f) => t.includes(f));
  }
  const n = Number(v.replace(/[^\d.]/g, ""));
  if (Number.isFinite(n) && n > 0 && /^[\d.,\s$a-z]*$/.test(v)) {
    const forms = new Set([String(n), n.toFixed(2), String(Math.round(n))]);
    return [...forms].some((f) => new RegExp(`(^|[^\\d.])${f.replace(".", "\\.")}([^\\d]|$)`).test(t));
  }
  return false;
}

async function criterion2(mails: Mail[], book: CopilotBook) {
  const byDeal = groupDeals(mails);
  const rowsIn = [...byDeal.entries()].filter(([k]) => book.byId.get(k)?.agentResult);
  const rows = await cached("c2", async () =>
    pool(rowsIn.slice(0, 140), 4, async ([dealKey, dm]) => {
      const deal = book.byId.get(dealKey)!;
      const facts = factsOf(deal.agentResult).filter((f) => !/^0+(\.0+)?$/.test(f.value));
      if (!facts.length) return { dealKey, code: deal.code, slot: deal.mailboxSlot || null, facts: [] as FactCheck[] };
      const text = dm.map((m) => `${m.subject}\n${m.fresh}`).join("\n");
      const ai = await askJson<{ n: number; verdict: string; correct_value?: string }[]>(
        [
          "A stage agent extracted these figures from a trade deal's emails and attached documents. Check each one against the emails below.",
          'For each figure return verdict "correct" (the emails support it), "wrong" (the emails show a different value for the same thing; give correct_value), or "not_in_mails" (the emails do not mention it; it may come from an attachment).',
          'Return a JSON array [{"n": <number>, "verdict": "...", "correct_value": "..."}].',
          "",
          "FIGURES:",
          ...facts.map((f, i) => `${i + 1}. ${f.path} = ${f.value}`),
          "",
          "EMAILS:",
          dealMailText(dm, 14, 900),
        ].join("\n"),
        "c2",
      );
      const checks: FactCheck[] = facts.map((f, i) => {
        const a = Array.isArray(ai) ? ai.find((x) => Number(x.n) === i + 1) : undefined;
        return {
          ...f,
          literal: inText(f.value, text),
          verdict: (a?.verdict as FactCheck["verdict"]) || null,
          correct: a?.correct_value ? String(a.correct_value) : null,
        };
      });
      return { dealKey, code: deal.code, slot: deal.mailboxSlot || null, facts: checks };
    }),
  );
  const all = rows.flatMap((r) => r.facts);
  const verified = all.filter((f) => f.verdict === "correct" || f.verdict === "wrong");
  const kind = (p: string) =>
    /date|etd|eta|due|ready/i.test(p) ? "Dates" : /po|invoice|booking|container|number|no\b/i.test(p) ? "Document numbers" : /qty|quantit|pcs|cartons|moq|cbm|weight/i.test(p) ? "Quantities" : "Prices & amounts";
  const byKind: Record<string, { checked: number; correct: number; notInMails: number }> = {};
  for (const f of all) {
    const k = (byKind[kind(f.path)] ||= { checked: 0, correct: 0, notInMails: 0 });
    if (f.verdict === "correct" || f.verdict === "wrong") k.checked++;
    if (f.verdict === "correct") k.correct++;
    if (f.verdict === "not_in_mails") k.notInMails++;
  }
  return {
    deals: rows.length,
    facts: all.length,
    accuracy: wilson(verified.filter((f) => f.verdict === "correct").length, verified.length),
    literalFound: pct(all.filter((f) => f.literal).length, all.length),
    notInMails: pct(all.filter((f) => f.verdict === "not_in_mails").length, all.length),
    byKind,
    wrong: all
      .map((f, i) => ({ ...f, deal: rows.find((r) => r.facts.includes(all[i]!))?.code }))
      .filter((f) => f.verdict === "wrong")
      .slice(0, 10),
    rows,
  };
}
type FactCheck = { path: string; value: string; literal: boolean; verdict: "correct" | "wrong" | "not_in_mails" | null; correct: string | null };

function groupDeals(mails: Mail[]) {
  const by = new Map<string, Mail[]>();
  for (const m of mails) {
    if (!m.dealKey) continue;
    by.set(m.dealKey, [...(by.get(m.dealKey) || []), m]);
  }
  return by;
}

/* ------------------------------------------------------------------ */
/* 3. predict the next action                                          */
/* ------------------------------------------------------------------ */

async function criterion3(mails: Mail[]) {
  const deals = [...groupDeals(mails).entries()].filter(([, dm]) => dm.length >= 3);
  const cases: { dealKey: string; context: Mail[]; actual: Mail[] }[] = [];
  for (const [dealKey, dm] of shuffle(deals)) {
    const idx = dm.map((m, i) => i).filter((i) => i >= 2 && dm[i]!.ours && !/^\s*(fw|fwd)\s*:/i.test(dm[i]!.subject));
    if (!idx.length) continue;
    const i = idx[Math.floor(rand() * idx.length)]!;
    const t = Date.parse(dm[i]!.date);
    const actual = dm.filter((m, j) => j >= i && m.ours && Date.parse(m.date) - t < 86_400_000).slice(0, 3);
    cases.push({ dealKey, context: dm.slice(Math.max(0, i - 10), i), actual });
    if (cases.length >= 60) break;
  }
  const rows = await cached("c3", async () =>
    pool(cases, 4, async (c) => {
      const pred = await askJson<{ action: string; by: string; to: string; based_on: string }>(
        [
          "You are the operations brain of SNSPL, a buying agency between overseas buyers and Indian factories.",
          "Read the emails of this deal so far (several threads, oldest to newest). Predict the single next action the SNSPL team will take by email.",
          'Return JSON {"action": "<what SNSPL does next, specific>", "by": "<SNSPL person>", "to": "<who it goes to>", "based_on": "<which mails / facts led you there>"}.',
          "",
          dealMailText(c.context, 10, 600),
        ].join("\n"),
        "c3p",
      );
      if (!pred) return { ...summaryOf(c), prediction: null, verdict: null };
      const verdict = await askJson<{ match: string; reason: string }>(
        [
          "Compare a predicted next action with what the team actually did next.",
          `PREDICTED: ${pred.action} (by ${pred.by}, to ${pred.to})`,
          "ACTUAL next email(s) from the team:",
          c.actual.map((m) => mailBlock(m, 700)).join("\n\n"),
          'Return JSON {"match": "yes" | "partly" | "no", "reason": "<one sentence>"}. "yes" = same action and recipient side; "partly" = right topic but different action or detail; "no" = different action.',
        ].join("\n"),
        "c3j",
      );
      return { ...summaryOf(c), prediction: pred, verdict };
    }),
  );
  const judged = rows.filter((r) => r.verdict);
  const multi = judged.filter((r) => r.threads > 1);
  return {
    cases: rows.length,
    judged: judged.length,
    exact: wilson(judged.filter((r) => r.verdict!.match === "yes").length, judged.length),
    exactOrPartly: wilson(judged.filter((r) => r.verdict!.match !== "no").length, judged.length),
    multiThread: { n: multi.length, exact: wilson(multi.filter((r) => r.verdict!.match === "yes").length, multi.length) },
    examples: judged.slice(0, 8).map((r) => ({ subject: r.subject, predicted: r.prediction!.action, actual: r.actual, match: r.verdict!.match, reason: r.verdict!.reason })),
    rows,
  };
}
function summaryOf(c: { dealKey: string; context: Mail[]; actual: Mail[] }) {
  return {
    dealKey: c.dealKey,
    subject: c.actual[0]!.subject,
    contextMails: c.context.length,
    threads: new Set(c.context.map((m) => m.threadKey)).size,
    actual: clip(oneLine(c.actual.map((m) => m.fresh).join(" / ")), 300),
  };
}

/* ------------------------------------------------------------------ */
/* 4. bottlenecks                                                      */
/* ------------------------------------------------------------------ */

async function criterion4(mails: Mail[], book: CopilotBook) {
  const byDeal = groupDeals(mails);
  const deals = [...byDeal.keys()].map((k) => book.byId.get(k)).filter((d): d is Deal => Boolean(d));
  const uniq = [...new Map(deals.map((d) => [d.id, d])).values()];
  const warnings = collectEarlyWarnings(uniq).filter((w) => w.dealId);
  const mailsOf = (d: Deal) => byDeal.get(d.mailboxSourceId || d.id) || [];
  const warned = new Set(warnings.map((w) => w.dealId));
  const quiet = shuffle(uniq.filter((d) => !warned.has(d.id) && mailsOf(d).length)).slice(0, 40);
  const res = await cached("c4", async () => {
    const checked = await pool(warnings, 4, async (w) => {
      const d = uniq.find((x) => x.id === w.dealId)!;
      const v = await askJson<{ real: string; reason: string }>(
        [
          `Today is ${TODAY}. The system raised this early warning on a trade deal: "${w.title}: ${w.reason}".`,
          "Read the deal's emails. Is this a real bottleneck that needs a person now?",
          'Return JSON {"real": "yes" | "no" | "unclear", "reason": "<one sentence>"}.',
          "",
          dealMailText(mailsOf(d), 12, 600),
        ].join("\n"),
        "c4w",
      );
      return { deal: d.code, kind: w.kind, severity: w.severity, title: w.title, reason: w.reason, verdict: v };
    });
    const missed = await pool(quiet, 4, async (d) => {
      const v = await askJson<{ bottleneck: boolean; what: string; waiting_on: string; since: string }>(
        [
          `Today is ${TODAY}. Read this trade deal's emails. Is anything stuck or at risk that needs a person: a reply we owe, a party not responding, a missing document or approval, a delay, a payment, a quality issue?`,
          'Return JSON {"bottleneck": true|false, "what": "<the bottleneck, or empty>", "waiting_on": "<buyer|factory|forwarder|us|other>", "since": "<date or empty>"}.',
          "",
          dealMailText(mailsOf(d), 12, 600),
        ].join("\n"),
        "c4m",
      );
      return { deal: d.code, verdict: v };
    });
    return { checked, missed };
  });
  const judged = res.checked.filter((c) => c.verdict && c.verdict.real !== "unclear");
  const byKind: Record<string, { n: number; real: number }> = {};
  for (const c of judged) {
    const k = (byKind[c.title] ||= { n: 0, real: 0 });
    k.n++;
    if (c.verdict!.real === "yes") k.real++;
  }
  const quietJudged = res.missed.filter((m) => m.verdict);
  const missedList = quietJudged.filter((m) => m.verdict!.bottleneck);
  return {
    deals: uniq.length,
    warnings: warnings.length,
    dealsWarned: warned.size,
    precision: wilson(judged.filter((c) => c.verdict!.real === "yes").length, judged.length),
    unclear: res.checked.filter((c) => c.verdict?.real === "unclear").length,
    byKind,
    quietChecked: quietJudged.length,
    missedRate: wilson(missedList.length, quietJudged.length),
    missedWaitingOn: missedList.reduce<Record<string, number>>((a, m) => ((a[m.verdict!.waiting_on] = (a[m.verdict!.waiting_on] || 0) + 1), a), {}),
    examples: {
      real: judged.filter((c) => c.verdict!.real === "yes").slice(0, 4),
      falseAlarms: judged.filter((c) => c.verdict!.real === "no").slice(0, 4),
      missed: missedList.slice(0, 5).map((m) => ({ deal: m.deal, what: m.verdict!.what, waitingOn: m.verdict!.waiting_on })),
    },
    rows: res,
  };
}

/* ------------------------------------------------------------------ */
/* 5. decisions with links                                             */
/* ------------------------------------------------------------------ */

async function criterion5(mails: Mail[], book: CopilotBook) {
  const byDeal = groupDeals(mails);
  const deals = [...byDeal.entries()]
    .map(([k, dm]) => ({ deal: book.byId.get(k), dm }))
    .filter((x): x is { deal: Deal; dm: Mail[] } => Boolean(x.deal) && x.dm.length >= 2)
    .sort((a, b) => b.dm[b.dm.length - 1]!.date.localeCompare(a.dm[a.dm.length - 1]!.date));
  const picked = [...new Map(deals.map((x) => [x.deal.id, x])).values()].slice(0, 15);
  const rows = await cached("c5", async () =>
    pool(picked, 2, async ({ deal, dm }) => {
      const contactId = `mail-criteria-c5-${deal.id.replace(/[^a-z0-9]/gi, "").slice(0, 30)}-${Date.now()}`;
      await fetch(`${BASE}/api/chat/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId }) }).catch(() => null);
      const q = "What decision do we need to take on this order right now? Give me the reason and link me to the emails it is based on.";
      let answer = "";
      let status = 0;
      try {
        const res = await fetch(`${BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId, message: q, focusDealId: deal.id, activeDealIds: [deal.id] }),
        });
        status = res.status;
        answer = await res.text();
      } catch (err) {
        answer = `error: ${String(err)}`;
      }
      const links = [...answer.matchAll(/\]\(([^)\s]+)\)|\bhttps?:\/\/[^\s)]+/g)].map((m) => m[1] || m[0]);
      const dealLinks = links.filter((l) => /\/deals\//.test(l));
      const okDeal = dealLinks.filter((l) => {
        const id = decodeURIComponent(l.replace(/^.*\/deals\//, "").split(/[?#]/)[0]!);
        const hit = book.byId.get(id) || findDealByRef(book.deals, id);
        return hit?.id === deal.id;
      });
      const mailLinks = links.filter((l) => /mailbox|message|mail\?|inbox|thread/i.test(l));
      const judge = await askJson<{ grounded: string; decision_useful: boolean; reason: string }>(
        [
          `A user asked the trade Copilot about deal ${deal.code}: "${q}"`,
          `COPILOT ANSWER:\n${clip(answer, 2500)}`,
          "DEAL RECORDS (what the stage agents extracted from the emails and their attachments):",
          dealRecords(deal),
          "DEAL EMAILS (newest last):",
          dealMailText(dm, 12, 700),
          'Return JSON {"grounded": "yes" | "partly" | "no", "decision_useful": true|false, "reason": "<one sentence>"}. ' +
            "grounded = every fact in the answer is supported by the emails or the deal records; partly = mostly supported with one or two unsupported details.",
        ].join("\n"),
        "c5j",
      );
      return {
        deal: deal.code,
        href: shortDealHref(deal),
        status,
        words: answer.split(/\s+/).filter(Boolean).length,
        links: links.length,
        dealLinks: dealLinks.length,
        dealLinksCorrect: okDeal.length,
        mailLinks: mailLinks.length,
        judge,
        answer: clip(answer, 1200),
      };
    }),
  );
  const ok = rows.filter((r) => r.status === 200);
  const judged = ok.filter((r) => r.judge);
  return {
    asked: rows.length,
    answered: ok.length,
    withAnyLink: wilson(ok.filter((r) => r.links > 0).length, ok.length),
    withCorrectDealLink: wilson(ok.filter((r) => r.dealLinksCorrect > 0).length, ok.length),
    withEmailLink: wilson(ok.filter((r) => r.mailLinks > 0).length, ok.length),
    grounded: wilson(judged.filter((r) => r.judge!.grounded === "yes").length, judged.length),
    groundedOrPartly: wilson(judged.filter((r) => r.judge!.grounded !== "no").length, judged.length),
    useful: wilson(judged.filter((r) => r.judge!.decision_useful).length, judged.length),
    examples: judged.slice(0, 3).map((r) => ({ deal: r.deal, answer: r.answer, grounded: r.judge!.grounded, reason: r.judge!.reason })),
    rows,
  };
}

function dealRecords(d: Deal) {
  const doc = (label: string, x?: CommercialDocument) =>
    x
      ? `- ${label} ${x.docNumber || ""}: ${x.totalAmount ?? "?"} ${x.currency || ""}, factory ${x.factory || "?"}, ready ${x.readyDate || "?"}, terms ${clip(x.paymentTerms || "?", 80)}`
      : "";
  return [
    `- Stage: ${d.stage}. Summary: ${clip(oneLine(d.title || ""), 300)}`,
    doc("PO", d.po),
    doc("PI", d.pi),
    d.payment ? `- Payment: ${d.payment.status}, due ${d.payment.dueDate || "?"}, ${d.payment.amountUsd ?? "?"} USD` : "",
    d.booking ? `- Booking: ${d.booking.bookingNumber || "?"} ETD ${d.booking.etd || "?"}, status ${d.booking.shipmentStatus || "?"}` : "",
    d.production ? `- Production: ready ${d.production.readyDate || "?"}, blockers ${(d.production.blockers || []).join("; ") || "none"}` : "",
    d.docsPack ? `- Docs pack: ${clip(JSON.stringify(d.docsPack).replace(/"raw":\{.*?\}/, ""), 300)}` : "",
    d.agentResult?.summary ? `- Agent summary: ${clip(String(d.agentResult.summary), 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* 6. structure                                                        */
/* ------------------------------------------------------------------ */

async function criterion6(mails: Mail[]) {
  // Incoming: does the fresh text the agents read still carry quoted history?
  const QUOTED = /^\s*(>|from:\s|sent:\s|-{3,}\s*original message|on .{5,160} wrote:)/im;
  const withHistory = mails.filter((m) => /\n\s*(from:|on .{5,160} wrote:|-{3,}\s*original)/i.test(m.body));
  const leaked = withHistory.filter((m) => QUOTED.test(m.fresh));
  const emptied = mails.filter((m) => m.body.trim().length > 40 && m.fresh.trim().length < 10);

  // Outgoing: Copilot reply drafts on these mailboxes (latest backtest run on --source mailboxes, live prompt v2).
  const runFile = await latestMailboxRun();
  const run = runFile ? (JSON.parse(await readFile(runFile, "utf8")) as { cases: { variant: string; draft: string | null; incoming: { fromName: string; from: string }; human: { fromName: string; body: string }; subject: string }[] }) : null;
  const drafts = (run?.cases || []).filter((c) => c.variant === "v2" && c.draft);
  const checks = drafts.map((c) => {
    const d = c.draft!;
    const lines = d.trim().split("\n");
    const first = (c.incoming.fromName || c.incoming.from).split(/[\s@.]/)[0]!.toLowerCase();
    const words = d.split(/\s+/).filter(Boolean).length;
    return {
      subject: c.subject,
      greeting: /^(dear|hi|hello)\b/i.test(lines[0] || ""),
      namesRecipient: first.length > 1 && (lines[0] || "").toLowerCase().includes(first),
      signOff: /\n\s*(regards|best regards|thanks|warm regards)[,.]?\s*\n\s*\S+/i.test(d),
      paragraphs: d.split(/\n\s*\n/).length >= 3,
      noMarkdown: !/(\*\*|^#|^\s*[-*]\s)/m.test(d),
      words,
      draft: d,
    };
  });
  const rated = await cached("c6", async () =>
    pool(checks, 4, async (c) => ({
      subject: c.subject,
      rating: await askJson<{ greeting: boolean; answers_first: boolean; next_step: boolean; closing: boolean; professional: boolean; score: number }>(
        [
          "Rate the STRUCTURE of this business email reply drafted for a trade agency (not whether the content is right).",
          'Return JSON {"greeting": bool, "answers_first": bool (gets to the point in the first sentence after the greeting), "next_step": bool (clear next step or owner), "closing": bool (proper sign-off with name), "professional": bool, "score": 1-5}.',
          "",
          c.draft,
        ].join("\n"),
        "c6",
      ),
    })),
  );
  const r = rated.filter((x) => x.rating);
  const share = (f: (x: (typeof checks)[number]) => boolean) => wilson(checks.filter(f).length, checks.length);
  return {
    incoming: {
      mails: mails.length,
      withQuotedHistory: withHistory.length,
      historyStripped: wilson(withHistory.length - leaked.length, withHistory.length),
      emptiedByStripping: emptied.length,
      leakedExamples: leaked.slice(0, 3).map((m) => m.subject),
    },
    drafts: {
      n: checks.length,
      greeting: share((c) => c.greeting),
      namesRecipient: share((c) => c.namesRecipient),
      signOff: share((c) => c.signOff),
      paragraphs: share((c) => c.paragraphs),
      noMarkdown: share((c) => c.noMarkdown),
      avgWords: checks.length ? Math.round(checks.reduce((a, c) => a + c.words, 0) / checks.length) : null,
      answersFirst: wilson(r.filter((x) => x.rating!.answers_first).length, r.length),
      nextStep: wilson(r.filter((x) => x.rating!.next_step).length, r.length),
      avgScore: r.length ? Math.round((10 * r.reduce((a, x) => a + Number(x.rating!.score || 0), 0)) / r.length) / 10 : null,
      example: checks[0]?.draft || null,
    },
  };
}

async function latestMailboxRun() {
  const { readdir } = await import("node:fs/promises");
  const dir = path.join(process.cwd(), "data", "reply-eval");
  const files = (await readdir(dir)).filter((f) => /^\d{4}-.*Z\.json$/.test(f)).sort().reverse();
  for (const f of files) {
    const run = JSON.parse(await readFile(path.join(dir, f), "utf8")) as { mode?: string };
    if (run.mode === "backtest-mailboxes") return path.join(dir, f);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 7. banking                                                          */
/* ------------------------------------------------------------------ */

const PAY_HINT = /\b(payment|remittance|remitted|swift|tt copy|t\/t|wire|credited|debit advice|bank advice|transfer|utr|advance received|balance payment|proof of payment)\b/i;

function poNumbersOf(d: Deal | undefined, m: Mail) {
  const set = new Set<string>();
  const norm = (s: string) => s.toUpperCase().replace(/^PO[#\s:-]*/, "").replace(/[^A-Z0-9]/g, "");
  for (const p of d?.mailboxPoNumbers || []) set.add(norm(p));
  for (const doc of [d?.po, d?.pi, ...(d?.commercialDocs || [])]) if (doc?.docNumber) set.add(norm(doc.docNumber));
  const k = poKey(m.subject);
  if (k) set.add(norm(k));
  set.delete("");
  return set;
}

function ownerOf(dm: Mail[]) {
  const c = new Map<string, number>();
  for (const m of dm) if (m.ours && !/^(accounts|occ|info)@/.test(m.from)) c.set(m.from, (c.get(m.from) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

async function criterion7(mails: Mail[], book: CopilotBook, c1: CatRow[] | null) {
  const aiPay = new Set((c1 || []).filter((r) => r.ai?.stage === "payment").map((r) => r.key));
  const cands = mails.filter((m) => m.status !== "noise" && (aiPay.has(m.key) || PAY_HINT.test(`${m.subject} ${m.fresh.slice(0, 1500)}`)));
  const byDeal = groupDeals(mails);
  const extracted = await cached("c7", async () => {
    const batches: Mail[][] = [];
    for (let i = 0; i < cands.length; i += 6) batches.push(cands.slice(i, i + 6));
    const out: Record<string, { payment: boolean; type: string; po_numbers: string[]; invoice_numbers: string[]; amount: number | null; currency: string | null }> = {};
    await pool(batches, 4, async (batch) => {
      const ai = await askJson<{ id: number; payment_related: boolean; type: string; po_numbers: string[]; invoice_numbers: string[]; amount: number | null; currency: string | null }[]>(
        [
          "For each email decide whether it is a payment intimation for a trade order and extract the details.",
          'type: "payment_received" (money reached us/the factory), "payment_sent" (someone says they paid / TT copy / remittance advice), "payment_request" (asking for payment / invoice due), "other".',
          'Return a JSON array [{"id": n, "payment_related": bool, "type": "...", "po_numbers": ["..."], "invoice_numbers": ["..."], "amount": number|null, "currency": "USD"|"INR"|...|null}].',
          "",
          ...batch.map((m, i) => `### Mail ${i + 1}\n${mailBlock(m, 1000)}`),
        ].join("\n"),
        "c7",
      );
      batch.forEach((m, i) => {
        const a = Array.isArray(ai) ? ai.find((x) => Number(x.id) === i + 1) : undefined;
        if (a) out[m.key] = { payment: Boolean(a.payment_related), type: a.type, po_numbers: a.po_numbers || [], invoice_numbers: a.invoice_numbers || [], amount: a.amount ?? null, currency: a.currency ?? null };
      });
    });
    return out;
  });
  const norm = (s: string) => s.toUpperCase().replace(/^PO[#\s:-]*/, "").replace(/[^A-Z0-9]/g, "");
  const rows = cands
    .filter((m) => extracted[m.key]?.payment && extracted[m.key]!.type !== "other")
    .map((m) => {
      const x = extracted[m.key]!;
      const deal = m.dealKey ? book.byId.get(m.dealKey) : undefined;
      const sysPos = poNumbersOf(deal, m);
      const mailPos = x.po_numbers.map(norm).filter(Boolean);
      const owner = m.dealKey ? ownerOf(byDeal.get(m.dealKey) || []) : null;
      const recipients = `${m.to} ${m.cc} ${m.mailbox}`.toLowerCase();
      const poTotal: CommercialDocument | undefined = deal?.po || deal?.pi;
      return {
        subject: m.subject,
        date: m.date.slice(0, 10),
        type: x.type,
        mailbox: m.mailbox,
        linkedToDeal: Boolean(deal),
        deal: deal?.code || null,
        mailPos,
        systemPos: [...sysPos],
        poMatch: mailPos.length ? mailPos.some((p) => sysPos.has(p) || [...sysPos].some((s) => s.endsWith(p) || p.endsWith(s))) : null,
        amount: x.amount,
        currency: x.currency,
        systemPayment: deal?.payment ? { status: deal.payment.status, amountUsd: deal.payment.amountUsd ?? null } : null,
        poTotal: poTotal?.totalAmount ?? null,
        poCurrency: poTotal?.currency ?? null,
        owner,
        reachedOwner: owner ? recipients.includes(owner) : null,
      };
    });
  const withPo = rows.filter((r) => r.mailPos.length);
  return {
    candidates: cands.length,
    paymentMails: rows.length,
    byType: rows.reduce<Record<string, number>>((a, r) => ((a[r.type] = (a[r.type] || 0) + 1), a), {}),
    linkedToDeal: wilson(rows.filter((r) => r.linkedToDeal).length, rows.length),
    mentionsPo: withPo.length,
    poMatched: wilson(withPo.filter((r) => r.poMatch).length, withPo.length),
    amountInMail: rows.filter((r) => r.amount != null).length,
    systemHasPayment: wilson(rows.filter((r) => r.systemPayment).length, rows.length),
    reconcilable: wilson(rows.filter((r) => r.amount != null && r.poTotal != null).length, rows.length),
    ownerKnown: rows.filter((r) => r.owner).length,
    reachedOwner: wilson(rows.filter((r) => r.reachedOwner).length, rows.filter((r) => r.owner).length),
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* 8. quotations                                                       */
/* ------------------------------------------------------------------ */

type BookLine = { dealCode: string; desc: string; tokens: Set<string>; itemCode: string; unitPrice: number | null; currency: string | null; factory: string | null; date: string; agreed: string | null; actual: string | null };

function bookLines(book: CopilotBook): BookLine[] {
  const out: BookLine[] = [];
  for (const d of book.deals) {
    const factoryParty = d.parties.find((p) => p.role === "factory")?.name || null;
    const agreed = d.po?.readyDate || d.pi?.readyDate || d.production?.readyDate || null;
    const actual = d.booking?.etd || null;
    for (const doc of [d.po, d.pi, ...(d.commercialDocs || [])]) {
      if (!doc) continue;
      for (const l of doc.lines || []) {
        const desc = `${l.description || ""} ${l.itemCode || ""}`.trim();
        if (!desc) continue;
        out.push({
          dealCode: d.code,
          desc,
          tokens: new Set(tokens(desc)),
          itemCode: (l.itemCode || "").toLowerCase(),
          unitPrice: typeof l.unitPrice === "number" && l.unitPrice > 0 ? l.unitPrice : null,
          currency: doc.currency || null,
          factory: doc.factory || factoryParty,
          date: doc.sentAt || d.updatedAt,
          agreed,
          actual,
        });
      }
    }
  }
  return out;
}

async function criterion8(mails: Mail[], book: CopilotBook, c1: CatRow[] | null) {
  const aiQuote = new Set((c1 || []).filter((r) => r.ai && ["requirement", "quoting"].includes(r.ai.stage)).map((r) => r.key));
  const cands = mails.filter(
    (m) => m.status !== "noise" && (aiQuote.has(m.key) || /\b(quotation|quote|rfq|enquiry|inquiry|costing|price ?list|best price|offer)\b/i.test(m.subject)),
  );
  const extracted = await cached("c8", async () => {
    const batches: Mail[][] = [];
    for (let i = 0; i < cands.length; i += 6) batches.push(cands.slice(i, i + 6));
    const out: Record<string, { quote: boolean; direction: string; items: { name: string; qty?: string }[] }> = {};
    await pool(batches, 4, async (batch) => {
      const ai = await askJson<{ id: number; is_quote_request: boolean; direction: string; items: { name: string; qty?: string }[] }[]>(
        [
          "For each email decide whether it asks for a price / quotation for products, and list the products asked about.",
          'direction: "buyer_asks_us" (a buyer asks SNSPL for prices), "we_ask_factory" (SNSPL asks a factory to quote), "factory_quotes" (a factory sends prices), "other".',
          'Return a JSON array [{"id": n, "is_quote_request": bool, "direction": "...", "items": [{"name": "<product as written>", "qty": "<if given>"}]}].',
          "",
          ...batch.map((m, i) => `### Mail ${i + 1}\n${mailBlock(m, 1000)}`),
        ].join("\n"),
        "c8",
      );
      batch.forEach((m, i) => {
        const a = Array.isArray(ai) ? ai.find((x) => Number(x.id) === i + 1) : undefined;
        if (a) out[m.key] = { quote: Boolean(a.is_quote_request), direction: a.direction, items: a.items || [] };
      });
    });
    return out;
  });
  const lines = bookLines(book);
  const rows = cands
    .filter((m) => extracted[m.key]?.quote && ["buyer_asks_us", "we_ask_factory"].includes(extracted[m.key]!.direction))
    .map((m) => {
      const x = extracted[m.key]!;
      const items = x.items.slice(0, 6).map((it) => {
        const q = tokens(it.name);
        const matches = lines
          .filter((l) => l.date < m.date)
          .map((l) => {
            const hit = q.filter((w) => l.tokens.has(w)).length;
            const code = l.itemCode && it.name.toLowerCase().includes(l.itemCode);
            return { l, score: code ? 1 : q.length ? hit / q.length : 0, hit };
          })
          .filter((s) => s.score >= 1 || (s.hit >= 2 && s.score >= 0.6))
          .sort((a, b) => b.score - a.score || b.l.date.localeCompare(a.l.date));
        const vendors = [...new Set(matches.map((s) => s.l.factory).filter(Boolean))].slice(0, 5) as string[];
        const priced = matches.filter((s) => s.l.unitPrice != null).sort((a, b) => b.l.date.localeCompare(a.l.date))[0];
        const dl = matches.find((s) => s.l.agreed && s.l.actual);
        const lateDays = dl ? Math.round((Date.parse(dl.l.actual!) - Date.parse(dl.l.agreed!)) / 86_400_000) : null;
        return {
          name: it.name,
          matches: matches.length,
          vendors,
          lastPrice: priced ? { price: priced.l.unitPrice, currency: priced.l.currency, deal: priced.l.dealCode, date: priced.l.date.slice(0, 10), item: priced.l.desc } : null,
          delivery: dl ? { agreed: dl.l.agreed!.slice(0, 10), actual: dl.l.actual!.slice(0, 10), lateDays: Number.isFinite(lateDays) ? lateDays : null, deal: dl.l.dealCode } : null,
        };
      });
      return { subject: m.subject, date: m.date.slice(0, 10), direction: x.direction, from: m.from, items };
    });
  const items = rows.flatMap((r) => r.items);
  return {
    candidates: cands.length,
    quoteRequests: rows.length,
    items: items.length,
    bookLines: lines.length,
    itemFound: wilson(items.filter((i) => i.matches).length, items.length),
    vendors: wilson(items.filter((i) => i.vendors.length).length, items.length),
    lastPrice: wilson(items.filter((i) => i.lastPrice).length, items.length),
    delivery: wilson(items.filter((i) => i.delivery).length, items.length),
    requestFullyAnswerable: wilson(rows.filter((r) => r.items.length && r.items.every((i) => i.vendors.length && i.lastPrice)).length, rows.length),
    rows,
  };
}

/* ------------------------------------------------------------------ */

async function main() {
  await mkdir(DIR, { recursive: true });
  const { mails, mailboxes } = await loadMails();
  const book = await getCopilotBook();
  console.log(`${mails.length} mails · ${mailboxes.join(", ")} · book ${book.deals.length} deals`);
  const resultsFile = path.join(DIR, "results.json");
  const results: Record<string, unknown> = await readFile(resultsFile, "utf8").then(JSON.parse).catch(() => ({}));
  results.meta = {
    generatedAt: new Date().toISOString(),
    mailboxes,
    mails: mails.length,
    conversations: new Set(mails.map((m) => m.threadKey)).size,
    deals: new Set(mails.map((m) => m.dealKey).filter(Boolean)).size,
    ours: mails.filter((m) => m.ours).length,
    noise: mails.filter((m) => m.status === "noise").length,
    from: mails[0]?.date.slice(0, 10),
    to: mails[mails.length - 1]?.date.slice(0, 10),
    perMailbox: mailboxes.map((mb) => ({ mailbox: mb, mails: mails.filter((m) => m.mailbox === mb).length })),
  };
  const save = () => writeFile(resultsFile, JSON.stringify(results, null, 1));
  const run = async (n: number, name: string, fn: () => Promise<unknown>) => {
    if (!ONLY.has(n)) return;
    const t0 = Date.now();
    console.log(`\n== ${n}. ${name}`);
    results[`c${n}`] = await fn();
    await save();
    const head = { ...(results[`c${n}`] as Record<string, unknown>) };
    delete head.rows;
    console.log(JSON.stringify(head, null, 1).slice(0, 1800));
    console.log(`  (${Math.round((Date.now() - t0) / 1000)}s)`);
  };
  await run(1, "Categorise emails", () => criterion1(mails, mailboxes));
  const c1 = ((results.c1 as { rows?: CatRow[] } | undefined)?.rows || null) as CatRow[] | null;
  await run(2, "Accuracy of numbers", () => criterion2(mails, book));
  await run(3, "Prediction of action", () => criterion3(mails));
  await run(4, "Identifying bottlenecks", () => criterion4(mails, book));
  await run(5, "Decisions with email links", () => criterion5(mails, book));
  await run(6, "Structure of email", () => criterion6(mails));
  await run(7, "Banking reconciliation", () => criterion7(mails, book, c1));
  await run(8, "Quotation requests", () => criterion8(mails, book, c1));
  await save();
  console.log(`\nSaved ${path.relative(process.cwd(), resultsFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
