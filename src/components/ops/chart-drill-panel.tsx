"use client";

import { useEffect, useId } from "react";
import Link from "next/link";
import { ArrowUpRight, Info, X } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { ProvenanceList } from "@/components/ops/command-center-ui";
import type { CashDrillDeal } from "@/lib/trade/cashExposure";
import { usd } from "@/lib/trade/commandCenterMetrics";

export type DrillPayload = {
  title: string;
  subtitle?: string;
  deals: CashDrillDeal[];
};

/** Close a side sheet on Escape while it is open. */
export function useSheetEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

/** True when the note just repeats the start of a linked source excerpt. */
function noteRepeatsSource(note: string, deal: CashDrillDeal) {
  const head = note.trim().slice(0, 60).toLowerCase();
  if (!head) return true;
  return deal.sources.some((s) =>
    (s.excerpt || "").toLowerCase().includes(head),
  );
}

function DrillRow({ deal }: { deal: CashDrillDeal }) {
  const note =
    deal.note && !noteRepeatsSource(deal.note, deal) ? deal.note : null;
  return (
    <article className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={deal.href} className="deal-code-chip">
          {deal.dealCode}
        </Link>
        {deal.amountUsd > 0 ? (
          <div className="text-base font-bold tabular-nums tracking-tight text-zinc-900">
            {usd(deal.amountUsd)}
          </div>
        ) : null}
      </div>

      <h3
        className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-zinc-900"
        title={deal.title}
      >
        {deal.title}
      </h3>

      {deal.facts?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {deal.facts.map((f, i) => (
            <Badge key={`${f.label}-${i}`} tone={f.tone || "neutral"}>
              {f.label}
            </Badge>
          ))}
        </div>
      ) : deal.meta ? (
        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-zinc-500">
          {deal.meta}
        </p>
      ) : null}

      {note ? (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-500">
          {note}
        </p>
      ) : null}

      {deal.blockedAt && deal.blockedAt !== "none" ? (
        <div className="mt-2">
          <Badge tone="warning">{deal.blockedAt}</Badge>
        </div>
      ) : null}

      <div className="mt-3">
        <ProvenanceList sources={deal.sources} alwaysShow />
      </div>

      <div className="mt-2 flex justify-end">
        <Link href={deal.href} className="text-link">
          Open deal
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

/** Drill from a chart or KPI into contributing deals and source messages. */
export function ChartDrillPanel({
  drill,
  onClose,
}: {
  drill: DrillPayload | null;
  onClose: () => void;
}) {
  const titleId = useId();
  useSheetEscape(Boolean(drill), onClose);
  if (!drill) return null;

  const total = drill.deals.reduce((a, d) => a + d.amountUsd, 0);
  const count = drill.deals.length;

  return (
    <div className="side-sheet-root">
      <button
        type="button"
        className="side-sheet-backdrop"
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside
        className="side-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="side-sheet-header">
          <div className="min-w-0">
            <p className="side-sheet-eyebrow">Drill-down</p>
            <h2 id={titleId} className="side-sheet-title">
              {drill.title}
            </h2>
            {drill.subtitle ? (
              <p className="side-sheet-subtitle">{drill.subtitle}</p>
            ) : null}
            <div className="mt-3 flex items-baseline gap-2 text-sm text-zinc-500">
              <span>
                {count} deal{count === 1 ? "" : "s"}
              </span>
              {total > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-lg font-bold tabular-nums tracking-tight text-zinc-900">
                    {usd(total)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="side-sheet-body divide-y divide-zinc-100">
          {count === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-500">
              No deals contribute to this measure.
            </p>
          ) : (
            drill.deals.map((d, i) => (
              <DrillRow key={`${d.dealId}-${d.meta}-${i}`} deal={d} />
            ))
          )}
        </div>

        <footer className="side-sheet-footer">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Open a deal to review the source messages behind each figure.
        </footer>
      </aside>
    </div>
  );
}
