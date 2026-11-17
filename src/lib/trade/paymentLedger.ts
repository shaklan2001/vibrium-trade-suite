/**
 * Payment reconciliation: payment emails (src/lib/mail/payments.ts) matched to orders.
 *
 *  - Each payment is matched to POs across the whole book (not only the deal the mail was
 *    filed under), so a remittance for three POs lands on all three orders.
 *  - Multi-PO payments are split by the amounts the advice states; otherwise pro rata to
 *    PO value when every PO value is known; otherwise kept as one shared amount.
 *  - Per order: PO value, money confirmed received, money the payer says it sent (not yet
 *    confirmed), open requests, and the outstanding balance when currencies match.
 * Client-safe and pure.
 */
import { mailHref } from "@/lib/mail/mailLink";
import { normPo, type PaymentEntry, type PaymentKind, type PaymentSide } from "@/lib/mail/payments";
import type { Deal } from "@/types/trade";

export type LedgerLine = {
  entryId: string;
  date: string;
  kind: PaymentKind;
  side: PaymentSide | null;
  /** Amount booked to this order; null when a multi-PO payment could not be split. */
  amount: number | null;
  /** Whole payment amount (differs from `amount` when split). */
  total: number | null;
  currency: string | null;
  split: "whole" | "stated" | "pro_rata" | "shared";
  /** Other orders the same payment covers. */
  alsoCovers: string[];
  reference: string | null;
  subject: string;
  summary: string | null;
  mailHref: string | null;
};

export type OrderStatus = "no_value" | "unpaid" | "part_paid" | "paid" | "overpaid" | "currency_mismatch";

export type OrderLedger = {
  po: string;
  dealId: string | null;
  dealCode: string | null;
  currency: string | null;
  /** What the buyer owes for the order (buyer PO value). */
  poValue: number | null;
  /** What is owed to the factory (factory PI value). */
  factoryValue: number | null;
  /** What the balance is measured against: the PO value, else what was invoiced (payment requests). */
  basis: "po_value" | "invoiced" | null;
  invoiced: number;
  buyer: { received: number; sentUnconfirmed: number; requestedOpen: number };
  factory: { paid: number; requestedOpen: number };
  outstanding: number | null;
  status: OrderStatus;
  /** Shared payments not split per PO (amount unknown per order). */
  sharedUnsplit: number;
  lines: LedgerLine[];
};

export type PaymentLedger = {
  orders: OrderLedger[];
  /** Payments that name no PO the book knows. */
  unmatched: { entry: PaymentEntry; mailHref: string | null; pos: string[] }[];
};

type Indexed = { deal: Deal; po: string };

function indexByPo(deals: Deal[]) {
  const by = new Map<string, Indexed>();
  for (const deal of deals) {
    const pos = new Set<string>();
    for (const p of deal.mailboxPoNumbers || []) pos.add(normPo(p));
    if (deal.po?.docNumber) pos.add(normPo(deal.po.docNumber));
    for (const p of pos) {
      if (p.length < 3) continue;
      const prev = by.get(p);
      // Prefer the deal that carries the PO document (it has the value).
      if (!prev || (!prev.deal.po?.totalAmount && deal.po?.totalAmount)) by.set(p, { deal, po: p });
    }
  }
  return by;
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.01 * Math.max(a, b));
const DAY = 86_400_000;

export function buildPaymentLedger(entries: PaymentEntry[], deals: Deal[]): PaymentLedger {
  const byPo = indexByPo(deals);
  const byKey = new Map(deals.map((d) => [d.mailboxSourceId || d.id, d]));
  const orders = new Map<string, OrderLedger>();
  const unmatched: PaymentLedger["unmatched"] = [];

  const order = (hit: Indexed): OrderLedger => {
    let o = orders.get(hit.po);
    if (!o) {
      const d = hit.deal;
      o = {
        po: hit.po,
        dealId: d.id,
        dealCode: d.code,
        currency: d.po?.currency || d.pi?.currency || null,
        poValue: d.po?.totalAmount || null,
        factoryValue: d.pi?.totalAmount || null,
        basis: null,
        invoiced: 0,
        buyer: { received: 0, sentUnconfirmed: 0, requestedOpen: 0 },
        factory: { paid: 0, requestedOpen: 0 },
        outstanding: null,
        status: "no_value",
        sharedUnsplit: 0,
        lines: [],
      };
      orders.set(hit.po, o);
    }
    return o;
  };

  // The same payment often arrives twice (a reply quoting the advice, a copy in another mailbox):
  // same kind, side and amount with the same bank reference, or within a week without one, is one payment.
  const kept: PaymentEntry[] = [];
  for (const e of [...entries].sort((a, b) => a.mailDate.localeCompare(b.mailDate))) {
    const dup =
      e.amount != null &&
      kept.some(
        (k) =>
          k.kind === e.kind &&
          k.side === e.side &&
          k.amount === e.amount &&
          (e.reference && k.reference ? k.reference === e.reference : Math.abs(Date.parse(k.mailDate) - Date.parse(e.mailDate)) < 7 * DAY),
      );
    if (!dup) kept.push(e);
  }

  for (const e of kept) {
    if (e.status !== "done" || !e.kind || e.kind === "other") continue;
    const home = e.dealKey ? byKey.get(e.dealKey) : undefined;
    const href = home ? mailHref(home, e.id) : null;
    // Which orders does it cover? Stated POs first, else the PO of the deal the mail sits in.
    let targets = [...new Map(e.allocations.filter((a) => a.po).map((a) => [normPo(a.po!), a])).values()]
      .map((a) => ({ a, hit: byPo.get(normPo(a.po!)) }))
      .filter((x): x is { a: (typeof e.allocations)[number]; hit: Indexed } => Boolean(x.hit));
    if (!targets.length && home) {
      const own = [...new Set((home.mailboxPoNumbers || []).map(normPo))].map((p) => byPo.get(p)).filter((h): h is Indexed => Boolean(h));
      if (own.length === 1) targets = [{ a: { po: own[0]!.po, invoice: null, amount: null }, hit: own[0]! }];
    }
    if (!targets.length) {
      unmatched.push({ entry: e, mailHref: href, pos: e.allocations.map((a) => a.po || "").filter(Boolean) });
      continue;
    }
    const stated = targets.every((t) => t.a.amount != null);
    const values = targets.map((t) => (e.side === "factory" ? t.hit.deal.pi?.totalAmount : t.hit.deal.po?.totalAmount) || null);
    const valueSum = values.every((v) => v) ? values.reduce<number>((s, v) => s + (v || 0), 0) : 0;
    targets.forEach((t, i) => {
      const many = targets.length > 1;
      const amount = !many
        ? (e.amount ?? t.a.amount) // one order: the money that moved, not the invoice line it quotes
        : stated
          ? t.a.amount
          : valueSum && e.amount
            ? Math.round((e.amount * values[i]!) / valueSum * 100) / 100
            : null;
      const split: LedgerLine["split"] = !many ? "whole" : stated ? "stated" : amount != null ? "pro_rata" : "shared";
      const o = order(t.hit);
      o.lines.push({
        entryId: e.id,
        date: e.valueDate || e.mailDate.slice(0, 10),
        kind: e.kind!,
        side: e.side,
        amount,
        total: e.amount,
        currency: e.currency,
        split,
        alsoCovers: many ? targets.filter((x) => x !== t).map((x) => x.hit.deal.code) : [],
        reference: e.reference,
        subject: e.subject,
        summary: e.summary,
        mailHref: href,
      });
    });
  }

  for (const o of orders.values()) {
    o.lines.sort((a, b) => a.date.localeCompare(b.date));
    const sameCcy = (l: LedgerLine) => !o.currency || !l.currency || l.currency === o.currency;
    // Only the buyer's money counts toward what the buyer owes; freight / commission lines are listed, not netted.
    const buyer = o.lines.filter((l) => l.side === "buyer" || l.side === null);
    const factory = o.lines.filter((l) => l.side === "factory");
    const received = buyer.filter((l) => l.kind === "payment_received");
    // "We have paid" counts until a matching receipt confirms it (then it is the same money).
    const sent = buyer.filter(
      (l) =>
        l.kind === "payment_sent" &&
        !received.some((r) => r.amount != null && l.amount != null && near(r.amount, l.amount) && Math.abs(Date.parse(r.date) - Date.parse(l.date)) < 30 * DAY),
    );
    const paidAfter = (l: LedgerLine, pool: LedgerLine[]) =>
      pool.some((p) => p.date >= l.date && (l.amount == null || p.amount == null || near(p.amount, l.amount) || p.amount > l.amount));
    const sum = (ls: LedgerLine[]) => ls.reduce((s, l) => s + (l.amount || 0), 0);
    o.buyer.received = sum(received);
    o.buyer.sentUnconfirmed = sum(sent);
    o.buyer.requestedOpen = sum(buyer.filter((l) => l.kind === "payment_request" && !paidAfter(l, [...received, ...sent])));
    o.factory.paid = sum(factory.filter((l) => l.kind !== "payment_request"));
    o.factory.requestedOpen = sum(factory.filter((l) => l.kind === "payment_request" && !paidAfter(l, factory.filter((x) => x.kind !== "payment_request"))));
    o.sharedUnsplit = o.lines.filter((l) => l.split === "shared").length;
    const paid = o.buyer.received + o.buyer.sentUnconfirmed;
    const requests = buyer.filter((l) => l.kind === "payment_request" && l.amount != null);
    // Invoiced = the largest request per invoice/date (reminders repeat the same bill).
    o.invoiced = Math.round(
      [...new Map(requests.map((l) => [`${l.amount}`, l.amount!])).values()].reduce((s, v) => s + v, 0) * 100,
    ) / 100;
    if (!o.currency) o.currency = [...requests, ...received, ...sent].find((l) => l.currency)?.currency || null;
    const basisValue = o.poValue || o.invoiced || null;
    o.basis = o.poValue ? "po_value" : o.invoiced ? "invoiced" : null;
    if (!basisValue) o.status = "no_value";
    else if ([...received, ...sent].some((l) => !sameCcy(l))) o.status = "currency_mismatch";
    else {
      o.outstanding = Math.round((basisValue - paid) * 100) / 100;
      const tol = Math.max(1, basisValue * 0.01);
      o.status = paid <= 0 ? "unpaid" : o.outstanding > tol ? "part_paid" : o.outstanding < -tol ? "overpaid" : "paid";
    }
  }
  return { orders: [...orders.values()], unmatched };
}

/** Orders a deal is part of (its own POs). */
export function ordersForDeal(ledger: PaymentLedger, deal: Deal) {
  const mine = new Set((deal.mailboxPoNumbers || []).map(normPo));
  if (deal.po?.docNumber) mine.add(normPo(deal.po.docNumber));
  return ledger.orders.filter((o) => mine.has(o.po) || o.dealId === deal.id);
}
