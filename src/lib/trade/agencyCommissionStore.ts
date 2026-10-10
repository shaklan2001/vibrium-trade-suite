"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BuyerCommissionRate } from "./agencyCommission";
import { normalizeBuyerKey } from "./agencyCommission";

interface AgencyCommissionState {
  rates: BuyerCommissionRate[];
  upsertRate: (
    input: Omit<BuyerCommissionRate, "buyerKey" | "updatedAt"> & {
      buyerKey?: string;
      updatedAt?: string;
    },
  ) => BuyerCommissionRate;
  removeRate: (buyerKey: string) => void;
  setPct: (buyerKey: string, pct: number) => void;
}

function now() {
  return new Date().toISOString();
}

export const useAgencyCommissionStore = create<AgencyCommissionState>()(
  persist(
    (set, get) => ({
      rates: [],

      upsertRate: (input) => {
        const buyerKey = normalizeBuyerKey(input.buyerKey || input.buyerName);
        const row: BuyerCommissionRate = {
          buyerKey,
          buyerName: input.buyerName.trim() || buyerKey,
          pct: Number(input.pct) || 0,
          notes: input.notes,
          updatedAt: input.updatedAt || now(),
        };
        const list = get().rates.filter((r) => r.buyerKey !== buyerKey);
        set({ rates: [...list, row].sort((a, b) => a.buyerName.localeCompare(b.buyerName)) });
        return row;
      },

      removeRate: (buyerKey) => {
        const key = normalizeBuyerKey(buyerKey);
        set({ rates: get().rates.filter((r) => r.buyerKey !== key) });
      },

      setPct: (buyerKey, pct) => {
        const key = normalizeBuyerKey(buyerKey);
        set({
          rates: get().rates.map((r) =>
            r.buyerKey === key
              ? { ...r, pct: Number(pct) || 0, updatedAt: now() }
              : r,
          ),
        });
      },
    }),
    {
      name: "vibrium-agency-commission-rates-v1",
      partialize: (s) => ({ rates: s.rates }),
    },
  ),
);
