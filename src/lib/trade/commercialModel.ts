import type { Deal } from "@/types/trade";

export type CommercialModel = "agency_commission" | "trader_principal";

export type CommercialModelFilter = "all" | CommercialModel;

export const COMMERCIAL_MODEL_STORAGE_KEY = "vibrium-commercial-model-filter";

export const COMMERCIAL_MODEL_OPTIONS: {
  id: CommercialModelFilter;
  label: string;
  shortLabel: string;
}[] = [
  { id: "all", label: "All models", shortLabel: "All" },
  {
    id: "agency_commission",
    label: "Agency (SNSPL referee)",
    shortLabel: "Agency",
  },
  {
    id: "trader_principal",
    label: "Trader (Global Praise)",
    shortLabel: "Trader",
  },
];

export function normalizeCommercialModel(
  value: unknown,
): CommercialModel | undefined {
  if (value === "agency_commission" || value === "trader_principal") {
    return value;
  }
  return undefined;
}

export function dealCommercialModel(deal: Deal): CommercialModel {
  return deal.commercialModel || "agency_commission";
}

export function dealMatchesCommercialModel(
  deal: Deal,
  filter: CommercialModelFilter,
): boolean {
  if (filter === "all") return true;
  return dealCommercialModel(deal) === filter;
}

export function filterDealsByCommercialModel(
  deals: Deal[],
  filter: CommercialModelFilter,
): Deal[] {
  return deals.filter((d) => dealMatchesCommercialModel(d, filter));
}
