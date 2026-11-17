/**
 * Turn a reply backtest run into records + numbers for the report.
 *
 *   npx tsx scripts/reply-eval-report.ts                      # data/reply-eval/latest.json
 *   npx tsx scripts/reply-eval-report.ts data/reply-eval/<run>.json
 *
 * Writes next to the run (gitignored — it holds mail text):
 *   <run>-records.csv   one row per drafted reply (prompt version, stage, verdict, scores, texts)
 *   <run>-summary.json  per prompt: overall, by reply type, by stage — each rate with a 95% range
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  REPLY_TYPE_LABELS,
  VERDICT_ORDER,
  coreText,
  summarize,
  type ReplyEvalCase,
  type ReplyEvalRun,
  type ReplyType,
} from "../src/lib/mail/replyEval";

const file = path.resolve(process.argv[2] || "data/reply-eval/latest.json");

/** Wilson score interval, 95%. */
function wilson(ok: number, n: number) {
  if (!n) return null;
  const z = 1.96;
  const p = ok / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { rate: p, low: Math.max(0, c - h), high: Math.min(1, c + h), ok, n };
}

const usableOk = (c: ReplyEvalCase) => c.judge?.verdict === "send_as_is" || c.judge?.verdict === "minor_edits";

function block(cases: ReplyEvalCase[]) {
  const judged = cases.filter((c) => c.judge);
  const s = summarize(cases);
  return {
    replies: cases.length,
    judged: judged.length,
    usable: wilson(judged.filter(usableOk).length, judged.length),
    sendAsIs: wilson(judged.filter((c) => c.judge!.verdict === "send_as_is").length, judged.length),
    sameIntent: wilson(judged.filter((c) => c.judge!.sameIntent).length, judged.length),
    factsCorrect: wilson(judged.filter((c) => c.judge!.factsCorrect).length, judged.length),
    madeUpFacts: wilson(
      cases.filter((c) => c.draft && c.facts?.invented.length).length,
      cases.filter((c) => c.draft).length,
    ),
    factRecall: s.factRecall,
    avgScore: s.avgScore,
    wordingOverlap: s.similarity,
    verdicts: s.verdicts,
    avgDraftSeconds: s.avgDraftMs == null ? null : s.avgDraftMs / 1000,
    avgDraftWords: avg(cases.filter((c) => c.draft).map((c) => words(c.draft!))),
    avgRealReplyWords: avg(cases.map((c) => words(coreText(c.human.body)))),
  };
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const run = JSON.parse(await readFile(file, "utf8")) as ReplyEvalRun;
  const variants = run.variants?.length ? run.variants : [...new Set(run.cases.map((c) => c.variant || "v2"))];
  const base = file.replace(/\.json$/, "").replace(/latest$/, run.id);

  const header = [
    "record", "prompt", "deal", "stage", "agent", "subject", "their_mail_date", "reply_date", "replied_by",
    "reply_type", "verdict", "score_1_5", "same_intent", "facts_correct", "wording_overlap",
    "knowable_facts", "facts_matched", "made_up_facts", "draft_seconds", "judge_reason", "missed", "wrong_or_extra",
    "their_mail", "real_reply", "ai_draft", "error",
  ];
  const rows = run.cases.map((c, i) =>
    [
      i + 1, c.variant || "v2", c.dealId, c.stage, c.agentName, c.subject, c.incoming.date, c.human.date, c.human.from,
      c.judge ? REPLY_TYPE_LABELS[c.judge.replyType] : "", c.judge?.verdict, c.judge?.score, c.judge?.sameIntent,
      c.judge?.factsCorrect, c.similarity?.toFixed(3), c.facts?.expected.length, c.facts?.matched.length,
      c.facts?.invented.join(" "), c.draftMs ? (c.draftMs / 1000).toFixed(1) : "", c.judge?.reason,
      c.judge?.missing.join(" | "), c.judge?.wrong.join(" | "), c.incoming.body, coreText(c.human.body), c.draft, c.error,
    ].map(csvCell).join(","),
  );
  await writeFile(`${base}-records.csv`, [header.join(","), ...rows].join("\n"));

  const types: ReplyType[] = ["routine", "decision", "outside_info"];
  const summary = {
    run: run.id,
    finishedAt: run.finishedAt,
    dealsScanned: run.dealsScanned,
    pairsFound: run.pairsFound,
    withFacts: run.withFacts,
    verdictOrder: VERDICT_ORDER,
    prompts: Object.fromEntries(
      variants.map((v) => {
        const cases = run.cases.filter((c) => (c.variant || "v2") === v);
        const stages = [...new Set(cases.map((c) => c.stage || "none"))];
        return [
          v,
          {
            overall: block(cases),
            byReplyType: Object.fromEntries(types.map((t) => [t, block(cases.filter((c) => c.judge?.replyType === t))])),
            byStage: Object.fromEntries(stages.map((st) => [st, block(cases.filter((c) => (c.stage || "none") === st))])),
          },
        ];
      }),
    ),
  };
  await writeFile(`${base}-summary.json`, JSON.stringify(summary, null, 1));

  const pct = (w: ReturnType<typeof wilson>) =>
    w ? `${Math.round(w.rate * 100)}% (${Math.round(w.low * 100)}–${Math.round(w.high * 100)}%, n=${w.n})` : "—";
  for (const v of variants) {
    const p = summary.prompts[v]!;
    console.log(`\n== ${v} ==`);
    console.log(`usable ${pct(p.overall.usable)} · same intent ${pct(p.overall.sameIntent)} · made-up ${pct(p.overall.madeUpFacts)}`);
    for (const t of types) console.log(`  ${t}: usable ${pct(p.byReplyType[t]!.usable)}`);
  }
  console.log(`\nWrote ${path.relative(process.cwd(), base)}-records.csv and -summary.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
