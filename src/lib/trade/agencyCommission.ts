/**
 * Agency commission display overlay — never mutates golden deal records.
 * commissionUsd = commercialValueUsd × (buyerPct / 100)
 */
import type { Deal } from "@/types/trade";
import { ensureDealEconomics } from "./commandCenterMetrics";
import { dealCommercialModel } from "./commercialModel";
import { isLocalChargesNarrative } from "./localCharges";

/** Default Agency commission when buyer has no saved rate. */
export const DEFAULT_AGENCY_COMMISSION_PCT = 5;

export type BuyerCommissionRate = {
  /** Normalized key (lowercase company) */
  buyerKey: string;
  /** Display name */
  buyerName: string;
  /** Fixed commission percent, e.g. 5 = 5% */
  pct: number;
  notes?: string;
  updatedAt: string;
};

export type AgencyCommissionOverlay = {
  buyerKey: string;
  buyerName: string;
  commercialValueUsd: number;
  pct: number | null;
  commissionUsd: number;
  configured: boolean;
  /** True when applying DEFAULT_AGENCY_COMMISSION_PCT (no saved buyer rate) */
  defaulted?: boolean;
  warning?: string;
};

export function normalizeBuyerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function resolveDealBuyer(deal: Deal): { key: string; name: string } {
  const buyer = deal.parties?.find((p) => p.role === "buyer");
  const name =
    buyer?.company ||
    buyer?.name ||
    deal.requirement?.buyerCompany ||
    deal.po?.buyer ||
    deal.pi?.buyer ||
    "Unknown buyer";
  return { key: normalizeBuyerKey(name), name: String(name).trim() || "Unknown buyer" };
}

export function commercialValueUsd(deal: Deal): number {
  const econ = ensureDealEconomics(deal);
  if (deal.payment?.amountUsd) return deal.payment.amountUsd;
  const blob = `${deal.pi?.summary || ""} ${deal.po?.summary || ""} ${deal.economics?.summary || ""} ${deal.economics?.liquidityNote || ""}`;
  // Origin charges / forwarder GST invoices are not buyer order value.
  if (isLocalChargesNarrative(blob)) {
    return econ.commercialValueUsd > 0 ? econ.commercialValueUsd : 0;
  }
  return (
    deal.pi?.totalAmount ||
    deal.po?.totalAmount ||
    econ.commercialValueUsd ||
    0
  );
}

export function rateForBuyer(
  rates: BuyerCommissionRate[],
  buyerKey: string,
): BuyerCommissionRate | undefined {
  const key = normalizeBuyerKey(buyerKey);
  return rates.find((r) => r.buyerKey === key);
}

/** Display-only commission for an Agency deal. */
export function agencyCommissionForDeal(
  deal: Deal,
  rates: BuyerCommissionRate[],
): AgencyCommissionOverlay {
  const { key, name } = resolveDealBuyer(deal);
  const commercial = commercialValueUsd(deal);
  const rate = rateForBuyer(rates, key);
  const usingDefault =
    !rate || !Number.isFinite(rate.pct) || rate.pct < 0;
  const pct = usingDefault ? DEFAULT_AGENCY_COMMISSION_PCT : rate!.pct;
  const commissionUsd = Math.round(commercial * (pct / 100) * 100) / 100;
  return {
    buyerKey: key,
    buyerName: name,
    commercialValueUsd: commercial,
    pct,
    commissionUsd,
    configured: true,
    defaulted: usingDefault,
    warning: usingDefault
      ? `Using default ${DEFAULT_AGENCY_COMMISSION_PCT}%`
      : undefined,
  };
}

/** Ensure every Agency buyer discovered from deals has a saved rate (default 5%). */
export function seedDefaultRatesForDeals(
  deals: Deal[],
  rates: BuyerCommissionRate[],
  upsert: (input: {
    buyerName: string;
    pct: number;
    notes?: string;
  }) => void,
): number {
  const have = new Set(rates.map((r) => r.buyerKey));
  let added = 0;
  for (const b of discoverBuyersFromDeals(deals)) {
    if (!b.buyerKey || b.buyerKey === "unknown buyer") continue;
    if (have.has(b.buyerKey)) continue;
    upsert({
      buyerName: b.buyerName,
      pct: DEFAULT_AGENCY_COMMISSION_PCT,
      notes: `Default ${DEFAULT_AGENCY_COMMISSION_PCT}%`,
    });
    have.add(b.buyerKey);
    added += 1;
  }
  return added;
}

/** Scale a commercial USD amount to agency commission share for this deal. */
export function toAgencyShareUsd(
  deal: Deal,
  commercialAmountUsd: number,
  rates: BuyerCommissionRate[],
): { amountUsd: number; configured: boolean; warning?: string; pct: number | null } {
  const overlay = agencyCommissionForDeal(deal, rates);
  if (!overlay.configured || overlay.pct == null) {
    return {
      amountUsd: 0,
      configured: false,
      warning: overlay.warning,
      pct: null,
    };
  }
  if (!overlay.commercialValueUsd) {
    return { amountUsd: 0, configured: true, pct: overlay.pct };
  }
  const share = commercialAmountUsd * (overlay.pct / 100);
  return {
    amountUsd: Math.round(share * 100) / 100,
    configured: true,
    pct: overlay.pct,
  };
}

export function discoverBuyersFromDeals(deals: Deal[]): {
  buyerKey: string;
  buyerName: string;
  dealCount: number;
}[] {
  const map = new Map<string, { buyerName: string; dealCount: number }>();
  for (const d of deals) {
    if (dealCommercialModel(d) !== "agency_commission") continue;
    const { key, name } = resolveDealBuyer(d);
    if (!key || key === "unknown buyer") continue;
    const prev = map.get(key);
    if (prev) prev.dealCount += 1;
    else map.set(key, { buyerName: name, dealCount: 1 });
  }
  return [...map.entries()]
    .map(([buyerKey, v]) => ({
      buyerKey,
      buyerName: v.buyerName,
      dealCount: v.dealCount,
    }))
    .sort((a, b) => b.dealCount - a.dealCount || a.buyerName.localeCompare(b.buyerName));
}

export function agencyCommissionBookTotal(
  deals: Deal[],
  rates: BuyerCommissionRate[],
): {
  totalCommissionUsd: number;
  totalCommercialUsd: number;
  configuredDeals: number;
  unconfiguredDeals: number;
  warnings: string[];
} {
  let totalCommissionUsd = 0;
  let totalCommercialUsd = 0;
  let configuredDeals = 0;
  let unconfiguredDeals = 0;
  const warnings: string[] = [];
  for (const d of deals) {
    if (dealCommercialModel(d) !== "agency_commission") continue;
    const o = agencyCommissionForDeal(d, rates);
    totalCommercialUsd += o.commercialValueUsd;
    totalCommissionUsd += o.commissionUsd;
    if (o.configured) configuredDeals += 1;
    else {
      unconfiguredDeals += 1;
      if (o.warning && !warnings.includes(o.warning)) warnings.push(o.warning);
    }
  }
  return {
    totalCommissionUsd,
    totalCommercialUsd,
    configuredDeals,
    unconfiguredDeals,
    warnings,
  };
}
