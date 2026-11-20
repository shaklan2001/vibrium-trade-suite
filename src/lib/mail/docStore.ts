/**
 * Document text cache, keyed by file content (sha256): a PI forwarded five times is read once.
 *
 *   {PREFIX}/_text/{sha256}.v1.json      DocText (src/lib/mail/docText.ts)
 *   {PREFIX}/_converted/{sha256}.xlsx    legacy .xls converted for the PO / PI extractor
 *
 * Lives next to the attachments in the same bucket (outside the {PREFIX}/{sha256}/ folders, so the
 * attachment lookups in documentExtraction.ts never pick it up). Server only.
 */
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { classifyDocument, looksGarbled, DOC_TYPE_LABELS, extractDocText, extOf, isTextExtractable, xlsToXlsx, type DocText } from "./docText";
import { attachmentBucket } from "./parse";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const PREFIX = (process.env.AWS_S3_PREFIX || "trade/pst-ingest").replace(/^\/+|\/+$/g, "");
const MAX_FILE_BYTES = 15 * 1024 * 1024;

let s3: S3Client | null = null;
const client = () => (s3 ||= new S3Client({ region: REGION }));

export const textKey = (sha256: string) => `${PREFIX}/_text/${sha256}.v1.json`;
export const convertedKey = (sha256: string) => `${PREFIX}/_converted/${sha256}.xlsx`;

async function readObject(key: string): Promise<Buffer | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: attachmentBucket(), Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

export async function objectExists(key: string) {
  try {
    await client().send(new HeadObjectCommand({ Bucket: attachmentBucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function getDocText(sha256: string): Promise<DocText | null> {
  const buf = await readObject(textKey(sha256)).catch(() => null);
  if (!buf) return null;
  try {
    const doc = JSON.parse(buf.toString("utf8")) as DocText;
    // Classification rules improve over time; the cached text stays, the type is recomputed.
    const garbled = doc.status === "ok" && doc.method === "pdf" && looksGarbled(doc.text);
    return { ...doc, status: garbled ? "empty" : doc.status, docType: classifyDocument(doc.name, doc.text) };
  } catch {
    return null;
  }
}

export type StoredFile = { name: string; sha256: string; s3_key?: string; inline?: boolean; size?: number };

/** Usable attachment for the text layer: stored, not an inline image, a format we can read. */
export function wantsText(a: StoredFile) {
  return Boolean(a.s3_key && a.sha256 && !a.inline && !/^image\d*\./i.test(a.name) && isTextExtractable(a.name) && (a.size || 0) <= MAX_FILE_BYTES);
}

/**
 * Text for one stored attachment: from the cache, else extracted (from `content` when the caller
 * has the bytes, e.g. during sync; otherwise downloaded) and cached. Legacy .xls also gets an
 * .xlsx copy for the PO / PI extractor.
 */
export async function ensureDocText(a: StoredFile, content?: Buffer): Promise<DocText | null> {
  if (!wantsText(a)) return null;
  const cached = await getDocText(a.sha256);
  if (cached) return cached;
  const buf = content || (await readObject(a.s3_key!));
  if (!buf) return null;
  const doc = await extractDocText(buf, a.name);
  await client().send(
    new PutObjectCommand({
      Bucket: attachmentBucket(),
      Key: textKey(a.sha256),
      Body: JSON.stringify(doc),
      ContentType: "application/json",
    }),
  );
  if (extOf(a.name) === ".xls" && doc.status === "ok") {
    try {
      await client().send(
        new PutObjectCommand({
          Bucket: attachmentBucket(),
          Key: convertedKey(a.sha256),
          Body: xlsToXlsx(buf),
          ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
    } catch (err) {
      console.warn("[docs] xls conversion failed", a.name, err);
    }
  }
  return doc;
}

/** A photographed document (not an inline logo): its text comes from OCR. */
export function isDocumentImage(a: StoredFile) {
  return Boolean(a.s3_key && a.sha256 && !a.inline && /\.(jpe?g|png|tiff?)$/i.test(a.name) && !/^image\d*\./i.test(a.name) && (a.size || 0) >= 40 * 1024);
}

/** Cached texts for several files (no extraction): what drafts and Copilot read. */
export async function docTextsFor(files: StoredFile[], limit = 8): Promise<DocText[]> {
  // One per content and one per file name (a re-sent "revised" copy keeps only the newest, listed first).
  const seen = new Set<string>();
  const want = files
    .filter((f) => (wantsText(f) || isDocumentImage(f)) && !seen.has(f.sha256) && !seen.has(`n:${f.name.toLowerCase()}`) && seen.add(f.sha256) && seen.add(`n:${f.name.toLowerCase()}`))
    .slice(0, limit);
  const got = await Promise.all(want.map((f) => getDocText(f.sha256)));
  return got.filter((d): d is DocText => Boolean(d && d.status === "ok"));
}

/** Compact prompt block: type, file name, then the start of the text. */
export function docBrief(doc: DocText, chars = 1500) {
  const body = doc.text.length > chars ? `${doc.text.slice(0, chars)}\n…` : doc.text;
  return `[${DOC_TYPE_LABELS[doc.docType]}] ${doc.name}${doc.pages ? ` (${doc.pages} page${doc.pages > 1 ? "s" : ""})` : ""}\n${body}`;
}
