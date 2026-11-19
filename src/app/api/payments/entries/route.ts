import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments/entries → { entries }: every payment email the Payment Reader has read (status done).
 * The deal room matches them to orders in the browser, against the deals it already holds.
 */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "payments-entries", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ entries: [] }, { headers: NO_STORE });
  try {
    const rows = await getMailStore().listPayments({ status: "done", limit: 5000 });
    // The reader's input (mail text) stays server-side.
    return NextResponse.json({ entries: rows.map((r) => ({ ...r, input: null })) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[payments/entries] failed", err);
    return jsonError(err, 502);
  }
}
