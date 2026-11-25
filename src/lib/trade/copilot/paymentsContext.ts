/**
 * Payment ledger for Copilot and the deal room (server-side).
 * Reads the finished rows of mail_payments, matches them to the book's orders, and caches
 * the result briefly — the ledger changes only when the mail sync reads a new payment email.
 */
import { getMailStore, mailStoreConfigured } from "@/lib/mail/store";
import type { PaymentEntry } from "@/lib/mail/payments";
import { buildPaymentLedger, ordersForDeal, type OrderLedger, type PaymentLedger } from "@/lib/trade/paymentLedger";
import type { Deal } from "@/types/trade";

const TTL_MS = 2 * 60_000;
let cached: { at: number; ledger: PaymentLedger; size: number } | null = null;

/** A payment was logged or undone: the next answer reads the ledger again. */
export function invalidatePaymentLedger(): void {
  cached = null;
}

export async function getPaymentLedger(deals: Deal[]): Promise<PaymentLedger | null> {
  if (!mailStoreConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS && cached.size === deals.length) return cached.ledger;
  try {
    const rows: PaymentEntry[] = await getMailStore().listPayments({ status: "done", limit: 5000 });
    const ledger = buildPaymentLedger(rows, deals);
    cached = { at: Date.now(), ledger, size: deals.length };
    return ledger;
  } catch (err) {
    // Table not deployed yet, or the store is down: answers fall back to the deal record.
    console.warn("[payments] ledger unavailable", err instanceof Error ? err.message : err);
    return null;
  }
}

const money = (n: number | null | undefined, ccy?: string | null) =>
  n == null ? "amount n/a" : `${ccy || ""} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();

const STATUS: Record<OrderLedger["status"], string> = {
  no_value: "PO value not on record",
  unpaid: "nothing paid yet",
  part_paid: "part paid",
  paid: "paid in full",
  overpaid: "paid more than the PO value",
  currency_mismatch: "payments in a different currency from the PO",
};

const KIND: Record<string, string> = {
  payment_received: "received",
  payment_sent: "payer says sent",
  payment_request: "requested",
};

/** Context lines for one deal's orders: balance first, then each payment email with its link. */
export function paymentLines(ledger: PaymentLedger, deal: Deal): string[] {
  const out: string[] = [];
  for (const o of ordersForDeal(ledger, deal).slice(0, 4)) {
    const c = o.currency;
    out.push(
      `- Payments PO ${o.po} (from payment emails): ${STATUS[o.status]}` +
        (o.poValue
          ? ` · PO value ${money(o.poValue, c)}`
          : o.basis === "factory_invoice"
            ? ` · factory invoice ${money(o.factoryValue, c)}`
            : o.invoiced
              ? ` · invoiced (payment requests) ${money(o.invoiced, c)}`
              : "") +
        ` · received ${money(o.buyer.received, c)}` +
        (o.buyer.sentUnconfirmed ? ` · sent, not yet confirmed ${money(o.buyer.sentUnconfirmed, c)}` : "") +
        (o.outstanding != null ? ` · outstanding ${money(Math.max(0, o.outstanding), c)}` : "") +
        (o.buyer.requestedOpen ? ` · open requests ${money(o.buyer.requestedOpen, c)}` : "") +
        (o.factory.paid || o.factory.requestedOpen
          ? ` · factory: paid ${money(o.factory.paid, c)}${o.factory.requestedOpen ? `, requested ${money(o.factory.requestedOpen, c)}` : ""}`
          : "") +
        (o.sharedUnsplit ? ` · ${o.sharedUnsplit} shared payment(s) not split per PO` : ""),
    );
    for (const l of o.lines.slice(-5)) {
      const label = `${l.date} · ${KIND[l.kind] || l.kind} ${money(l.amount ?? l.total, l.currency)}${l.offMail ? " (logged by the team from WhatsApp / a call, not an email)" : ""}`;
      out.push(
        `  - ${l.mailHref ? `[${label}](${l.mailHref})` : label}${l.side && l.side !== "buyer" ? ` (${l.side})` : ""}` +
          (l.alsoCovers.length ? ` · same payment also covers ${l.alsoCovers.slice(0, 4).join(", ")}${l.split === "pro_rata" ? " (split pro rata to PO value)" : l.split === "shared" ? " (not split)" : ""}` : "") +
          (l.reference ? ` · ref ${l.reference}` : ""),
      );
    }
  }
  return out;
}
