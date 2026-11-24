"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import type { PaymentEntry } from "@/lib/mail/payments";
import { buildPaymentLedger, ordersForDeal, type OrderLedger } from "@/lib/trade/paymentLedger";
import { useTradeStore } from "@/lib/trade/store";
import type { Deal } from "@/types/trade";

const STATUS: Record<OrderLedger["status"], { label: string; tone: "neutral" | "success" | "warning" | "info" | "danger" }> = {
  no_value: { label: "PO value not on record", tone: "neutral" },
  unpaid: { label: "Nothing paid yet", tone: "warning" },
  part_paid: { label: "Part paid", tone: "info" },
  paid: { label: "Paid in full", tone: "success" },
  overpaid: { label: "Paid more than PO value", tone: "danger" },
  currency_mismatch: { label: "Different currency from PO", tone: "warning" },
};

const KIND: Record<string, string> = {
  payment_received: "Received",
  payment_sent: "Payer says sent",
  payment_request: "Requested",
};

function money(n: number | null | undefined, ccy: string | null) {
  if (n == null) return "—";
  return `${ccy || ""} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
}

/** Payment entries are shared by every deal page; fetched once per page load. */
let entriesPromise: Promise<PaymentEntry[]> | null = null;
function loadEntries() {
  entriesPromise ||= fetch("/api/payments/entries", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ entries: PaymentEntry[] }>) : Promise.reject(new Error(String(r.status)))))
    .then((b) => b.entries || [])
    .catch((err) => {
      entriesPromise = null;
      throw err;
    });
  return entriesPromise;
}

type BankLine = { id: string; date: string; kind: string; amountInr: number; pos: string[]; invoiceNo: string | null };

/** Bank statement trade lines, fetched once per page load (empty when none were read). */
let bankPromise: Promise<BankLine[]> | null = null;
function loadBankLines() {
  bankPromise ||= fetch("/api/payments/bank-lines", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ lines: BankLine[] }>) : { lines: [] }))
    .then((b) => b.lines || [])
    .catch(() => []);
  return bankPromise;
}

/** Paid vs PO value per order, reconciled from the payment emails (Payment Reader ledger). */
export function DealPaymentLedger({ deal }: { deal: Deal }) {
  const deals = useTradeStore((s) => s.deals);
  const [entries, setEntries] = useState<PaymentEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [bank, setBank] = useState<BankLine[]>([]);

  useEffect(() => {
    let alive = true;
    void loadBankLines().then((l) => alive && setBank(l));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadEntries()
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // Matched against every deal in the book, so a payment for several POs lands on each of them.
  const orders: OrderLedger[] | null = useMemo(
    () => (entries ? ordersForDeal(buildPaymentLedger(entries, deals), deal) : null),
    [entries, deals, deal],
  );

  if (failed || (orders && !orders.length)) return null;

  return (
    <Card className="mb-4">
      <CardHeader title="Payments from email" description="Read from payment advices, TT copies and requests in the connected mailboxes" />
      {!orders ? (
        <p className="px-4 pb-4 text-sm text-zinc-500">Reading the payment ledger…</p>
      ) : (
        <div className="divide-y divide-zinc-100">
          {orders.map((o) => {
            const st = STATUS[o.status];
            return (
              <div key={o.po} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-zinc-600">PO {o.po}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {o.sharedUnsplit ? <span className="text-xs text-zinc-500">{o.sharedUnsplit} shared payment(s) not split per PO</span> : null}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-zinc-500">
                      {o.basis === "factory_invoice" ? "Factory invoice" : o.basis === "invoiced" ? "Invoiced" : "PO value"}
                    </dt>
                    <dd className="font-medium text-zinc-900">
                      {money(o.basis === "factory_invoice" ? o.factoryValue : o.poValue || o.invoiced || null, o.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Received</dt>
                    <dd className="font-medium text-zinc-900">{money(o.buyer.received, o.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Sent, not confirmed</dt>
                    <dd className="font-medium text-zinc-900">{money(o.buyer.sentUnconfirmed, o.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Outstanding</dt>
                    <dd className="font-medium text-zinc-900">{o.outstanding == null ? "—" : money(Math.max(0, o.outstanding), o.currency)}</dd>
                  </div>
                </dl>
                <ul className="mt-2 space-y-1">
                  {bank
                    .filter((b) => b.pos.some((p) => p.toUpperCase().replace(/[^A-Z0-9]/g, "") === o.po.toUpperCase().replace(/[^A-Z0-9]/g, "")))
                    .map((b) => (
                      <li key={`bank-${b.id}`} className="flex flex-wrap items-center gap-x-2 text-xs text-emerald-800">
                        <span className="w-20 shrink-0 tabular-nums">{b.date}</span>
                        <span className="font-medium">Confirmed in bank INR {Math.abs(b.amountInr).toLocaleString("en-IN")}</span>
                        {b.invoiceNo ? <span>· commission invoice {b.invoiceNo}</span> : null}
                      </li>
                    ))}
                  {o.lines.map((l) => (
                    <li key={`${l.entryId}-${o.po}`} className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-600">
                      <span className="w-20 shrink-0 tabular-nums text-zinc-500">{l.date}</span>
                      <span className="font-medium text-zinc-800">
                        {KIND[l.kind] || l.kind} {money(l.amount ?? l.total, l.currency)}
                      </span>
                      {l.side && l.side !== "buyer" ? <span>({l.side})</span> : null}
                      {l.alsoCovers.length ? (
                        <span>
                          · also covers {l.alsoCovers.slice(0, 3).join(", ")}
                          {l.split === "pro_rata" ? " (split pro rata)" : l.split === "shared" ? " (not split)" : ""}
                        </span>
                      ) : null}
                      {l.reference ? <span>· ref {l.reference}</span> : null}
                      {l.mailHref ? (
                        <Link href={l.mailHref} className="inline-flex items-center gap-1 text-teal-700 hover:underline">
                          <Mail className="h-3 w-3" aria-hidden /> email
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
