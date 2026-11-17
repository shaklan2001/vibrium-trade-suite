import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { getCopilotBook } from "@/lib/trade/copilot/book";
import { getPaymentLedger } from "@/lib/trade/copilot/paymentsContext";
import { findDealByRef } from "@/lib/trade/dealLink";
import { ordersForDeal } from "@/lib/trade/paymentLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/payments/ledger?deal=<deal id or short key>
 * The deal's orders as reconciled from payment emails: PO value, received, sent-not-confirmed,
 * open requests, outstanding, and each payment email with its inbox link.
 */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "payments-ledger", 60, 60_000);
  if (limited) return limited;
  const ref = (new URL(req.url).searchParams.get("deal") || "").slice(0, 300);
  if (!ref) return jsonError("deal is required", 400);
  try {
    const book = await getCopilotBook();
    const deal = book.byId.get(ref) || findDealByRef(book.deals, ref);
    if (!deal) return NextResponse.json({ orders: [], ready: true }, { headers: NO_STORE });
    const ledger = await getPaymentLedger(book.deals);
    if (!ledger) return NextResponse.json({ orders: [], ready: false }, { headers: NO_STORE });
    return NextResponse.json({ orders: ordersForDeal(ledger, deal), ready: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[payments/ledger] failed", err);
    return jsonError(err, 502);
  }
}
