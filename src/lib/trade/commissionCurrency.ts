/**
 * Commission / settlement currency filter.
 * Filters deals by the currency remittance/commission is settled in —
 * not a book-wide FX convert of commercial USD.
 */
import type { Deal } from "@/types/trade";
import { extractFxFromDeal } from "./fxFromEvidence";

export type CommissionPaymentCurrency = "USD" | "INR";

export type CommissionCurrencyFilter = "all" | CommissionPaymentCurrency;

export const COMMISSION_CURRENCY_OPTIONS: {
  id: CommissionCurrencyFilter;
  label: string;
  shortLabel: string;
}[] = [
  { id: "all", label: "All settlement currencies", shortLabel: "All" },
  { id: "USD", label: "Settled / paid in USD", shortLabel: "USD" },
  { id: "INR", label: "Settled / paid in INR", shortLabel: "INR" },
];

const INR_TOKEN = /\b(?:inr|rs\.?|rupees?)\b|₹/i;
const USD_TOKEN = /\b(?:usd|us\$|dollars?)\b|(?<![A-Z])\$(?=\s*\d)/i;

/** Explicit INR money like "INR 16,176" / "₹16,176" / "Rs. 16176". */
const INR_MONEY =
  /(?:\bINR\b|\bRs\.?\b|₹)\s*[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s*(?:\bINR\b|\bRs\.?\b)/i;

const USD_MONEY =
  /(?:\bUSD\b|US\$|\$)\s*[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s*(?:\bUSD\b)/i;

const COMMISSION_INR =
  /\b(?:commission|agency\s*fee|snspl\s*(?:fee|commission)|our\s*fee|invoice)\b[\s\S]{0,400}\b(?:inr|rs\.?|₹|rupees?)\b|\b(?:inr|rs\.?|₹|rupees?)\b[\s\S]{0,400}\b(?:commission|agency\s*fee|snspl\s*(?:fee|commission))\b/i;

const COMMISSION_USD =
  /\b(?:commission|agency\s*fee|snspl\s*(?:fee|commission)|our\s*fee)\b[\s\S]{0,400}\b(?:usd|us\$|dollars?)\b|\b(?:usd|us\$|dollars?)\b[\s\S]{0,400}\b(?:commission|agency\s*fee)\b/i;

function normalizeCur(raw?: string | null): CommissionPaymentCurrency | null {
  const c = (raw || "").trim().toUpperCase();
  if (!c) return null;
  if (c === "INR" || c === "RS" || c === "₹" || c === "RUPEE" || c === "RUPEES")
    return "INR";
  if (c === "USD" || c === "US$" || c === "DOLLAR" || c === "DOLLARS")
    return "USD";
  return null;
}

function sourceBlob(deal: Deal): string {
  const parts: string[] = [];
  if (deal.title) parts.push(deal.title);
  if (deal.payment?.summary) parts.push(deal.payment.summary);
  if (deal.payment?.currency) parts.push(deal.payment.currency);
  if (deal.commission?.summary) parts.push(deal.commission.summary);
  if (deal.commission?.currency) parts.push(deal.commission.currency);
  if (deal.commission?.fxRate) parts.push(String(deal.commission.fxRate));
  if (deal.paymentSchedule?.currency)
    parts.push(deal.paymentSchedule.currency);
  if (deal.po?.currency) parts.push(deal.po.currency);
  if (deal.pi?.currency) parts.push(deal.pi.currency);
  if (deal.economics?.summary) parts.push(deal.economics.summary);
  if (deal.economics?.liquidityNote) parts.push(deal.economics.liquidityNote);
  for (const s of deal.sources || []) {
    if (s.subject) parts.push(s.subject);
    if (s.extractedSummary) parts.push(s.extractedSummary);
    if (s.body) parts.push(s.body.slice(0, 12_000));
  }
  // Agent raw result often holds the only currency signal
  if (deal.agentResult && typeof deal.agentResult === "object") {
    const r = deal.agentResult as Record<string, unknown>;
    if (typeof r.summary === "string") parts.push(r.summary);
    if (typeof r.currency === "string") parts.push(r.currency);
  }
  return parts.join("\n");
}

/**
 * Resolve currency in which buyer/factory remittance or commission is settled.
 * Domestic INR invoices (e.g. "outstanding INR 16,176") count as INR even when
 * commercial model is agency and deal "FOB" language mentions USD elsewhere.
 */
export function resolveCommissionPaymentCurrency(
  deal: Deal,
): CommissionPaymentCurrency {
  const blob = sourceBlob(deal);
  const hasInrMoneyEarly = INR_MONEY.test(blob);
  const hasUsdMoneyEarly = USD_MONEY.test(blob);

  const explicit =
    normalizeCur(deal.commission?.currency) ||
    normalizeCur(deal.payment?.currency) ||
    normalizeCur(deal.paymentSchedule?.currency) ||
    normalizeCur(deal.po?.currency) ||
    normalizeCur(deal.pi?.currency);
  // Payment-clock settlement currency wins when set.
  if (normalizeCur(deal.payment?.currency) === "INR" && hasInrMoneyEarly) {
    return "INR";
  }
  // Explicit INR on PI/PO is often wrong for FOB export extracts (agent tags
  // India origin as INR). Prefer USD when narrative is FOB/US destination
  // unless payment itself is clearly INR money.
  if (explicit === "INR") {
    const fobExport =
      /\bFOB\b/i.test(blob) ||
      /\b(?:POD|destination)\b.{0,40}\b(?:Houston|New York|Los Angeles|USA|U\.S\.A|United States)\b/i.test(
        blob,
      );
    if (fobExport && normalizeCur(deal.payment?.currency) !== "INR") {
      return "USD";
    }
    if (hasInrMoneyEarly) return "INR";
    if (hasUsdMoneyEarly) return "USD";
    return "INR";
  }
  if (explicit === "USD") return "USD";

  if (COMMISSION_INR.test(blob) && !COMMISSION_USD.test(blob)) return "INR";
  if (COMMISSION_USD.test(blob) && !COMMISSION_INR.test(blob)) return "USD";

  const hasInrMoney = hasInrMoneyEarly;
  const hasUsdMoney = hasUsdMoneyEarly;
  // Pure INR money (Henlo-style domestic invoices) → INR
  if (hasInrMoney && !hasUsdMoney) return "INR";
  // Export commercials with USD amounts stay USD even if "India"/"Rs" noise appears
  if (hasUsdMoney) return "USD";

  // Soft "pay in INR" without digits — only in payment/commission context
  if (
    INR_TOKEN.test(blob) &&
    !USD_TOKEN.test(blob) &&
    /\b(commission|payment|settle|remit|invoice)\b/i.test(blob)
  ) {
    return "INR";
  }

  // Agreed USD→INR in mail ⇒ INR settlement of commission
  if (extractFxFromDeal(deal)) return "INR";

  return "USD";
}

export function dealMatchesCommissionCurrency(
  deal: Deal,
  filter: CommissionCurrencyFilter,
): boolean {
  if (filter === "all") return true;
  return resolveCommissionPaymentCurrency(deal) === filter;
}

export function filterDealsByCommissionCurrency(
  deals: Deal[],
  filter: CommissionCurrencyFilter,
): Deal[] {
  return deals.filter((d) => dealMatchesCommissionCurrency(d, filter));
}

/** Detect currency from free text (summary / invoice line). */
export function detectCurrencyFromText(
  text?: string,
): CommissionPaymentCurrency | null {
  if (!text?.trim()) return null;
  if (INR_MONEY.test(text) && !USD_MONEY.test(text)) return "INR";
  if (USD_MONEY.test(text) && !INR_MONEY.test(text)) return "USD";
  if (INR_MONEY.test(text)) {
    const inrIdx = text.search(INR_MONEY);
    const usdIdx = text.search(USD_MONEY);
    if (inrIdx >= 0 && (usdIdx < 0 || inrIdx <= usdIdx)) return "INR";
  }
  const cur = text.match(/\b(USD|INR|EUR|GBP)\b/i);
  return normalizeCur(cur?.[1] || null);
}
