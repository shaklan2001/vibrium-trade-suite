import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { extractDocText, extOf } from "@/lib/mail/docText";
import { ocrBuffer } from "@/lib/mail/ocr";
import { parseStatement } from "@/lib/mail/statementParse";
import { readStatementWithAgent, statementAgentId } from "@/lib/mail/statementAgent";
import { loadMatchContext, storeStatementLines } from "@/lib/mail/statementJobs";
import { createHash } from "node:crypto";
import { storeAttachment } from "@/lib/mail/parse";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby functions stop at 60 s; the OCR and agent waits are capped below that.
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const OK_EXT = new Set([".pdf", ".xlsx", ".xls", ".csv", ".html", ".htm", ".txt", ".jpg", ".jpeg", ".png"]);
const SCAN_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

/**
 * POST /api/payments/statements   multipart: file (PDF / Excel / CSV / HTML; scanned PDF or photo → OCR), agent=1 to force the AI reader
 * → counts and the trade lines found. Only trade lines are stored (remittances, commission, known parties);
 * salary, loan, tax, card and personal lines are counted and dropped. The file is kept in S3 with the
 * other documents and linked from its lines.
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "statement-upload", 40, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("Choose a statement file", 400);
    const ext = extOf(file.name);
    if (!OK_EXT.has(ext)) return jsonError("Upload a PDF, Excel, CSV or HTML statement", 400);
    if (file.size > MAX_BYTES) return jsonError("File is larger than 8 MB", 413);
    const buf = Buffer.from(await file.arrayBuffer());
    const useAgent = form.get("agent") === "1";

    const isImage = ext === ".jpg" || ext === ".jpeg" || ext === ".png";
    const doc = isImage ? { status: "empty" as const, text: "" } : await extractDocText(buf, file.name);
    let ocred = false;
    if (doc.status === "empty" && SCAN_EXT.has(ext)) {
      // A scanned advice / photo: read it with OCR (first pages only; an advice is one page).
      const read = await ocrBuffer(buf, file.name, { deadline: Date.now() + 40_000, maxPages: 3 }).catch(() => null);
      const text = (read?.pages || []).map((p) => p.text).join("\n");
      if (text.replace(/\s/g, "").length < 40) {
        return jsonError("This file is a scan and its text could not be read. Download the advice from HSBC again as a PDF.", 422);
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
    if ((useAgent || !lines.length) && statementAgentId()) {
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
