/**
 * Commission-currency filter helpers + amount formatting.
 * Selecting INR/USD filters which deals appear (by commission settlement
 * currency) — it does NOT convert the whole book at a single FX rate.
 */
import type { CommissionCurrencyFilter } from "./commissionCurrency";

/** @deprecated prefer CommissionCurrencyFilter — kept for store persistence */
export type DisplayCurrency = CommissionCurrencyFilter;

export {
  COMMISSION_CURRENCY_OPTIONS as DISPLAY_CURRENCY_OPTIONS,
  type CommissionCurrencyFilter,
} from "./commissionCurrency";

/** Fallback market USD→INR when email FX missing (display only). ~Oct 2026 level. */
export const USD_TO_INR = Number(
  process.env.NEXT_PUBLIC_USD_INR_RATE || 96,
);

let current: CommissionCurrencyFilter = "all";

export function getDisplayCurrency(): CommissionCurrencyFilter {
  return current;
}

export function setDisplayCurrency(currency: CommissionCurrencyFilter) {
  current =
    currency === "INR" || currency === "USD" || currency === "all"
      ? currency
      : "all";
}

/** Format a USD commercial/commission amount for the active filter. */
export function convertFromUsd(
  amountUsd: number,
  currency: CommissionCurrencyFilter = current,
): number {
  if (!Number.isFinite(amountUsd)) return 0;
  if (currency === "INR") return amountUsd * USD_TO_INR;
  return amountUsd;
}

export function formatMoney(
  amountUsd: number,
  currency: CommissionCurrencyFilter = current,
): string {
  if (currency === "INR") {
    const n = Math.round(convertFromUsd(amountUsd, "INR"));
    return `₹${n.toLocaleString("en-IN")}`;
  }
  const n = Math.round(amountUsd);
  return `$${n.toLocaleString()}`;
}

/** Format with an explicit USD→INR rate (agreed email rate for that deal). */
export function convertFromUsdWithRate(
  amountUsd: number,
  currency: CommissionCurrencyFilter,
  usdToInr: number,
): number {
  if (!Number.isFinite(amountUsd)) return 0;
  if (currency !== "INR") return amountUsd;
  const rate =
    Number.isFinite(usdToInr) && usdToInr > 0 ? usdToInr : USD_TO_INR;
  return amountUsd * rate;
}

export function formatMoneyWithRate(
  amountUsd: number,
  currency: CommissionCurrencyFilter,
  usdToInr: number,
): string {
  if (currency === "INR") {
    const n = Math.round(
      convertFromUsdWithRate(amountUsd, "INR", usdToInr),
    );
    return `₹${n.toLocaleString("en-IN")}`;
  }
  const n = Math.round(amountUsd);
  return `$${n.toLocaleString()}`;
}
