/**
 * Live reply accuracy (Stage 2): how much people change the AI drafts they send from the Inbox.
 *
 *   npx tsx --env-file=.env.local scripts/reply-live-report.ts                 # all logged drafts
 *   npx tsx --env-file=.env.local scripts/reply-live-report.ts --since 2026-11-01
 *
 * Reads mail_reply_drafts (logged by /api/mail/draft, completed by /api/mail/reply) and writes,
 * under data/reply-eval/ (gitignored — it holds mail text):
 *   live-<date>-records.csv   one row per draft: who, when, edit level, similarity, draft and sent text
 *   live-<date>-summary.json  ready-to-send rate with a 95% range, by edit level, drafter, person and week
 */
import { mkdir, writeFile } from "node:fs/promises";
import { EDIT_LEVEL_LABELS, EDIT_LEVEL_ORDER, isReady, type DraftLogRow } from "../src/lib/mail/draftLog";
import { getMailStore } from "../src/lib/mail/store";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

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

const pct = (w: ReturnType<typeof wilson>) =>
  w ? `${Math.round(w.rate * 100)}% (${Math.round(w.low * 100)}–${Math.round(w.high * 100)}%, n=${w.n})` : "—";

function block(rows: DraftLogRow[]) {
  const sent = rows.filter((r) => r.sent_at && r.edit_level);
  const levels = Object.fromEntries(EDIT_LEVEL_ORDER.map((l) => [l, sent.filter((r) => r.edit_level === l).length]));
  const sims = sent.map((r) => Number(r.similarity) || 0);
  return {
    drafted: rows.length,
    sentFromDraft: sent.length,
    ready: wilson(sent.filter((r) => isReady(r.edit_level)).length, sent.length),
    levels,
    avgSimilarity: sims.length ? Math.round((sims.reduce((a, b) => a + b, 0) / sims.length) * 100) / 100 : null,
  };
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[key(x)] ||= []).push(x);
  return out;
}

/** ISO week start (Monday), YYYY-MM-DD. */
function weekOf(iso: string) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const csv = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const since = arg("since") || null;
  // Only drafts the Inbox showed (copilot / template); deploy self-checks are logged as "selftest".
  const rows = (await getMailStore().listDrafts({ limit: 5000, since })).filter((r) => r.drafted_by !== "selftest");
  const at = (r: DraftLogRow) => new Date(r.drafted_at).toISOString();

  const summary = {
    generatedAt: new Date().toISOString(),
    since,
    overall: block(rows),
    byDrafter: Object.fromEntries(Object.entries(groupBy(rows, (r) => r.drafted_by)).map(([k, v]) => [k, block(v)])),
    byPerson: Object.fromEntries(Object.entries(groupBy(rows, (r) => r.signer || "unknown")).map(([k, v]) => [k, block(v)])),
    byWeek: Object.fromEntries(
      Object.entries(groupBy(rows, (r) => weekOf(at(r))))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, block(v)]),
    ),
  };

  const o = summary.overall;
  console.log(`Live reply accuracy${since ? ` since ${since}` : ""}`);
  console.log(`Drafts shown ${o.drafted} · sent from a draft ${o.sentFromDraft}`);
  console.log(`Ready to send (sent as drafted or light edits): ${pct(o.ready)}`);
  for (const l of EDIT_LEVEL_ORDER) console.log(`  ${EDIT_LEVEL_LABELS[l]}: ${o.levels[l]}`);
  console.log(`Average similarity draft→sent: ${o.avgSimilarity ?? "—"}`);
  for (const [k, b] of Object.entries(summary.byDrafter)) console.log(`  drafter ${k}: ${pct(b.ready)}`);
  for (const [k, b] of Object.entries(summary.byWeek)) console.log(`  week of ${k}: ${pct(b.ready)} · ${b.drafted} drafts`);

  const header = ["id", "drafted_at", "sent_at", "signer", "drafted_by", "prompt_version", "deal_key", "edit_level", "similarity", "draft_body", "sent_body"];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [r.id, at(r), r.sent_at ? new Date(r.sent_at).toISOString() : "", r.signer, r.drafted_by, r.prompt_version, r.deal_key, r.edit_level, r.similarity, r.draft_body, r.sent_body]
        .map(csv)
        .join(","),
    ),
  ];
  await mkdir("data/reply-eval", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  await writeFile(`data/reply-eval/live-${stamp}-records.csv`, lines.join("\n"));
  await writeFile(`data/reply-eval/live-${stamp}-summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\nWrote data/reply-eval/live-${stamp}-records.csv and -summary.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
