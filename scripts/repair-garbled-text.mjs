#!/usr/bin/env node
/**
 * Repair PST email text that was decoded as UTF-16 by mistake (it shows as
 * Chinese characters, e.g. the EGSU9502813 Waldos thread).
 *
 * The old extract.py tried UTF-16 before cp1252, so an 8-bit body like
 * "<html><head>…" became "格浴㹬…". That is reversible: re-encode the run as
 * UTF-16LE and decode the bytes as UTF-8 / cp1252. Real Chinese text does not
 * come back as readable Latin text, so it is left alone.
 *
 *   node --env-file=.env.local scripts/repair-garbled-text.mjs            # dry run, report only
 *   node --env-file=.env.local scripts/repair-garbled-text.mjs --id "po:G2625040"
 *   node --env-file=.env.local scripts/repair-garbled-text.mjs --apply    # write (needs proxy action patch_evidence)
 *
 * Writes a report to data/repair-garbled-text.json.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ONLY = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;
const CONCURRENCY = 6;

const lambda = new LambdaClient({ region: process.env.AWS_REGION || "ap-south-1" });
const FN = process.env.TRADE_SUITE_RDS_PROXY_NAME || "trade-suite-rds-proxy";

async function call(payload) {
  const res = await lambda.send(
    new InvokeCommand({ FunctionName: FN, Payload: Buffer.from(JSON.stringify(payload)) }),
  );
  const text = Buffer.from(res.Payload || []).toString("utf8");
  if (res.FunctionError) throw new Error(text.slice(0, 400));
  const json = JSON.parse(text);
  if (!json.success) throw new Error(json.error || "proxy failed");
  return json;
}

/* ------------------------------------------------------------------ */
/* Repair                                                              */
/* ------------------------------------------------------------------ */

// Each garbled char is two 8-bit bytes, so it is always above U+00FF.
const WIDE_RUN = /[Ā-￿]{8,}/g;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const cp1252 = new TextDecoder("windows-1252");

function readableShare(s) {
  if (!s.length) return 0;
  let ok = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x20 && c < 0x7f) || c === 9 || c === 10 || c === 13 || (c >= 0xa0 && c <= 0x24f) || (c >= 0x2010 && c <= 0x20ac)) ok++;
  }
  return ok / s.length;
}

function repairRun(run) {
  const bytes = Buffer.from(run, "utf16le");
  let out;
  try {
    out = utf8.decode(bytes);
  } catch {
    out = cp1252.decode(bytes);
  }
  out = out.replace(/\u0000/g, "");
  return readableShare(out) >= 0.9 ? out : null;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Returns the repaired text, or null when nothing in it was garbled. */
export function repairText(text) {
  if (typeof text !== "string" || !WIDE_RUN.test(text)) return null;
  WIDE_RUN.lastIndex = 0;
  let changed = false;
  const out = text.replace(WIDE_RUN, (run) => {
    const fixed = repairRun(run);
    if (fixed == null) return run;
    changed = true;
    // Only the repaired run is HTML; the rest may hold "<name@domain>" headers.
    return /<(html|body|div|p|table)[\s>]/i.test(fixed) ? htmlToText(fixed) : fixed;
  });
  return changed ? out : null;
}

/* ------------------------------------------------------------------ */
/* Walk the book                                                       */
/* ------------------------------------------------------------------ */

async function dealIds() {
  if (ONLY) return [ONLY];
  const ids = [];
  for (let offset = 0; ; offset += 500) {
    const page = await call({ action: "list_deals", limit: 500, offset });
    for (const d of page.data || []) if (d.has_evidence) ids.push(d.id);
    if (!page.data || page.data.length < 500) break;
  }
  return ids;
}

function repairEvidence(evidence) {
  const fixes = [];
  for (const [i, m] of (evidence.messages || []).entries()) {
    for (const field of ["body", "subject"]) {
      const fixed = repairText(m[field]);
      if (fixed != null) {
        fixes.push({ message: i, field, before: m[field].slice(0, 60), after: fixed.slice(0, 160) });
        m[field] = fixed;
      }
    }
  }
  const email = repairText(evidence.email_text);
  if (email != null) {
    fixes.push({ message: null, field: "email_text", before: evidence.email_text.slice(0, 60), after: email.slice(0, 160) });
    evidence.email_text = email;
  }
  return fixes;
}

async function main() {
  const ids = await dealIds();
  console.log(`${APPLY ? "APPLY" : "Dry run"}: checking ${ids.length} deal(s)`);
  const report = [];
  let done = 0;
  const queue = [...ids];
  async function worker() {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const row = (await call({ action: "get_evidence", id })).data;
        let evidence = row?.evidence_json;
        if (typeof evidence === "string") evidence = JSON.parse(evidence);
        if (evidence && typeof evidence === "object") {
          const fixes = repairEvidence(evidence);
          if (fixes.length) {
            report.push({ id, fixes });
            if (APPLY) await call({ action: "patch_evidence", id, evidence_json: evidence });
          }
        }
      } catch (err) {
        report.push({ id, error: String(err.message || err).slice(0, 300) });
      }
      if (++done % 100 === 0) console.log(`  ${done}/${ids.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const fixed = report.filter((r) => r.fixes);
  const errors = report.filter((r) => r.error);
  const out = path.resolve("data/repair-garbled-text.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ apply: APPLY, checked: ids.length, report }, null, 2));
  console.log(
    `${fixed.length} deal(s) with garbled text (${fixed.reduce((n, r) => n + r.fixes.length, 0)} fields)` +
      `${APPLY ? " repaired" : " would be repaired"} · ${errors.length} error(s) · report: ${out}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
