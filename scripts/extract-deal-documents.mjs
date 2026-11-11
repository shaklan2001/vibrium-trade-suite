#!/usr/bin/env node
/**
 * Read every PI / PO / invoice on mailbox deals (Phase 3 backfill).
 * Talks to POST /api/processed-deals/documents on a running app, which does
 * the work (S3, Vibrium agents, RDS proxy). Each read is a paid agent run.
 *
 *   node --env-file=.env.local scripts/extract-deal-documents.mjs --ids "po:G2625017;po:G2625063"
 *   node --env-file=.env.local scripts/extract-deal-documents.mjs --all            # dry run: plan + cost
 *   node --env-file=.env.local scripts/extract-deal-documents.mjs --all --apply    # start the reads
 *   node --env-file=.env.local scripts/extract-deal-documents.mjs --finalize       # collect finished reads
 *
 * Options: --base http://localhost:3000 (default) · --limit 10 (reads started per batch)
 * Report: data/extract-deal-documents.json
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const BASE = opt("--base", "http://localhost:3000").replace(/\/+$/, "");
const APPLY = flag("--apply");
const LIMIT = Number(opt("--limit", 10));
const BATCH = 20;
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.error("CRON_SECRET is not set (run with --env-file=.env.local)");
  process.exit(1);
}

async function route(body) {
  const res = await fetch(`${BASE}/api/processed-deals/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function allDealIds() {
  const lambda = new LambdaClient({ region: process.env.AWS_REGION || "ap-south-1" });
  const fn = process.env.TRADE_SUITE_RDS_PROXY_NAME || "trade-suite-rds-proxy";
  const ids = [];
  for (let offset = 0; ; offset += 500) {
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: fn,
        Payload: Buffer.from(JSON.stringify({ action: "list_deals", limit: 500, offset })),
      }),
    );
    const page = JSON.parse(Buffer.from(res.Payload || []).toString("utf8"));
    if (!page.success) throw new Error(page.error || "list_deals failed");
    for (const d of page.data || []) if (d.has_evidence && (d.doc_count || 0) > 0) ids.push(d.id);
    if ((page.data || []).length < 500) break;
  }
  return ids;
}

async function main() {
  if (flag("--finalize")) {
    console.log(await route({ finalize: true }));
    return;
  }
  const ids = flag("--all")
    ? await allDealIds()
    : String(opt("--ids", "")).split(";").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    console.error("Pass --ids \"po:…;po:…\" (semicolon-separated) or --all");
    process.exit(1);
  }
  console.log(`${APPLY ? "APPLY" : "Dry run"}: ${ids.length} deal(s) via ${BASE}`);

  const total = { deals: 0, toRead: [], skipped: [], alreadyRead: 0, started: 0, failed: 0, errors: [] };
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    try {
      const r = await route({ ids: batch, dryRun: !APPLY, limit: LIMIT });
      total.deals += r.deals || 0;
      total.toRead.push(...(r.toRead || []).map(({ dealId, name, slot, sentAt }) => ({ dealId, name, slot, sentAt })));
      total.skipped.push(...(r.skipped || []));
      total.alreadyRead += r.alreadyRead || 0;
      total.started += r.started || 0;
      total.failed += r.failed || 0;
    } catch (err) {
      total.errors.push({ batch, error: String(err.message || err) });
    }
    console.log(`  ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
  }

  const reasons = {};
  for (const s of total.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  const out = path.resolve("data/extract-deal-documents.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ apply: APPLY, ...total, skippedByReason: reasons }, null, 2));
  console.log(
    `${total.toRead.length} document(s) ${APPLY ? `planned, ${total.started} started` : "to read"}` +
      ` (≈ $${(total.toRead.length * 0.05).toFixed(2)}) · ${total.alreadyRead} already read · ` +
      `${total.skipped.length} skipped ${JSON.stringify(reasons)} · ${total.errors.length} batch error(s)\nreport: ${out}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
