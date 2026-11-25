import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { extractDocText, extOf } from "@/lib/mail/docText";
import { parseStatement } from "@/lib/mail/statementParse";
import { readStatementWithAgent, statementAgentId } from "@/lib/mail/statementAgent";
import { loadMatchContext, storeStatementLines } from "@/lib/mail/statementJobs";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby functions stop at 60 s; the agent wait is capped below that.
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const OK_EXT = new Set([".pdf", ".xlsx", ".xls", ".csv", ".html", ".htm", ".txt"]);

/**
 * POST /api/payments/statements   multipart: file (PDF / Excel / CSV / HTML), agent=1 to force the AI reader
 * → counts and the trade lines found. Only trade lines are stored (remittances, commission, known parties);
 * salary, loan, tax, card and personal lines are counted and dropped, and the file itself is not kept.
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "statement-upload", 10, 60_000);
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

    const doc = await extractDocText(buf, file.name);
    if (doc.status === "empty") {
      return jsonError("This PDF has no text layer (a scan). Download the statement as text PDF, Excel or CSV from the bank.", 422);
    }
    if (doc.status !== "ok") return jsonError("The file could not be read", 422);
    const html = ext === ".html" || ext === ".htm" ? buf.toString("utf8") : undefined;

    // The built-in reader always runs. The AI reader runs when asked for (agent=1) or when the
    // built-in one finds nothing, and only if it is provisioned; its lines win when it returns any.
    const parsed = parseStatement({ html, text: doc.text });
    let method: string = parsed.method;
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

    const store = getMailStore();
    const ctx = await loadMatchContext(store);
    const result = await storeStatementLines(store, lines, ctx, "upload");
    return NextResponse.json(
      {
        ok: true,
        method,
        usedAgent,
        agentAvailable: Boolean(statementAgentId()),
        currency: lines[0]?.currency || "INR",
        period: { from: lines.reduce((a, l) => (l.date < a ? l.date : a), lines[0]!.date), to: lines.reduce((a, l) => (l.date > a ? l.date : a), lines[0]!.date) },
        skipped,
        ...result,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[payments/statements] failed", err);
    return jsonError(err, 502);
  }
}
