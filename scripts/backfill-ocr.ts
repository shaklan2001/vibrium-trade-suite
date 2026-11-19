/**
 * OCR every scanned PDF / photographed document already stored (document layer, Phase 2: AWS Textract).
 *
 *   npx tsx --env-file=.env.local scripts/backfill-ocr.ts --dry    # count candidates only
 *   npx tsx --env-file=.env.local scripts/backfill-ocr.ts          # OCR them and wait for the results
 *
 * Candidates: attachments in the connected mailboxes, plus the stored files on deals that have payment
 * emails (archive POs / invoices live there). New mail is OCR'd by the sync itself.
 * Writes data/docs/ocr-backfill.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { ensureDocText, getDocText, isDocumentImage, type StoredFile } from "../src/lib/mail/docStore";
import { ocrEngine, processOcr, startOcr, stopOcr, wantsOcr } from "../src/lib/mail/ocr";
import { getMailStore } from "../src/lib/mail/store";
import type { InboxMessageRow } from "../src/lib/mail/types";
import { invokeTradeSuiteRds } from "../src/lib/rdsProxy";
import { digestFromIngestPath } from "../src/lib/trade/ingestFiles";
import type { EvidencePayload, ProcessedDealRow } from "../src/lib/trade/processedDealMapper";

const DRY = process.argv.includes("--dry");
const BUCKET = process.env.AWS_S3_BUCKET || "conversation-agents-artifacts";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");

async function main() {
  const store = getMailStore();
  const files = new Map<string, StoredFile>();

  // 1. Connected mailboxes.
  const ids = (await store.listConnections()).map((c) => c.id);
  const keys: string[] = [];
  let before: { at: string; key: string } | null = null;
  for (;;) {
    const page = await store.inboxPage({ connectionIds: ids, limit: 100, before });
    keys.push(...page.threads.map((t) => t.thread_key));
    const last = page.threads[page.threads.length - 1];
    if (!page.has_more || !last) break;
    before = { at: last.last_at, key: last.thread_key };
  }
  for (const k of keys) {
    const rows: InboxMessageRow[] = await store.threadMessages({ connectionIds: ids, threadKey: k, limit: 100 }).catch(() => []);
    for (const r of rows) for (const a of (r.attachments_json || []) as StoredFile[]) if (a.s3_key && a.sha256) files.set(a.sha256, a);
  }
  const fromMail = files.size;

  // 2. Stored files on deals that have payment emails (archive POs / invoices).
  const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-south-1" });
  const dealKeys = [...new Set((await store.listPayments({ status: "done", limit: 5000 })).map((e) => e.dealKey).filter((k): k is string => Boolean(k)))];
  for (const id of dealKeys) {
    const row = (await invokeTradeSuiteRds<ProcessedDealRow>({ action: "get_evidence", id })).data;
    const ev = (typeof row?.evidence_json === "string" ? JSON.parse(row.evidence_json) : row?.evidence_json) as EvidencePayload | null;
    for (const m of ev?.messages || []) {
      for (const a of m.attachments || []) {
        const sha = digestFromIngestPath(a.path);
        if (!sha || !a.name || files.has(sha) || !/\.(pdf|jpe?g|png|tiff?)$/i.test(a.name)) continue;
        const obj = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/${sha}`, MaxKeys: 2 }));
        const hit = obj.Contents?.find((o) => o.Key && !o.Key.endsWith("/"));
        if (hit) files.set(sha, { name: a.name, sha256: sha, s3_key: hit.Key!, size: hit.Size || 0 });
      }
    }
  }
  // 3. Files the PO / PI reader could not read (scanned originals on any deal).
  const failedReads = (await invokeTradeSuiteRds<{ sha256: string; name: string }[]>({ action: "list_deal_documents", status: "failed", limit: 500 })).data || [];
  for (const d of failedReads) {
    if (files.has(d.sha256)) continue;
    const obj = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/${d.sha256}`, MaxKeys: 2 }));
    const hit = obj.Contents?.find((o) => o.Key && !o.Key.endsWith("/"));
    if (hit) files.set(d.sha256, { name: d.name, sha256: d.sha256, s3_key: hit.Key!, size: hit.Size || 0 });
  }
  console.log(`Files: ${fromMail} from the mailboxes, ${files.size - fromMail} more on payment deals and failed PO / PI reads`);

  // Text layer first (cheap), then OCR what it could not read.
  const candidates: StoredFile[] = [];
  for (const f of files.values()) {
    const text = (await getDocText(f.sha256)) || (/\.pdf$/i.test(f.name) ? await ensureDocText(f).catch(() => null) : null);
    if (wantsOcr(f, text) || (isDocumentImage(f) && (!text || text.method !== "ocr"))) candidates.push(f);
  }
  const pdfs = candidates.filter((f) => /\.pdf$/i.test(f.name)).length;
  console.log(`OCR candidates: ${candidates.length} (${pdfs} scanned PDFs, ${candidates.length - pdfs} images)`);
  if (DRY) return;

  let started = 0;
  let failedToStart = 0;
  for (const f of candidates) {
    try {
      await startOcr(f);
      started++;
    } catch (err) {
      failedToStart++;
      if (failedToStart <= 3) console.warn("  ✗", f.name, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Queued ${started} files for OCR with ${ocrEngine()} (${failedToStart} failed). Reading…`);
  const totals = { ok: 0, empty: 0, failed: 0 };
  for (let round = 0; round < 200; round++) {
    const r = await processOcr({ deadline: Date.now() + 120_000, limit: 10 });
    totals.ok += r.ok;
    totals.empty += r.empty;
    totals.failed += r.failed;
    console.log(`  read ${totals.ok} · no usable text ${totals.empty} · failed ${totals.failed} · left ${r.waiting}`);
    if (!r.waiting) break;
    if (ocrEngine() === "textract") await new Promise((res) => setTimeout(res, 10_000));
  }
  await stopOcr();
  const texts = await Promise.all(candidates.map((f) => getDocText(f.sha256)));
  const ocrd = texts.filter((t) => t?.method === "ocr");
  const out = {
    generatedAt: new Date().toISOString(),
    candidates: candidates.length,
    scannedPdfs: pdfs,
    images: candidates.length - pdfs,
    ocrOk: ocrd.filter((t) => t!.status === "ok").length,
    ocrEmpty: ocrd.filter((t) => t!.status === "empty").length,
    ocrFailed: ocrd.filter((t) => t!.status === "failed").length,
    pages: ocrd.reduce((s, t) => s + (t!.pages || 1), 0),
    avgConfidence: Math.round(ocrd.reduce((s, t) => s + (t!.confidence || 0), 0) / Math.max(1, ocrd.length)),
    byType: ocrd
      .filter((t) => t!.status === "ok")
      .reduce<Record<string, number>>((m, t) => ((m[t!.docType] = (m[t!.docType] || 0) + 1), m), {}),
  };
  await mkdir(path.join(process.cwd(), "data", "docs"), { recursive: true });
  await writeFile(path.join(process.cwd(), "data", "docs", "ocr-backfill.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
