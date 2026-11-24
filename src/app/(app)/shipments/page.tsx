"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { StatTile } from "@/components/ops/command-center-home";
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
  const delayed = shipments
    .filter((s) => s.delayDays > 0)
    .sort((a, b) => b.delayDays - a.delayDays);
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
        description="Every booked container on one map: where it is, what's late and which ports are slow."
        actions={
          <Link href="/operations">
            <Button variant="ghost">Operations</Button>
          </Link>
        }
      />
      {bookLoading ? (
        <div className="cc-tiles cc-tiles-4 mb-4" role="status" aria-label="Loading shipments">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="cc-sk cc-sk-tile" />
          ))}
        </div>
      ) : (
        <div className="cc-tiles cc-tiles-4 mb-4">
          <StatTile
            label="Shipments tracked"
            value={shipments.length.toLocaleString()}
            caption={`${ports.length} ports`}
          />
          <StatTile
            label="On the water"
            value={onWater.length.toLocaleString()}
            caption={`${k(onWaterValue)} cargo (est.)`}
            tone="info"
          />
          <StatTile
            label="Delayed"
            value={delayed.length.toLocaleString()}
            caption={delayed.length ? "see the list below" : "all on schedule"}
            tone={delayed.length ? "bad" : "good"}
          />
          <StatTile
            label="Busiest port"
            value={hottest?.code || "—"}
            caption={
              hottest
                ? `${hottest.avgWaitDays.toFixed(1)} days wait, ${hottest.name}`
                : "no congestion data"
            }
            tone={hottest && hottest.congestionLevel >= 3 ? "warn" : "flat"}
          />
        </div>
      )}

      <TradeMapCanvas
        shipments={shipments}
        className="mb-6 min-h-[480px]"
      />

      <Card>
        <CardHeader
          title="Delayed shipments"
          description={
            delayed.length
              ? "Behind the planned arrival, longest delay first."
              : "Nothing is running late."
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-[0.75rem] font-medium text-zinc-500">
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
                      <p className="text-xs text-zinc-500">BL {s.blNumber}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600">
                    {s.originPort} to {s.destinationPort}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="deal-code-chip">{s.dealCode}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Badge tone={s.delayDays > 3 ? "danger" : "warning"}>
                      {s.delayDays} day{s.delayDays === 1 ? "" : "s"} late
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
