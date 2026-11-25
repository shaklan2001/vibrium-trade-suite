import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { ignoreBankLine, listBankLines, reconcileBankLine, reopenBankLine } from "@/lib/mail/bankReconcile";
import { mailStoreConfigured } from "@/lib/mail/store";
import { DealUpdateError } from "@/lib/trade/copilot/dealUpdates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments/bank-lines[?suggest=1] → { lines }: trade lines from bank statements and advices,
 * with their reconciliation status (and, with suggest=1, likely deals for the ones that need a deal).
 */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "bank-lines", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ lines: [] }, { headers: NO_STORE });
  try {
    const suggest = new URL(req.url).searchParams.get("suggest") === "1";
    return NextResponse.json({ lines: await listBankLines({ suggest, limit: suggest ? 200 : 5000 }) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[payments/bank-lines] failed", err);
    return jsonError(err, 502);
  }
}

/**
 * POST /api/payments/bank-lines
 *   { action: "reconcile", id, dealId, po?, side?, basis?: "gross"|"net", author?, note?, confirmed: true } → { line, update }
 *   { action: "ignore", id, by }  → { line }      not a deal payment
 *   { action: "reopen", id, by }  → { line }      undo a recorded payment / an ignore
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "bank-lines-write", 30, 60_000);
  if (limited) return limited;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    const by = typeof body.by === "string" ? body.by : typeof body.author === "string" ? body.author : "team";
    if (body.action === "reconcile") {
      if (body.confirmed !== true) return jsonError("Confirm the payment before it is recorded.", 400);
      return NextResponse.json(await reconcileBankLine(body), { headers: NO_STORE });
    }
    if (body.action === "ignore") return NextResponse.json({ line: await ignoreBankLine(id, by) }, { headers: NO_STORE });
    if (body.action === "reopen") return NextResponse.json({ line: await reopenBankLine(id, by) }, { headers: NO_STORE });
    return jsonError("Unknown action", 400);
  } catch (err) {
    if (err instanceof DealUpdateError) return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE });
    console.error("[payments/bank-lines] write failed", err);
    return jsonError(err, 502);
  }
}
