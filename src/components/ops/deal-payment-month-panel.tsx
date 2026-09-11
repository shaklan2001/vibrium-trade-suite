"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/primitives";
import { KpiTile } from "@/components/ops/command-center-ui";
import {
  monthBucketsFromLines,
  paymentLineToDrill,
  lateLabel,
  type OrderPaymentBucket,
  type PaymentLine,
} from "@/lib/trade/paymentSchedule";
import type { CashDrillDeal } from "@/lib/trade/cashExposure";
import { usd } from "@/lib/trade/commandCenterMetrics";

const EMERALD = "#059669";
const SKY = "#0284c7";
const AMBER = "#d97706";
const TEAL = "#0f766e";
const RED = "#dc2626";

function k(n: number) {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return usd(n);
}

function sideStats(lines: PaymentLine[], side: "buyer" | "factory") {
  const list = lines.filter((l) => l.side === side);
  return {
    list,
    received: list
      .filter((l) => l.status === "received")
      .reduce((a, l) => a + l.amountUsd, 0),
    upcoming: list
      .filter((l) => l.status === "upcoming" || l.status === "due")
      .reduce((a, l) => a + l.amountUsd, 0),
    overdue: list
      .filter((l) => l.status === "overdue")
      .reduce((a, l) => a + l.amountUsd, 0),
  };
}

export type DealMonthFocus = {
  order: OrderPaymentBucket;
};

/** Side panel: one deal’s buyer + factory payment terms month by month. */
export function DealPaymentMonthPanel({
  focus,
  onClose,
  onOpenLines,
}: {
  focus: DealMonthFocus | null;
  onClose: () => void;
  onOpenLines: (
    title: string,
    lines: PaymentLine[],
    subtitle?: string,
  ) => void;
}) {
  const [installmentFilter, setInstallmentFilter] = useState<
    "all" | "buyer" | "factory"
  >("all");

  const order = focus?.order;
  const buyer = useMemo(
    () => (order ? sideStats(order.lines, "buyer") : null),
    [order],
  );
  const factory = useMemo(
    () => (order ? sideStats(order.lines, "factory") : null),
    [order],
  );

  const chart = useMemo(() => {
    if (!order) return [];
    const months = monthBucketsFromLines(order.lines);
    return months.map((m) => {
      const buyerLines = m.lines.filter((l) => l.side === "buyer");
      const factoryLines = m.lines.filter((l) => l.side === "factory");
      return {
        label: m.monthLabel,
        "Buyer received": buyerLines
          .filter((l) => l.status === "received")
          .reduce((a, l) => a + l.amountUsd, 0),
        "Buyer upcoming": buyerLines
          .filter(
            (l) =>
              l.status === "upcoming" ||
              l.status === "due" ||
              l.status === "overdue",
          )
          .reduce((a, l) => a + l.amountUsd, 0),
        "Factory paid": factoryLines
          .filter((l) => l.status === "received")
          .reduce((a, l) => a + l.amountUsd, 0),
        "Factory still due": factoryLines
          .filter(
            (l) =>
              l.status === "upcoming" ||
              l.status === "due" ||
              l.status === "overdue",
          )
          .reduce((a, l) => a + l.amountUsd, 0),
        lines: m.lines,
      };
    });
  }, [order]);

  if (!focus || !order || !buyer || !factory) return null;

  const terms = [order.buyerTerms, order.factoryTerms]
    .filter(Boolean)
    .join(" · ");

  const visibleInstallments = order.lines
    .slice()
    .filter((l) =>
      installmentFilter === "all" ? true : l.side === installmentFilter,
    )
    .sort((a, b) =>
      (a.dueDate || a.receivedAt || "").localeCompare(
        b.dueDate || b.receivedAt || "",
      ),
    );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-900/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-mono text-sm font-semibold text-zinc-900">
              {order.dealCode}
            </h2>
            <p className="mt-0.5 truncate text-sm text-zinc-700">{order.title}</p>
            {terms ? (
              <p className="mt-1 text-xs text-zinc-500">{terms}</p>
            ) : null}
            <Link
              href={order.href}
              className="mt-1 inline-block text-[11px] text-teal-700 underline"
            >
              Open deal
            </Link>
          </div>
          <Button variant="ghost" className="px-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2 border-b border-zinc-100 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Buyer (RCV)
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className="text-left"
              onClick={() =>
                onOpenLines(
                  `${order.dealCode} · buyer received`,
                  buyer.list.filter((l) => l.status === "received"),
                  order.buyerTerms,
                )
              }
            >
              <KpiTile
                label="Received"
                value={k(buyer.received)}
                tone="success"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() =>
                onOpenLines(
                  `${order.dealCode} · buyer upcoming`,
                  buyer.list.filter(
                    (l) => l.status === "upcoming" || l.status === "due",
                  ),
                  order.buyerTerms,
                )
              }
            >
              <KpiTile
                label="Upcoming"
                value={k(buyer.upcoming)}
                tone="info"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() =>
                onOpenLines(
                  `${order.dealCode} · buyer overdue`,
                  buyer.list.filter((l) => l.status === "overdue"),
                  order.buyerTerms,
                )
              }
            >
              <KpiTile
                label="Overdue"
                value={k(buyer.overdue)}
                tone="danger"
              />
            </button>
          </div>

          <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Factory (PAY)
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className="text-left"
              onClick={() =>
                onOpenLines(
                  `${order.dealCode} · factory paid`,
                  factory.list.filter((l) => l.status === "received"),
                  order.factoryTerms,
                )
              }
            >
              <KpiTile label="Paid" value={k(factory.received)} tone="success" />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() =>
                onOpenLines(
                  `${order.dealCode} · factory still due`,
                  factory.list.filter(
                    (l) => l.status === "upcoming" || l.status === "due",
                  ),
                  order.factoryTerms,
                )
              }
            >
              <KpiTile
                label="Still due"
                value={k(factory.upcoming)}
                tone="warning"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() =>
                onOpenLines(
                  `${order.dealCode} · factory overdue`,
                  factory.list.filter((l) => l.status === "overdue"),
                  order.factoryTerms,
                )
              }
            >
              <KpiTile
                label="Overdue"
                value={k(factory.overdue)}
                tone="danger"
              />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Month-wise · buyer & factory
          </div>
          <p className="mb-3 text-[11px] text-zinc-500">
            Select a bar to inspect installments and source messages
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={
                  chart.length
                    ? chart
                    : [
                        {
                          label: "—",
                          "Buyer received": 0,
                          "Buyer upcoming": 0,
                          "Factory paid": 0,
                          "Factory still due": 0,
                          lines: [] as PaymentLine[],
                        },
                      ]
                }
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => k(Number(v))}
                  tick={{ fontSize: 10 }}
                  width={44}
                />
                <Tooltip formatter={(v: number) => usd(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="Buyer received"
                  stackId="b"
                  fill={EMERALD}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = chart[index];
                    if (row)
                      onOpenLines(
                        `${order.dealCode} · ${row.label} · buyer received`,
                        row.lines.filter(
                          (l) =>
                            l.side === "buyer" && l.status === "received",
                        ),
                      );
                  }}
                />
                <Bar
                  dataKey="Buyer upcoming"
                  stackId="b"
                  fill={SKY}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = chart[index];
                    if (row)
                      onOpenLines(
                        `${order.dealCode} · ${row.label} · buyer open`,
                        row.lines.filter(
                          (l) =>
                            l.side === "buyer" && l.status !== "received",
                        ),
                      );
                  }}
                />
                <Bar
                  dataKey="Factory paid"
                  stackId="f"
                  fill={TEAL}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = chart[index];
                    if (row)
                      onOpenLines(
                        `${order.dealCode} · ${row.label} · factory paid`,
                        row.lines.filter(
                          (l) =>
                            l.side === "factory" && l.status === "received",
                        ),
                      );
                  }}
                />
                <Bar
                  dataKey="Factory still due"
                  stackId="f"
                  fill={AMBER}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = chart[index];
                    if (row)
                      onOpenLines(
                        `${order.dealCode} · ${row.label} · factory open`,
                        row.lines.filter(
                          (l) =>
                            l.side === "factory" && l.status !== "received",
                        ),
                      );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Installments
              </div>
              <div className="inline-flex rounded-full border border-zinc-200 p-0.5 text-[11px]">
                {(
                  [
                    ["all", "All"],
                    ["buyer", "Buyer"],
                    ["factory", "Factory"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInstallmentFilter(id)}
                    className={
                      installmentFilter === id
                        ? "rounded-full bg-teal-700 px-2.5 py-0.5 font-medium text-white"
                        : "rounded-full px-2.5 py-0.5 text-zinc-600"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {visibleInstallments.map((line) => {
              const late = lateLabel(line.daysLate, line.notReceived);
              return (
                <button
                  key={line.checkpointId}
                  type="button"
                  className="flex w-full items-start justify-between gap-2 rounded-md border border-zinc-100 px-3 py-2 text-left hover:border-teal-200 hover:bg-teal-50/40"
                  onClick={() =>
                    onOpenLines(
                      `${order.dealCode} · ${line.label}`,
                      [line],
                      [
                        line.side === "buyer" ? "Buyer" : "Factory",
                        line.termsExcerpt,
                        line.status === "received"
                          ? `received ${line.receivedAt || ""}`
                          : `due ${line.dueDate || "—"}`,
                        late,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    )
                  }
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900">
                      {line.label}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {line.side === "buyer" ? "Buyer" : "Factory"}
                      {line.checkpoint ? ` · ${line.checkpoint}` : ""}
                      {" · "}
                      {line.monthLabel}
                      {" · "}
                      {line.status === "received" ? "received" : "not received"}
                    </div>
                    {late ? (
                      <div className="mt-0.5 text-[11px] font-semibold text-red-600">
                        {late}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {usd(line.amountUsd)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function paymentLinesToDrillDeals(lines: PaymentLine[]): CashDrillDeal[] {
  return lines.map(paymentLineToDrill);
}
