/**
 * How well payment emails reconcile to orders (criterion 7 of the mail evaluation, after the ledger).
 *
 *   npx tsx --env-file=.env.local scripts/eval-payment-ledger.ts          # ledger rows from mail_payments
 *   npx tsx --env-file=.env.local scripts/eval-payment-ledger.ts --dry    # rows from data/payments/entries.json
 *
 * Writes data/payments/ledger-eval.json (gitignored: holds mail subjects and amounts).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PaymentRow } from "../src/lib/mail/paymentJobs";
import { getMailStore } from "../src/lib/mail/store";
import { getCopilotBook } from "../src/lib/trade/copilot/book";
import { buildPaymentLedger } from "../src/lib/trade/paymentLedger";

const DRY = process.argv.includes("--dry");

function wilson(k: number, n: number) {
  if (!n) return null;
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { pct: Math.round(100 * p), low: Math.round(100 * Math.max(0, c - h)), high: Math.round(100 * Math.min(1, c + h)), k, n };
}

async function main() {
  const rows: PaymentRow[] = DRY
    ? JSON.parse(await readFile(path.join(process.cwd(), "data", "payments", "entries.json"), "utf8"))
    : await getMailStore().listPayments({ limit: 5000 });
  const book = await getCopilotBook();
  const done = rows.filter((r) => r.status === "done");
  const ledger = buildPaymentLedger(done, book.deals);

  const linesByEntry = new Map<string, { po: string; hasValue: boolean; basis: string | null; sameCcy: boolean; split: string }[]>();
  for (const o of ledger.orders) {
    for (const l of o.lines) {
      const list = linesByEntry.get(l.entryId) || [];
      list.push({ po: o.po, hasValue: Boolean(o.basis), basis: o.basis, sameCcy: !o.currency || !l.currency || o.currency === l.currency, split: l.split });
      linesByEntry.set(l.entryId, list);
    }
  }
  const matched = done.filter((r) => linesByEntry.has(r.id));
  const withAmount = done.filter((r) => r.amount != null);
  // Money that moved (received / sent) for goods, set against what is owed on the order.
  const moneyMoved = done.filter((r) => (r.kind === "payment_received" || r.kind === "payment_sent") && (r.side === "buyer" || r.side === "factory" || r.side === null));
  const reconcilable = moneyMoved.filter((r) => r.amount != null && (linesByEntry.get(r.id) || []).some((l) => l.hasValue && l.sameCcy));
  const requests = done.filter((r) => r.kind === "payment_request");
  const requestsTracked = requests.filter((r) => linesByEntry.has(r.id));
  const multi = done.filter((r) => new Set(r.allocations.map((a) => a.po).filter(Boolean)).size > 1);
  const multiMatched = multi.filter((r) => (linesByEntry.get(r.id) || []).length > 1);
  const byKind = done.reduce<Record<string, number>>((a, r) => ((a[r.kind || "?"] = (a[r.kind || "?"] || 0) + 1), a), {});
  const bySide = done.reduce<Record<string, number>>((a, r) => ((a[r.side || "?"] = (a[r.side || "?"] || 0) + 1), a), {});
  const fromAttachment = done.filter((r) => r.attachment).length;
  const orders = ledger.orders;
  const status = orders.reduce<Record<string, number>>((a, o) => ((a[o.status] = (a[o.status] || 0) + 1), a), {});

  const out = {
    generatedAt: new Date().toISOString(),
    candidates: rows.length,
    read: rows.filter((r) => ["done", "not_payment"].includes(r.status)).length,
    failed: rows.filter((r) => r.status === "failed").length,
    paymentEmails: done.length,
    notPayment: rows.filter((r) => r.status === "not_payment").length,
    byKind,
    bySide,
    fromAttachment,
    amountKnown: wilson(withAmount.length, done.length),
    matchedToOrder: wilson(matched.length, done.length),
    namingPo: done.filter((r) => r.allocations.some((a) => a.po)).length,
    namingPoMatched: wilson(
      done.filter((r) => r.allocations.some((a) => a.po) && linesByEntry.has(r.id)).length,
      done.filter((r) => r.allocations.some((a) => a.po)).length,
    ),
    goodsPayments: moneyMoved.length,
    reconcilable: wilson(reconcilable.length, moneyMoved.length),
    requestsTracked: wilson(requestsTracked.length, requests.length),
    moneyMovedMatched: wilson(moneyMoved.filter((r) => linesByEntry.has(r.id)).length, moneyMoved.length),
    moneyMovedAmountKnown: wilson(moneyMoved.filter((r) => r.amount != null).length, moneyMoved.length),
    multiPo: { payments: multi.length, matchedToSeveralOrders: multiMatched.length },
    reconcilableOnPoValue: done.filter((r) => r.amount != null && (linesByEntry.get(r.id) || []).some((l) => l.basis === "po_value" && l.sameCcy)).length,
    orders: {
      total: orders.length,
      status,
      withPoValue: orders.filter((o) => o.poValue).length,
      withFactoryInvoice: orders.filter((o) => o.basis === "factory_invoice").length,
      withInvoicedOnly: orders.filter((o) => o.basis === "invoiced").length,
    },
    unmatched: ledger.unmatched.length,
    unmatchedExamples: ledger.unmatched.slice(0, 8).map((u) => ({ subject: u.entry.subject, pos: u.pos, kind: u.entry.kind, amount: u.entry.amount })),
    exampleOrders: orders
      .filter((o) => o.basis && o.lines.some((l) => l.kind !== "payment_request"))
      .slice(0, 6)
      .map((o) => ({ po: o.po, deal: o.dealCode, status: o.status, basis: o.basis, poValue: o.poValue, invoiced: o.invoiced, currency: o.currency, received: o.buyer.received, sent: o.buyer.sentUnconfirmed, outstanding: o.outstanding, lines: o.lines.length })),
    multiExamples: multiMatched.slice(0, 4).map((r) => ({
      subject: r.subject,
      amount: r.amount,
      currency: r.currency,
      orders: (linesByEntry.get(r.id) || []).map((l) => `${l.po} (${l.split})`),
    })),
  };
  await mkdir(path.join(process.cwd(), "data", "payments"), { recursive: true });
  await writeFile(path.join(process.cwd(), "data", "payments", "ledger-eval.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, (k, v) => (v && typeof v === "object" && "pct" in v ? `${v.pct}% (${v.low}–${v.high}, ${v.k}/${v.n})` : v), 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
