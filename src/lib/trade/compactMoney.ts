import {
  formatMoneyWithRate,
  getDisplayCurrency,
  USD_TO_INR,
} from "@/lib/trade/currencyDisplay";

/** One decimal under 100, none above; drops a trailing ".0". */
function trim(x: number): string {
  const s = Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * Short money for tiles, charts and copy, in the header's display currency:
 * $9.3M · $412k · $860, or ₹7.7 Cr · ₹4.1 L · ₹8.2k. `rate` is the USD→INR
 * rate to use (deal/book FX); defaults to the app rate.
 */
export function compactMoney(usdAmount: number, rate = USD_TO_INR): string {
  if (getDisplayCurrency() === "INR") {
    const inr = usdAmount * (rate > 0 ? rate : USD_TO_INR);
    if (Math.abs(inr) >= 1e7) return `₹${trim(inr / 1e7)} Cr`;
    if (Math.abs(inr) >= 1e5) return `₹${trim(inr / 1e5)} L`;
    if (Math.abs(inr) >= 1e3) return `₹${trim(inr / 1e3)}k`;
    return formatMoneyWithRate(usdAmount, "INR", rate);
  }
  if (Math.abs(usdAmount) >= 1e6) return `$${trim(usdAmount / 1e6)}M`;
  if (Math.abs(usdAmount) >= 1e3) return `$${trim(usdAmount / 1e3)}k`;
  return `$${Math.round(usdAmount).toLocaleString()}`;
}
