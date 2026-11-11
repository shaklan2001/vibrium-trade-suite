"use client";

import { useState } from "react";
import type { Deal } from "@/types/trade";
import { dealCommercialModel, type CommercialModel } from "@/lib/trade/commercialModel";

/**
 * Move a mailbox deal between the Agency and Trader books by hand.
 * The choice is stored in deal_overrides and wins over the automatic rules.
 */
export function BookSwitch({
  deal,
  onChange,
}: {
  deal: Deal;
  onChange: (model: CommercialModel, pinned: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!deal.mailboxSourceId) return null;

  const model = dealCommercialModel(deal);
  const other: CommercialModel =
    model === "trader_principal" ? "agency_commission" : "trader_principal";

  async function save(next: CommercialModel | null) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/processed-deals/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deal.mailboxSourceId, commercialModel: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (next) onChange(next, true);
      else {
        onChange(model, false);
        setNote("Automatic again from the next board refresh");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the book");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        disabled={busy}
        onClick={() => void save(other)}
        className="rounded-md border border-zinc-200 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {busy ? "Saving…" : other === "trader_principal" ? "Move to Trader" : "Move to Agency"}
      </button>
      {deal.commercialModelPinned ? (
        <>
          <span className="text-zinc-500">Set by hand</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="text-teal-700 underline disabled:opacity-50"
          >
            Use automatic
          </button>
        </>
      ) : null}
      {note ? <span className="text-zinc-500">{note}</span> : null}
      {error ? <span className="text-red-700">{error}</span> : null}
    </span>
  );
}
