"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { TradeMapCanvas } from "@/components/ops/trade-map";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import {
  buildMapShipmentsFromDeals,
  listMapPorts,
} from "@/lib/trade/shipmentMap";
import { usd } from "@/lib/trade/commandCenterMetrics";
import { hydrateMailboxBook } from "@/lib/trade/mailboxHydrate";

function k(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return usd(n);
}

export default function ShipmentsMapPage() {
  const deals = useVisibleDeals();
  const mailboxStatus = useTradeStore((s) => s.mailboxBookStatus);

  useEffect(() => {
    if (mailboxStatus === "idle") void hydrateMailboxBook();
  }, [mailboxStatus]);
  useTradeStore((s) => s.displayCurrency);

  const shipments = useMemo(
    () => buildMapShipmentsFromDeals(deals),
    [deals],
  );
  const ports = useMemo(() => listMapPorts(), []);
  const onWater = shipments.filter(
    (s) => s.status === "in_waters" || s.status === "about_to_sail",
  );
  const delayed = shipments.filter((s) => s.delayDays > 0);
  const onWaterValue = onWater.reduce((a, s) => a + s.cargoValueUsd, 0);
  const hottest = [...ports].sort(
    (a, b) =>
      b.congestionLevel - a.congestionLevel || b.avgWaitDays - a.avgWaitDays,
  )[0];
  const bookLoading =
    mailboxStatus === "idle" || mailboxStatus === "loading";

  return (
    <div>
      <PageHeader
        title="Shipment map"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">
              {bookLoading ? "…" : onWater.length} on water
            </Badge>
            <Badge tone="warning">
              {bookLoading ? "…" : delayed.length} delayed
            </Badge>
            <Badge>{ports.length} ports</Badge>
            <Link href="/operations">
              <Button variant="ghost">Operations</Button>
            </Link>
          </div>
        }
      />
      {bookLoading ? (
        <div className="mb-4 flex flex-col items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white px-6 py-16 text-center shadow-sm">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-teal-700" />
          <p className="text-sm font-medium text-zinc-700">
            Loading shipments…
          </p>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Shipments tracked
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {shipments.length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            On-water cargo (est.)
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {k(onWaterValue)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Hottest port
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {hottest?.code || "—"}
          </p>
          {hottest ? (
            <p className="text-xs text-zinc-500">
              L{hottest.congestionLevel} · {hottest.avgWaitDays.toFixed(1)}d
              wait · {hottest.name}
            </p>
          ) : null}
        </Card>
      </div>

      <TradeMapCanvas
        shipments={shipments}
        className="mb-6 min-h-[480px]"
      />

      <Card>
        <div className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold">
          Delayed shipments
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2 font-medium">Vessel</th>
                <th className="px-4 py-2 font-medium">Lane</th>
                <th className="px-4 py-2 font-medium">Deal</th>
                <th className="px-4 py-2 font-medium text-right">Delay</th>
              </tr>
            </thead>
            <tbody>
              {delayed.map((s) => (
                <tr key={s.id} className="border-b border-zinc-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={s.href}
                      className="font-medium text-teal-800 hover:underline"
                    >
                      {s.vessel}
                    </Link>
                    {s.blNumber ? (
                      <p className="text-[10px] text-zinc-500">{s.blNumber}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600">
                    {s.originPort} → {s.destinationPort}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{s.dealCode}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge tone={s.delayDays > 3 ? "danger" : "warning"}>
                      +{s.delayDays}d
                    </Badge>
                  </td>
                </tr>
              ))}
              {delayed.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No delayed shipments
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
