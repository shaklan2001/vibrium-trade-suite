/**
 * Reply accuracy: how close the Copilot draft gets to the reply our person
 * actually sent. Used by the deal-book backtest (scripts/eval-reply-backtest.ts)
 * and, later, by live tracking of drafts vs sent replies. Client-safe (no I/O).
 *
 * Three independent signals, because no single one is trustworthy alone:
 *   - wording:  ROUGE-L F1 over words, greeting and sign-off removed
 *   - facts:    numbers / dates / PO and container refs the person used that the
 *               thread made knowable, and facts the draft made up
 *   - judge:    a second model grades the draft against the real reply
 */

export type JudgeVerdict = "send_as_is" | "minor_edits" | "major_edits" | "wrong";

export const VERDICT_LABELS: Record<JudgeVerdict, string> = {
  send_as_is: "Send as is",
  minor_edits: "Minor edits",
  major_edits: "Major edits",
  wrong: "Wrong",
};

export const VERDICT_ORDER: JudgeVerdict[] = ["send_as_is", "minor_edits", "major_edits", "wrong"];

/**
 * routine: acknowledge, confirm/agree, give a next step, or pass on information already in the thread.
 * decision: a commercial or quality call the person made (price counter, refusing a quantity, new request).
 * outside_info: rests on facts not in the thread (calls, WhatsApp, other mails, approvals received).
 */
export type ReplyType = "routine" | "decision" | "outside_info";

export const REPLY_TYPE_LABELS: Record<ReplyType, string> = {
  routine: "Routine",
  decision: "Business decision",
  outside_info: "Needs outside info",
};

export type JudgeResult = {
  verdict: JudgeVerdict;
  /** 1–5 overall. */
  score: number;
  sameIntent: boolean;
  factsCorrect: boolean;
  missing: string[];
  wrong: string[];
  /** What kind of reply the person sent — only `routine` can be fully drafted from the thread. */
  replyType: ReplyType;
  /** replyType is not routine: the real reply rests on a decision or on information outside the thread. */
  needsOutsideInfo: boolean;
  reason: string;
};

export type FactScore = {
  /** Facts in the real reply that the thread made knowable. */
  expected: string[];
  /** …of those, the ones the draft also has. */
  matched: string[];
  /** Facts in the real reply the AI had no way to know (not in the thread). */
  unknowable: string[];
  /** Facts in the draft that are in neither the thread nor the real reply. */
  invented: string[];
};

export type ReplyEvalCase = {
  id: string;
  /** Prompt version that drafted this reply (v1 = original, v2 = current). */
  variant: string;
  dealId: string;
  stage: string | null;
  slot: string | null;
  agentName: string;
  subject: string;
  /** The mail being answered. */
  incoming: { from: string; fromName: string; date: string | null; body: string };
  /** What our person sent. */
  human: { from: string; fromName: string; date: string | null; body: string };
  /** What Copilot drafted from the thread up to `incoming`. */
  draft: string | null;
  draftMs: number | null;
  error: string | null;
  similarity: number | null;
  facts: FactScore | null;
  judge: JudgeResult | null;
};

export type ReplyEvalRun = {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: "backtest";
  /** Deal facts/summary given to the draft (they are built from the whole deal, so this leaks the future). */
  withFacts: boolean;
  seed: number;
  pairsFound: number;
  dealsScanned: number;
  variants: string[];
  cases: ReplyEvalCase[];
};

/* ------------------------------------------------------------------ */
/* Text cleanup                                                        */
/* ------------------------------------------------------------------ */

const SIGN_OFF =
  /^\s*(best|kind|warm|with)?\s*(regards|rgds|thanks\s*(and|&)\s*regards|thanks\s*&\s*rgds|thank\s*you|thanks|cheers)\b[,.!]*\s*$/im;
const BOILERPLATE = /^\s*(important notice|disclaimer|confidentiality|this e-?mail and any|sent from my)\b/im;
const GREETING = /^\s*(dear|hi|hello|hey|good (morning|afternoon|evening))\b[^\n]{0,60}\n/i;

/** The message itself: no greeting line, sign-off, signature or legal footer. */
export function coreText(body: string) {
  let text = (body || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n");
  for (const re of [BOILERPLATE, SIGN_OFF]) {
    const m = re.exec(text);
    if (m && m.index > 0) text = text.slice(0, m.index);
  }
  text = text.replace(GREETING, "");
  return text.replace(/\n{2,}/g, "\n").trim();
}

function words(text: string) {
  return text.toLowerCase().match(/[a-z0-9]+(?:[.,/-][a-z0-9]+)*/g) || [];
}

/** ROUGE-L F1 over words (longest common subsequence), 0–1. */
export function similarity(a: string, b: string) {
  const x = words(coreText(a)).slice(0, 400);
  const y = words(coreText(b)).slice(0, 400);
  if (!x.length || !y.length) return 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    prev = cur;
  }
  const lcs = prev[y.length]!;
  if (!lcs) return 0;
  const p = lcs / y.length;
  const r = lcs / x.length;
  return (2 * p * r) / (p + r);
}

/* ------------------------------------------------------------------ */
/* Facts                                                               */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";

/**
 * Trade facts worth getting right: amounts, quantities, percentages, dates,
 * PO / invoice numbers and container ids. Normalised so "USD 1,200" and
 * "1200" match and "12 Oct" and "Oct 12th" match.
 */
export function extractFacts(text: string, { core = true }: { core?: boolean } = {}): string[] {
  const src = core ? coreText(text) : (text || "").replace(/\r/g, "");
  const out = new Set<string>();
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH}`, "gi");
  const monthDay = new RegExp(`\\b${MONTH}\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi");
  let m: RegExpExecArray | null;
  const taken: Array<[number, number]> = [];
  while ((m = dayMonth.exec(src))) {
    out.add(`date:${MONTHS[m[2]!.toLowerCase().slice(0, 3)]}-${Number(m[1])}`);
    taken.push([m.index, m.index + m[0].length]);
  }
  while ((m = monthDay.exec(src))) {
    out.add(`date:${MONTHS[m[1]!.toLowerCase().slice(0, 3)]}-${Number(m[2])}`);
    taken.push([m.index, m.index + m[0].length]);
  }
  const numeric = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/g;
  while ((m = numeric.exec(src))) {
    out.add(`date:${Number(m[2])}-${Number(m[1])}`);
    taken.push([m.index, m.index + m[0].length]);
  }
  const container = /\b[A-Z]{4}\d{7}\b/g;
  while ((m = container.exec(src))) {
    out.add(`ref:${m[0].toUpperCase()}`);
    taken.push([m.index, m.index + m[0].length]);
  }
  const inTaken = (i: number) => taken.some(([a, b]) => i >= a && i < b);
  const num = /(?<![\w.])(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?\s*(%|pcs|pc|units|cartons|ctns|kgs?|cbm|days)?/gi;
  while ((m = num.exec(src))) {
    if (inTaken(m.index)) continue;
    const n = Number(`${m[1]!.replace(/,/g, "")}${m[2] || ""}`);
    // Single digits are usually list numbers or "1 container"; years are not facts on their own.
    if (!Number.isFinite(n) || (n < 10 && !m[3]) || (n >= 2000 && n <= 2100 && !m[2] && !m[3])) continue;
    out.add(m[3] === "%" ? `pct:${n}` : `num:${n}`);
  }
  return [...out];
}

export function scoreFacts(draft: string, human: string, context: string): FactScore {
  const known = new Set(extractFacts(context, { core: false }));
  const humanFacts = extractFacts(human);
  const draftFacts = new Set(extractFacts(draft));
  const expected = humanFacts.filter((f) => known.has(f));
  return {
    expected,
    matched: expected.filter((f) => draftFacts.has(f)),
    unknowable: humanFacts.filter((f) => !known.has(f)),
    invented: [...draftFacts].filter((f) => !known.has(f) && !humanFacts.includes(f)),
  };
}

/* ------------------------------------------------------------------ */
/* Judge                                                               */
/* ------------------------------------------------------------------ */

export function judgePrompt(c: Pick<ReplyEvalCase, "incoming" | "human" | "draft" | "subject">) {
  return [
    "You grade an AI-drafted business email reply against the reply a person actually sent.",
    "Context: Savvy Net Sourcing (SNSPL) is a buying agency between overseas buyers and Indian factories.",
    "The REAL reply is the reference. The person may have known things not in the thread (calls, internal prices);",
    "do not punish the draft for missing facts it could not have known — but do punish anything it states that is wrong or invented.",
    "",
    "Return ONLY one JSON object, no markdown, with exactly these keys:",
    '{"verdict":"send_as_is|minor_edits|major_edits|wrong","score":1-5,"same_intent":true|false,"facts_correct":true|false,"reply_type":"routine|decision|outside_info","missing":["…"],"wrong":["…"],"reason":"one sentence"}',
    "- send_as_is: says what the real reply says; a person could send it unchanged.",
    "- minor_edits: right message, small wording or detail fixes.",
    "- major_edits: partly right, but important points missing or changed.",
    "- wrong: different intent, or states something false / invented.",
    "- A placeholder such as [date] or [price] for a figure the thread does not contain is a minor edit, not an error.",
    "reply_type describes the REAL reply (grade the verdict against it either way):",
    "- routine: it acknowledges, confirms or agrees, gives a next step, or passes on information already in the thread.",
    "- decision: the person made a commercial or quality call the thread does not dictate (counter-offers a price, refuses or",
    "  changes a quantity, asks for corrections nobody flagged, adds a new request or product).",
    "- outside_info: it rests on facts not in the thread (a phone or WhatsApp discussion, another mail, an approval received, factory status).",
    "",
    `Subject: ${c.subject}`,
    "",
    `INCOMING MAIL from ${c.incoming.fromName || c.incoming.from}:`,
    c.incoming.body.slice(0, 1500),
    "",
    "REAL REPLY (sent by our person):",
    coreText(c.human.body).slice(0, 1500),
    "",
    "AI DRAFT:",
    coreText(c.draft || "").slice(0, 1500),
  ].join("\n");
}

const VERDICTS = new Set<string>(VERDICT_ORDER);

export function parseJudge(text: string): JudgeResult | null {
  const raw = /\{[\s\S]*\}/.exec(text.replace(/```(json)?/g, ""))?.[0];
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const verdict = String(j.verdict || "").trim();
    if (!VERDICTS.has(verdict)) return null;
    const replyType: ReplyType =
      j.reply_type === "decision" || j.reply_type === "outside_info" ? j.reply_type : "routine";
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 6) : []);
    return {
      verdict: verdict as JudgeVerdict,
      score: Math.min(5, Math.max(1, Math.round(Number(j.score) || 1))),
      sameIntent: j.same_intent === true,
      factsCorrect: j.facts_correct === true,
      missing: list(j.missing),
      wrong: list(j.wrong),
      replyType,
      needsOutsideInfo: replyType !== "routine",
      reason: String(j.reason || "").slice(0, 400),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Roll-up                                                             */
/* ------------------------------------------------------------------ */

export type ReplyEvalStats = {
  cases: number;
  drafted: number;
  judged: number;
  /** Judge said send as is or minor edits — the headline accuracy. */
  usable: number | null;
  /** Judged cases whose real reply was routine (the thread alone could produce it). */
  answerable: number;
  /** `usable` over the answerable cases only — what the AI can fairly be held to. */
  usableAnswerable: number | null;
  verdicts: Record<JudgeVerdict, number>;
  avgScore: number | null;
  sameIntent: number | null;
  similarity: number | null;
  /** Of the knowable facts in real replies, share the draft got. */
  factRecall: number | null;
  /** Share of drafts that made up at least one fact. */
  inventedRate: number | null;
  avgDraftMs: number | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(cases: ReplyEvalCase[]): ReplyEvalStats {
  const drafted = cases.filter((c) => c.draft);
  const judged = drafted.filter((c) => c.judge);
  const verdicts = Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0])) as Record<JudgeVerdict, number>;
  for (const c of judged) verdicts[c.judge!.verdict]++;
  const fair = judged.filter((c) => !c.judge!.needsOutsideInfo);
  const ok = (c: ReplyEvalCase) => c.judge!.verdict === "send_as_is" || c.judge!.verdict === "minor_edits";
  const expected = drafted.reduce((n, c) => n + (c.facts?.expected.length || 0), 0);
  const matched = drafted.reduce((n, c) => n + (c.facts?.matched.length || 0), 0);
  return {
    cases: cases.length,
    drafted: drafted.length,
    judged: judged.length,
    usable: judged.length ? (verdicts.send_as_is + verdicts.minor_edits) / judged.length : null,
    answerable: fair.length,
    usableAnswerable: fair.length ? fair.filter(ok).length / fair.length : null,
    verdicts,
    avgScore: mean(judged.map((c) => c.judge!.score)),
    sameIntent: judged.length ? judged.filter((c) => c.judge!.sameIntent).length / judged.length : null,
    similarity: mean(drafted.map((c) => c.similarity ?? 0)),
    factRecall: expected ? matched / expected : null,
    inventedRate: drafted.length ? drafted.filter((c) => c.facts?.invented.length).length / drafted.length : null,
    avgDraftMs: mean(drafted.map((c) => c.draftMs ?? 0).filter(Boolean)),
  };
}

export function groupBy<K extends string>(cases: ReplyEvalCase[], key: (c: ReplyEvalCase) => K) {
  const map = new Map<K, ReplyEvalCase[]>();
  for (const c of cases) {
    const k = key(c);
    map.set(k, [...(map.get(k) || []), c]);
  }
  return [...map.entries()].map(([k, list]) => ({ key: k, stats: summarize(list) }));
}
