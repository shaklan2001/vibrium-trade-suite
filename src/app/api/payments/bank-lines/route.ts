import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/payments/bank-lines → { lines }: trade lines from bank statements, matched to emails and POs. */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "bank-lines", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ lines: [] }, { headers: NO_STORE });
  try {
    const rows = await getMailStore().listRecords({ kind: "bank_line", limit: 5000 });
    return NextResponse.json({ lines: rows.map((r) => ({ id: r.id, ...r.data })) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[payments/bank-lines] failed", err);
    return jsonError(err, 502);
  }
}
