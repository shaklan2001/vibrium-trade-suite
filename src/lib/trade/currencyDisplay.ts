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
/** USD per 1 EUR / GBP — the rates mailbox extracts are converted at. */
export const EUR_TO_USD = 1.08;
export const GBP_TO_USD = 1.27;

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
  return `$${n.toLocaleString("en-US")}`;
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
  return `$${n.toLocaleString("en-US")}`;
}

const DOC_CURRENCY: Record<string, { symbol: string; locale: string; perUsd: number }> = {
  INR: { symbol: "₹", locale: "en-IN", perUsd: USD_TO_INR },
  EUR: { symbol: "€", locale: "en-US", perUsd: 1 / EUR_TO_USD },
  GBP: { symbol: "£", locale: "en-US", perUsd: 1 / GBP_TO_USD },
};

function docCurrencyCode(currency?: string | null): string {
  const c = String(currency || "").trim().toUpperCase();
  if (c === "₹" || c === "RS" || c === "RS.") return "INR";
  if (c === "$" || c === "US$") return "USD";
  return c;
}

/** True when the deal's documents are in INR / EUR / GBP. */
export function isNonUsdDocCurrency(currency?: string | null): boolean {
  return docCurrencyCode(currency) in DOC_CURRENCY;
}

/**
 * Show a deal amount in the currency its document was written in.
 * Amounts are stored in USD; INR / EUR / GBP are converted back at the rate
 * they were stored with, so ₹38,764.11 shows as ₹38,764.11, not $404.
 * USD (or unknown) falls back to formatMoney and the book's currency filter.
 */
export function formatDocMoney(amountUsd: number, currency?: string | null): string {
  const spec = DOC_CURRENCY[docCurrencyCode(currency)];
  if (!spec || !Number.isFinite(amountUsd)) return formatMoney(amountUsd);
  const native = Math.round(amountUsd * spec.perUsd * 100) / 100;
  const decimals = Number.isInteger(native) ? 0 : 2;
  return `${spec.symbol}${native.toLocaleString(spec.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 2,
  })}`;
}
