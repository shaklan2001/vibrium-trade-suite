"use client";

import { useMemo } from "react";
import { useTradeStore } from "@/lib/trade/store";
import { filterDealsByCommercialModel } from "@/lib/trade/commercialModel";
import { filterDealsByCommissionCurrency } from "@/lib/trade/commissionCurrency";
import type { Deal } from "@/types/trade";

function withinProductionDueWindow(deal: Deal, days: number): boolean {
  const raw =
    deal.production?.readyDate ||
    deal.payment?.dueDate ||
    deal.booking?.etd ||
    deal.booking?.eta;
  if (!raw) return false;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return false;
  const delta = Math.ceil((t - Date.now()) / 86400000);
  // Include overdue (negative) through +days window
  return delta <= days;
}

/** Deals visible under Agency/Trader, commission currency, stage, and production due filters. */
export function useVisibleDeals(): Deal[] {
  const deals = useTradeStore((s) => s.deals);
  const filter = useTradeStore((s) => s.commercialModelFilter);
  const commissionCurrency = useTradeStore((s) => s.displayCurrency);
  const stageFilter = useTradeStore((s) => s.stageFilter);
  const productionDueFilter = useTradeStore((s) => s.productionDueFilter);

  return useMemo(() => {
    let list = filterDealsByCommercialModel(deals, filter).filter(
      (d) => !d.portfolioSeed && !d.showcase && !d.id.startsWith("bob-"),
    );
    list = filterDealsByCommissionCurrency(list, commissionCurrency);
    if (stageFilter !== "all") {
      list = list.filter((d) => d.stage === stageFilter);
    }
    if (productionDueFilter !== "all") {
      list = list.filter(
        (d) =>
          ["production", "booking", "docs_payment"].includes(d.stage) &&
          withinProductionDueWindow(d, productionDueFilter),
      );
    }
    return list;
  }, [deals, filter, commissionCurrency, stageFilter, productionDueFilter]);
}
