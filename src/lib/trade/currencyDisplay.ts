/** Display currency for dashboards (amounts stored as USD). */
export type DisplayCurrency = "USD" | "INR";

export const DISPLAY_CURRENCY_OPTIONS: {
  id: DisplayCurrency;
  label: string;
  shortLabel: string;
}[] = [
  { id: "USD", label: "US Dollar", shortLabel: "USD" },
  { id: "INR", label: "Indian Rupee", shortLabel: "INR" },
];

/** Approx FX for display only — not a treasury rate. */
export const USD_TO_INR = Number(
  process.env.NEXT_PUBLIC_USD_INR_RATE || 83,
);

let current: DisplayCurrency = "USD";

export function getDisplayCurrency(): DisplayCurrency {
  return current;
}

export function setDisplayCurrency(currency: DisplayCurrency) {
  current = currency === "INR" ? "INR" : "USD";
}

export function convertFromUsd(
  amountUsd: number,
  currency: DisplayCurrency = current,
): number {
  if (!Number.isFinite(amountUsd)) return 0;
  return currency === "INR" ? amountUsd * USD_TO_INR : amountUsd;
}

export function formatMoney(
  amountUsd: number,
  currency: DisplayCurrency = current,
): string {
  const n = Math.round(convertFromUsd(amountUsd, currency));
  if (currency === "INR") {
    return `₹${n.toLocaleString("en-IN")}`;
  }
  return `$${n.toLocaleString()}`;
}

/** Format with an explicit USD→INR rate (email or internet overlay). */
export function convertFromUsdWithRate(
  amountUsd: number,
  currency: DisplayCurrency,
  usdToInr: number,
): number {
  if (!Number.isFinite(amountUsd)) return 0;
  if (currency !== "INR") return amountUsd;
  const rate = Number.isFinite(usdToInr) && usdToInr > 0 ? usdToInr : USD_TO_INR;
  return amountUsd * rate;
}

export function formatMoneyWithRate(
  amountUsd: number,
  currency: DisplayCurrency,
  usdToInr: number,
): string {
  const n = Math.round(convertFromUsdWithRate(amountUsd, currency, usdToInr));
  if (currency === "INR") {
    return `₹${n.toLocaleString("en-IN")}`;
  }
  return `$${n.toLocaleString()}`;
}
