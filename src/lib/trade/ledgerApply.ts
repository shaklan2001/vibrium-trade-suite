/**
 * Money the payment ledger knows about (payment emails, payments logged through Copilot, bank advices
 * matched to a deal) flows into each deal's payment schedule, so the Payments panel, Finance totals,
 * overdue flags and Copilot all agree with the ledger.
 *
 * Per deal and side (buyer / factory): what the ledger says arrived, minus what the schedule already
 * marks received (both can come from the same email), is allocated to the open checkpoints, oldest
 * due first; an installment covered in full is marked received with the date of the payment that
 * covered it. Always applied to the schedule as read from the mail (`paymentScheduleMail`), so an
 * undone payment rolls the schedule back. When nothing is left owing, the payment clock is "paid".
 * Pure; client and server.
 */
import type { Deal, DealPaymentSchedule, PaymentCheckpoint, PaymentScheduleSide } from "@/types/trade";
import { ordersForDeal, type LedgerLine, type PaymentLedger } from "./paymentLedger";

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.01 * Math.max(a, b));

function receipts(lines: LedgerLine[], side: PaymentScheduleSide): { amount: number; date: string; entryId: string }[] {
  return lines
    .filter((l) => (side === "buyer" ? (l.side === "buyer" || l.side === null) && l.kind === "payment_received" : l.side === "factory" && l.kind !== "payment_request"))
    .filter((l) => (l.amount ?? 0) > 0)
    .map((l) => ({ amount: l.amount!, date: l.date, entryId: l.entryId }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The schedule with ledger money applied, or the same object when the ledger adds nothing. */
export function scheduleWithLedger(base: DealPaymentSchedule, lines: LedgerLine[], ledgerCurrency: string | null): DealPaymentSchedule {
  // Checkpoints are kept in USD (or the schedule's currency); money in another currency cannot be placed.
  const ccy = base.currency || "USD";
  if (ledgerCurrency && ledgerCurrency !== ccy) return base;
  let changed = false;
  const checkpoints: PaymentCheckpoint[] = base.checkpoints.map((c) => ({ ...c }));
  for (const side of ["buyer", "factory"] as const) {
    const paid = receipts(lines, side);
    const ledgerTotal = paid.reduce((s, p) => s + p.amount, 0);
    const already = checkpoints.filter((c) => c.side === side && c.status === "received").reduce((s, c) => s + (c.amountUsd || 0), 0);
    if (ledgerTotal - already <= 0.5) continue;
    const open = checkpoints
      .filter((c) => c.side === side && c.status !== "received" && c.status !== "waived" && (c.amountUsd || 0) > 0)
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    let covered = already;
    for (const c of open) {
      const amt = c.amountUsd || 0;
      const left = ledgerTotal - covered;
      if (left + 0.5 < amt && !near(left, amt)) break;
      covered += amt;
      // The payment that brought the running total to this installment: its date is the receipt date.
      let cum = 0;
      let by = paid[paid.length - 1];
      for (const p of paid) {
        cum += p.amount;
        if (cum + 0.5 >= covered || near(cum, covered)) {
          by = p;
          break;
        }
      }
      c.status = "received";
      c.receivedAt = by?.date.slice(0, 10);
      if (by) c.confirmationSourceId = `ledger:${by.entryId}`;
      c.fromLedger = true;
      changed = true;
    }
  }
  return changed ? { ...base, checkpoints } : base;
}

/**
 * Deals with the ledger applied (new objects only for deals that change). Safe to call again with a
 * newer ledger: it always starts from the schedule read from the mail.
 */
export function applyLedgerToDeals(deals: Deal[], ledger: PaymentLedger | null): Deal[] {
  return deals.map((deal) => {
    const base = deal.paymentScheduleMail ?? deal.paymentSchedule;
    const orders = ledger ? ordersForDeal(ledger, deal) : [];
    const lines = orders.flatMap((o) => o.lines);
    const currency = orders.find((o) => o.currency)?.currency ?? null;
    const schedule = base?.checkpoints?.length && lines.length ? scheduleWithLedger(base, lines, currency) : base;
    const paidUp = orders.length > 0 && orders.every((o) => o.status === "paid" || o.status === "overpaid");
    const baseClock = deal.paymentMail ?? deal.payment;
    const clock = baseClock && paidUp && baseClock.status !== "paid" ? { ...baseClock, status: "paid" as const } : baseClock;
    const sig = (x: DealPaymentSchedule | undefined) => (x?.checkpoints || []).map((c) => `${c.id}:${c.status}:${c.receivedAt || ""}`).join("|");
    if (sig(schedule) === sig(deal.paymentSchedule) && clock?.status === deal.payment?.status) return deal;
    return { ...deal, paymentSchedule: schedule, paymentScheduleMail: base, payment: clock, paymentMail: baseClock };
  });
}
