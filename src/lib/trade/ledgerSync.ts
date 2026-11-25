/**
 * Client: apply the payment ledger to the deals in the store, so every page (deal Payments panel,
 * Finance tiles, Command Center, overdue flags) shows money logged through Copilot, read from
 * payment emails or matched from a bank advice. Runs after the book loads and whenever a payment is
 * saved or undone (deal-updates:changed). Fails soft: the deals stay as read from the mail.
 */
import type { PaymentEntry } from "@/lib/mail/payments";
import { onDealUpdatesChanged } from "./dealUpdateEvents";
import { applyLedgerToDeals } from "./ledgerApply";
import { buildPaymentLedger } from "./paymentLedger";
import { useTradeStore } from "./store";

let inflight: Promise<void> | null = null;
let again = false;
let listening = false;

async function run(): Promise<void> {
  const res = await fetch("/api/payments/entries", { cache: "no-store" });
  if (!res.ok) return;
  const { entries = [] } = (await res.json()) as { entries?: PaymentEntry[] };
  const deals = useTradeStore.getState().deals;
  if (!deals.length) return;
  const next = applyLedgerToDeals(deals, buildPaymentLedger(entries, deals));
  if (next.some((d, i) => d !== deals[i])) {
    // Deals may have changed while the entries loaded: patch by id, keep the rest as they are now.
    const patched = new Map(next.filter((d, i) => d !== deals[i]).map((d) => [d.id, d]));
    useTradeStore.setState((s) => ({
      deals: s.deals.map((d) => {
        const p = patched.get(d.id);
        return p ? { ...d, paymentSchedule: p.paymentSchedule, paymentScheduleMail: p.paymentScheduleMail, payment: p.payment, paymentMail: p.paymentMail } : d;
      }),
    }));
  }
}

/** Apply the ledger now (coalesced: one run at a time, one more if asked again meanwhile). */
export function syncLedgerIntoStore(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!listening) {
    listening = true;
    onDealUpdatesChanged(() => void syncLedgerIntoStore());
  }
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = run()
    .catch((err) => console.warn("[ledger] not applied", err instanceof Error ? err.message : err))
    .finally(() => {
      inflight = null;
      if (again) {
        again = false;
        void syncLedgerIntoStore();
      }
    });
  return inflight;
}
