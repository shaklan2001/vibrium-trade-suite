/**
 * Document layer, Phase 2: OCR for scanned PDFs and photographed documents.
 *
 * Phase 1 (docText.ts) marks a PDF "empty" when it has no text layer. Those files, and standalone
 * JPG / PNG / TIFF attachments that look like documents, are queued here and OCR'd a few at a time
 * on each mail cycle (OCR takes seconds per page, too slow to do inline while syncing):
 *
 *   startOcr()    queue the file: a marker  {PREFIX}/_ocr/{sha256}.json
 *   processOcr()  OCR queued files until the cycle's deadline; text goes to the cache (method "ocr")
 *
 * Engines (OCR_ENGINE):
 *   tesseract (default)  open source, in-process: PDF pages rendered with pdf.js (@napi-rs/canvas),
 *                        read by tesseract.js (English). Good on scanned invoices and POs.
 *   textract             AWS Textract async text detection (needs textract:StartDocumentTextDetection
 *                        and textract:GetDocumentTextDetection on the app's AWS user).
 * Server only.
 */
import os from "node:os";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetDocumentTextDetectionCommand, StartDocumentTextDetectionCommand, TextractClient, type Block } from "@aws-sdk/client-textract";
import { textKey, type StoredFile } from "./docStore";
import { requeuePaymentsForOcrSha } from "./paymentJobs";
import { classifyDocument, extOf, MAX_TEXT_CHARS, type DocText } from "./docText";
import { attachmentBucket } from "./parse";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");
const OCR_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff"]);
/** Photos smaller than this are logos and signatures, not documents. */
const MIN_IMAGE_BYTES = 40 * 1024;
const MAX_BYTES = 50 * 1024 * 1024;
/** Tesseract: pages read per file (POs and invoices are short; the totals are on the first pages). */
const MAX_PAGES = 12;
/** Rough worst case per page, to stop before the cycle's deadline. */
const PAGE_BUDGET_MS = 6_000;
const JOB_TIMEOUT_MS = 30 * 60_000;

let s3: S3Client | null = null;
let tx: TextractClient | null = null;
const storage = () => (s3 ||= new S3Client({ region: REGION }));
const textract = () => (tx ||= new TextractClient({ region: REGION }));
const markerKey = (sha256: string) => `${PREFIX}/_ocr/${sha256}.json`;

export type OcrEngine = "tesseract" | "textract";

export function ocrEngine(): OcrEngine {
  return (process.env.OCR_ENGINE || "tesseract").toLowerCase() === "textract" ? "textract" : "tesseract";
}

export function ocrEnabled() {
  return (process.env.MAIL_OCR || "on").toLowerCase() !== "off";
}

/** Inline payment-advice photo: logos stay under the size floor, so this one is worth reading. */
export function wantsPaymentImageOcr(a: StoredFile) {
  if (!a.s3_key || !a.sha256 || !a.inline) return false;
  const size = a.size || 0;
  if (size < MIN_IMAGE_BYTES || size > MAX_BYTES) return false;
  const ext = extOf(a.name);
  return OCR_EXT.has(ext) && ext !== ".pdf";
}

/** Worth OCR: a stored PDF whose text layer was empty, or a document-sized image. */
export function wantsOcr(a: StoredFile, text: { status: string; method: string } | null) {
  if (!a.s3_key || !a.sha256 || a.inline || (a.size || 0) > MAX_BYTES) return false;
  const ext = extOf(a.name);
  if (!OCR_EXT.has(ext)) return false;
  if (text?.method === "ocr") return false;
  if (ext === ".pdf") return text?.status === "empty";
  if (/^image\d*\./i.test(a.name)) return false; // pasted signature / logo
  return (a.size || 0) >= MIN_IMAGE_BYTES;
}

type Marker = { sha256: string; name: string; s3Key: string; engine: OcrEngine; jobId: string | null; queuedAt: string };

async function readObject(key: string) {
  const res = await storage().send(new GetObjectCommand({ Bucket: attachmentBucket(), Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse((await readObject(key)).toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Queue one file for OCR (Textract starts its job right away). No-op when already queued. */
export async function startOcr(a: StoredFile): Promise<"queued" | "already"> {
  if (await readJson<Marker>(markerKey(a.sha256))) return "already";
  const engine = ocrEngine();
  let jobId: string | null = null;
  if (engine === "textract") {
    const out = await textract().send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: attachmentBucket(), Name: a.s3_key! } },
        ClientRequestToken: a.sha256.slice(0, 64),
      }),
    );
    jobId = out.JobId || null;
  }
  const marker: Marker = { sha256: a.sha256, name: a.name, s3Key: a.s3_key!, engine, jobId, queuedAt: new Date().toISOString() };
  await storage().send(
    new PutObjectCommand({ Bucket: attachmentBucket(), Key: markerKey(a.sha256), Body: JSON.stringify(marker), ContentType: "application/json" }),
  );
  return "queued";
}

/* ---------------------------------------------------------------- tesseract */

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let worker: Promise<TesseractWorker> | null = null;

function tesseract() {
  // Language data is downloaded once and cached in the temp folder (the app folder is read-only on Vercel).
  worker ||= import("tesseract.js").then(({ createWorker }) => createWorker("eng", 1, { cachePath: os.tmpdir() }));
  return worker;
}

/** Stop the OCR worker (scripts call this so the process can exit). */
export async function stopOcr() {
  if (!worker) return;
  const w = await worker;
  worker = null;
  await w.terminate();
}

async function tesseractRead(m: Marker, deadline: number) {
  return ocrBuffer(await readObject(m.s3Key), m.name, { deadline });
}

/**
 * OCR a file in hand (Tesseract): PDF pages rendered and read one by one until `maxPages` or the
 * deadline (the first page is always read). Used inline for uploads, e.g. a scanned bank advice.
 */
export async function ocrBuffer(buf: Buffer, name: string, opts: { deadline: number; maxPages?: number }) {
  const ocr = await tesseract();
  const pages: { text: string; confidence: number }[] = [];
  if (extOf(name) === ".pdf") {
    const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    for (let p = 1; p <= Math.min(pdf.numPages, opts.maxPages ?? MAX_PAGES); p++) {
      if (p > 1 && Date.now() + PAGE_BUDGET_MS > opts.deadline) break;
      const png = await renderPageAsImage(pdf, p, { canvasImport: () => import("@napi-rs/canvas"), scale: 2.5 });
      const { data } = await ocr.recognize(Buffer.from(png));
      pages.push({ text: data.text, confidence: data.confidence });
    }
    return { pages, total: pdf.numPages };
  }
  const { data } = await ocr.recognize(buf);
  return { pages: [{ text: data.text, confidence: data.confidence }], total: 1 };
}

/* ---------------------------------------------------------------- textract */

function linesToText(blocks: Block[]) {
  const byPage = new Map<number, Block[]>();
  for (const b of blocks) if (b.BlockType === "LINE" && b.Text) byPage.set(b.Page || 1, [...(byPage.get(b.Page || 1) || []), b]);
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, lines]) => lines.map((l) => l.Text).join("\n"));
}

async function textractRead(m: Marker) {
  const blocks: Block[] = [];
  let next: string | undefined;
  let total = 1;
  do {
    const out = await textract().send(new GetDocumentTextDetectionCommand({ JobId: m.jobId!, NextToken: next, MaxResults: 1000 }));
    if (out.JobStatus === "IN_PROGRESS") return null;
    if (out.JobStatus === "FAILED") throw new Error(out.StatusMessage || "Textract failed");
    total = out.DocumentMetadata?.Pages || total;
    blocks.push(...(out.Blocks || []));
    next = out.NextToken;
  } while (next);
  return { pages: linesToText(blocks).map((text) => ({ text, confidence: 90 })), total };
}

/* ---------------------------------------------------------------- shared */

async function save(m: Marker, read: { pages: { text: string; confidence: number }[]; total: number } | null, error: string | null) {
  const raw = (read?.pages || []).map((p, i) => `--- page ${i + 1}\n${p.text.trim()}`).join("\n");
  const confidence = read?.pages.length ? Math.round(read.pages.reduce((s, p) => s + p.confidence, 0) / read.pages.length) : 0;
  const text = raw.length > MAX_TEXT_CHARS ? raw.slice(0, MAX_TEXT_CHARS) : raw;
  const usable = text.replace(/\s/g, "").length >= 40 && confidence >= 40;
  const doc: DocText = {
    v: 1,
    name: m.name,
    ext: extOf(m.name),
    method: "ocr",
    status: error ? "failed" : usable ? "ok" : "empty",
    pages: read?.total ?? null,
    text,
    truncated: raw.length > MAX_TEXT_CHARS || (read ? read.pages.length < read.total : false),
    docType: classifyDocument(m.name, text),
    error: error || (read && read.pages.length < read.total ? `read ${read.pages.length} of ${read.total} pages` : null),
    extractedAt: new Date().toISOString(),
    confidence,
    engine: m.engine,
  };
  await storage().send(
    new PutObjectCommand({ Bucket: attachmentBucket(), Key: textKey(m.sha256), Body: JSON.stringify(doc), ContentType: "application/json" }),
  );
  await storage().send(new DeleteObjectCommand({ Bucket: attachmentBucket(), Key: markerKey(m.sha256) }));
  return doc.status;
}

/** OCR queued files until the deadline (Tesseract) / collect finished jobs (Textract). */
export async function processOcr(opts: { deadline: number; limit?: number }) {
  const out = { ok: 0, empty: 0, failed: 0, waiting: 0 };
  let handled = 0;
  let token: string | undefined;
  do {
    const page = await storage().send(
      new ListObjectsV2Command({ Bucket: attachmentBucket(), Prefix: `${PREFIX}/_ocr/`, ContinuationToken: token, MaxKeys: 200 }),
    );
    for (const o of page.Contents || []) {
      if (Date.now() + PAGE_BUDGET_MS > opts.deadline || handled >= (opts.limit ?? Infinity)) {
        out.waiting += 1;
        continue;
      }
      const m = await readJson<Marker>(o.Key!);
      if (!m) continue;
      handled += 1;
      try {
        const read = m.engine === "textract" ? await textractRead(m) : await tesseractRead(m, opts.deadline);
        if (!read) {
          if (Date.now() - Date.parse(m.queuedAt) < JOB_TIMEOUT_MS) {
            out.waiting += 1;
            continue;
          }
          out[(await save(m, null, "OCR timed out")) as "failed"] += 1;
          continue;
        }
        const status = await save(m, read, null);
        out[status as "ok" | "empty"] += 1;
        if (status === "ok") {
          await requeuePaymentsForOcrSha(m.sha256).catch((err) =>
            console.warn("[payments] ocr requeue failed", err instanceof Error ? err.message : err),
          );
        }
      } catch (err) {
        out.failed += 1;
        await save(m, null, (err instanceof Error ? err.message : String(err)).slice(0, 300)).catch(() => undefined);
      }
    }
    token = page.NextContinuationToken;
  } while (token);
  return out;
}
