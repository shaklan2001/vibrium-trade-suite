"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { ProvenanceList } from "@/components/ops/command-center-ui";
import type { CashDrillDeal } from "@/lib/trade/cashExposure";
import { usd } from "@/lib/trade/commandCenterMetrics";

export type DrillPayload = {
  title: string;
  subtitle?: string;
  deals: CashDrillDeal[];
};

/** Drill from a chart or KPI into contributing deals and source messages. */
export function ChartDrillPanel({
  drill,
  onClose,
}: {
  drill: DrillPayload | null;
  onClose: () => void;
}) {
  if (!drill) return null;
  const total = drill.deals.reduce((a, d) => a + d.amountUsd, 0);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-900/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">{drill.title}</h2>
            {drill.subtitle ? (
              <p className="mt-0.5 text-xs text-zinc-500">{drill.subtitle}</p>
            ) : null}
            <p className="mt-1 font-mono text-xs text-zinc-600">
              {drill.deals.length} deal{drill.deals.length === 1 ? "" : "s"}
              {total > 0 ? ` · ${usd(total)}` : ""}
            </p>
          </div>
          <Button variant="ghost" className="px-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto divide-y divide-zinc-100">
          {drill.deals.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              No deals contribute to this measure.
            </p>
          ) : (
            drill.deals.map((d) => (
              <div key={`${d.dealId}-${d.meta}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={d.href}
                      className="font-mono text-xs text-teal-800 underline"
                    >
                      {d.dealCode}
                    </Link>
                    <div className="truncate text-sm font-medium text-zinc-900">
                      {d.title}
                    </div>
                    {d.meta ? (
                      <div className="mt-0.5 text-xs text-zinc-500">{d.meta}</div>
                    ) : null}
                    {d.blockedAt && d.blockedAt !== "none" ? (
                      <div className="mt-1">
                        <Badge tone="warning">{d.blockedAt}</Badge>
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    {d.amountUsd > 0 ? (
                      <div className="font-mono text-sm font-semibold tabular-nums">
                        {usd(d.amountUsd)}
                      </div>
                    ) : null}
                    <Link
                      href={d.href}
                      className="text-[11px] text-teal-700 underline"
                    >
                      Open deal
                    </Link>
                  </div>
                </div>
                <div className="relative mt-2">
                  <ProvenanceList sources={d.sources} alwaysShow />
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-500">
          Open source messages on each deal to review the evidence behind the
          figure.
        </div>
      </aside>
    </div>
  );
}
