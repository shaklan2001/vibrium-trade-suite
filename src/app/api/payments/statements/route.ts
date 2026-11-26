import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { extractDocText, extOf } from "@/lib/mail/docText";
import { ocrBuffer } from "@/lib/mail/ocr";
import { tableOcrImage, tableOcrPdf } from "@/lib/mail/statementOcr";
import { MAX_STATEMENT_BYTES, MAX_UPLOAD_PARTS, takeUploadParts, validUploadId } from "@/lib/mail/statementUpload";
import { parseStatement } from "@/lib/mail/statementParse";
import { readStatementWithAgent, statementAgentId } from "@/lib/mail/statementAgent";
import { loadMatchContext, storeStatementLines } from "@/lib/mail/statementJobs";
import { createHash } from "node:crypto";
import { storeAttachment } from "@/lib/mail/parse";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A scanned 10-page statement is read cell by cell (~6 s a page); the OCR stops well before this.
export const maxDuration = 300;
const OCR_BUDGET_MS = 230_000;

const OK_EXT = new Set([".pdf", ".xlsx", ".xls", ".csv", ".html", ".htm", ".txt", ".jpg", ".jpeg", ".png"]);
const SCAN_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

/**
 * POST /api/payments/statements   multipart: file (PDF / Excel / CSV / HTML; scanned PDF or photo → OCR), agent=1 to force the AI reader
 *                                  or, for a file over 3.5 MB sent in parts: uploadId, parts, name, type
 * → counts and the trade lines found. Only trade lines are stored (remittances, commission, known parties);
 * salary, loan, tax, card and personal lines are counted and dropped. The file is kept in S3 with the
 * other documents and linked from its lines.
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "statement-upload", 40, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  try {
    const started = Date.now();
    const form = await req.formData();
    const upload = form.get("file");
    // Small files come whole; larger ones were sent to /api/payments/statements/parts first.
    let file: { name: string; size: number; type: string };
    let buf: Buffer;
    if (upload instanceof File) {
      file = { name: upload.name, size: upload.size, type: upload.type };
      if (file.size > MAX_STATEMENT_BYTES) return jsonError("File is larger than 20 MB", 413);
      buf = Buffer.from(await upload.arrayBuffer());
    } else {
      const uploadId = form.get("uploadId");
      const parts = Number(form.get("parts"));
      const name = String(form.get("name") || "");
      if (!validUploadId(uploadId) || !Number.isInteger(parts) || parts < 1 || parts > MAX_UPLOAD_PARTS || !name) return jsonError("Choose a statement file", 400);
      const joined = await takeUploadParts(uploadId, parts);
      if (!joined) return jsonError("The upload was incomplete. Upload the file again.", 400);
      if (joined.length > MAX_STATEMENT_BYTES) return jsonError("File is larger than 20 MB", 413);
      file = { name, size: joined.length, type: String(form.get("type") || "") };
      buf = joined;
    }
    const ext = extOf(file.name);
    if (!OK_EXT.has(ext)) return jsonError("Upload a PDF, Excel, CSV or HTML statement", 400);
    const useAgent = form.get("agent") === "1";

    const isImage = ext === ".jpg" || ext === ".jpeg" || ext === ".png";
    const doc = isImage ? { status: "empty" as const, text: "" } : await extractDocText(buf, file.name);
    let ocred = false;
    let pagesRead: { read: number; total: number } | null = null;
    if (doc.status === "empty" && SCAN_EXT.has(ext)) {
      // A scan or a statement printed as an image. Statement tables are read cell by cell (the ruled
      // lines say which word belongs to which column); a scanned advice has no table and falls back
      // to plain OCR below.
      const deadline = started + OCR_BUDGET_MS;
      const table = await (isImage ? tableOcrImage(buf) : tableOcrPdf(buf, { deadline })).catch((err) => {
        console.warn("[payments/statements] table OCR failed", err instanceof Error ? err.message : err);
        return null;
      });
      let text = table?.text || "";
      if (table) pagesRead = { read: table.pagesRead, total: table.pages };
      if (!parseStatement({ text }).lines.length) {
        const read = await ocrBuffer(buf, file.name, { deadline: Math.min(deadline, Date.now() + 40_000), maxPages: 3 }).catch(() => null);
        const plain = (read?.pages || []).map((p) => p.text).join("\n");
        if (plain.replace(/\s/g, "").length > text.replace(/\s/g, "").length / 2) text = plain;
      }
      if (text.replace(/\s/g, "").length < 40) {
        return jsonError("This file is a scan and its text could not be read. Download it from the bank again as a PDF.", 422);
      }
      doc.text = text;
      doc.status = "ok";
      ocred = true;
    }
    if (doc.status !== "ok") return jsonError("The file could not be read", 422);
    const html = ext === ".html" || ext === ".htm" ? buf.toString("utf8") : undefined;

    // The built-in reader always runs. The AI reader runs when asked for (agent=1) or when the
    // built-in one finds nothing, and only if it is provisioned; its lines win when it returns any.
    const parsed = parseStatement({ html, text: doc.text });
    let method: string = ocred ? `${parsed.method}+ocr` : parsed.method;
    let lines = parsed.lines;
    let skipped = parsed.skipped;
    let usedAgent = false;
    // A table whose every line agrees with its running balance is not handed to the AI reader.
    const verified = Boolean(parsed.balanceCheck && !parsed.balanceCheck.unconfirmed);
    if ((useAgent ? !verified : !lines.length) && statementAgentId()) {
      const viaAgent = await readStatementWithAgent(doc.text);
      if (viaAgent?.lines.length) {
        lines = viaAgent.lines;
        method = "agent";
        usedAgent = true;
        skipped = 0;
      }
    }
    if (!lines.length) {
      return NextResponse.json(
        {
          ok: false,
          error: statementAgentId()
            ? "No transactions could be read from this file, with the built-in reader or the AI reader."
            : "No transactions could be read. Try the bank's Excel or CSV download, or ask for the AI reader to be switched on.",
          skipped,
        },
        { status: 422, headers: NO_STORE },
      );
    }

    // The file goes to S3 with the other documents (content-addressed: the same PDF is stored once).
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const kept = await storeAttachment(
      { name: file.name, sha256, size: file.size, content_type: file.type || "application/octet-stream", ext },
      buf,
      { allowInline: true },
    ).catch((err) => {
      console.warn("[payments/statements] could not keep the file in S3", err instanceof Error ? err.message : err);
      return null;
    });

    const store = getMailStore();
    const ctx = await loadMatchContext(store);
    const result = await storeStatementLines(store, lines, ctx, "upload", kept?.s3_key ? { name: file.name, sha256 } : null);
    return NextResponse.json(
      {
        ok: true,
        method,
        usedAgent,
        agentAvailable: Boolean(statementAgentId()),
        currency: lines[0]?.currency || "INR",
        period: { from: lines.reduce((a, l) => (l.date < a ? l.date : a), lines[0]!.date), to: lines.reduce((a, l) => (l.date > a ? l.date : a), lines[0]!.date) },
        skipped,
        balanceCheck: usedAgent ? null : (parsed.balanceCheck ?? null),
        pagesRead,
        fileKept: Boolean(kept?.s3_key),
        ...result,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[payments/statements] failed", err);
    return jsonError(err, 502);
  }
}
