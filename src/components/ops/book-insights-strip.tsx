"use client";

import { Badge, Card } from "@/components/ui/primitives";
import type { BookInsights } from "@/lib/trade/bookInsights";
import { formatMoneyWithRate, getDisplayCurrency, USD_TO_INR } from "@/lib/trade/currencyDisplay";
import { usd } from "@/lib/trade/commandCenterMetrics";

function money(n: number, rate = USD_TO_INR) {
  const cur = getDisplayCurrency();
  if (cur === "INR") return formatMoneyWithRate(n, "INR", rate);
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return usd(n);
}

/** Compact book-quality strip for Finance / Command Center (investor visibility). */
export function BookInsightsStrip({
  insights,
  bookRate = USD_TO_INR,
}: {
  insights: BookInsights;
  bookRate?: number;
}) {
  return (
    <Card className="mb-4 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Book pulse
        </div>
        <Badge tone="neutral">
          {insights.dealCount} deals · {insights.coveragePct}% with schedules
        </Badge>
        <Badge tone="info">
          {insights.inrSettlementCount} INR · {insights.usdSettlementCount} USD
          settlement
        </Badge>
        <Badge tone={insights.shippedCount ? "success" : "neutral"}>
          {insights.shippedCount} past commission gate
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <div className="rounded-md border border-zinc-100 bg-zinc-50/80 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            Overdue total
          </div>
          <div className="text-sm font-semibold tabular-nums text-red-700">
            {money(insights.overdueTotalUsd, bookRate)}
          </div>
        </div>
        {insights.overdueAging.map((b) => (
          <div
            key={b.key}
            className="rounded-md border border-zinc-100 bg-white px-2.5 py-2"
          >
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Age {b.label}
            </div>
            <div className="text-sm font-semibold tabular-nums text-zinc-800">
              {money(b.amountUsd, bookRate)}
            </div>
            <div className="text-[10px] text-zinc-400">{b.count} lines</div>
          </div>
        ))}
      </div>
      {insights.agency ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="text-[11px] text-zinc-600">
            Agency collected{" "}
            <span className="font-semibold text-emerald-700">
              {money(insights.agency.collectedUsd, bookRate)}
            </span>{" "}
            · {insights.agency.collectionPct}%
          </div>
          <div className="text-[11px] text-zinc-600">
            Commission due{" "}
            <span className="font-semibold text-amber-700">
              {money(insights.agency.outstandingUsd, bookRate)}
            </span>
          </div>
          <div className="text-[11px] text-zinc-600">
            Commission overdue{" "}
            <span className="font-semibold text-red-700">
              {money(insights.agency.overdueUsd, bookRate)}
            </span>
          </div>
          <div className="text-[11px] text-zinc-600">
            Not yet due{" "}
            <span className="font-semibold text-zinc-700">
              {money(insights.agency.notYetDueUsd, bookRate)}
            </span>
          </div>
        </div>
      ) : null}
      <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-500">
        {insights.headlines.slice(0, 3).map((h) => (
          <li key={h}>· {h}</li>
        ))}
      </ul>
    </Card>
  );
}
