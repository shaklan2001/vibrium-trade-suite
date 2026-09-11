"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/app-shell";
import { Button, Card } from "@/components/ui/primitives";
import { KpiTile } from "@/components/ops/command-center-ui";
import {
  ChartDrillPanel,
  type DrillPayload,
} from "@/components/ops/chart-drill-panel";
import {
  DealPaymentMonthPanel,
  type DealMonthFocus,
} from "@/components/ops/deal-payment-month-panel";
import { OrderPaymentFlowGrid } from "@/components/ops/order-payment-flow-grid";
import { useTradeStore } from "@/lib/trade/store";
import {
  buildCashExposureReport,
  type CashDrillDeal,
} from "@/lib/trade/cashExposure";
import {
  buildPaymentScheduleReport,
  paymentLineToDrill,
  type OrderPaymentBucket,
} from "@/lib/trade/paymentSchedule";
import { usd } from "@/lib/trade/commandCenterMetrics";

const TEAL = "#0f766e";
const AMBER = "#d97706";
const RED = "#dc2626";
const SKY = "#0284c7";
const EMERALD = "#059669";
const ZINC = "#3f3f46";

function k(n: number) {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return usd(n);
}

export default function FinanceDashboardPage() {
  const deals = useTradeStore((s) => s.deals);
  const seedBookOfBusiness = useTradeStore((s) => s.seedBookOfBusiness);
  const [hydrated, setHydrated] = useState(false);
  const [drill, setDrill] = useState<DrillPayload | null>(null);
  const [dealFocus, setDealFocus] = useState<DealMonthFocus | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) seedBookOfBusiness();
  }, [hydrated, seedBookOfBusiness]);

  const cash = useMemo(() => buildCashExposureReport(deals), [deals]);
  const pay = useMemo(() => buildPaymentScheduleReport(deals), [deals]);

  const rollingData = cash.rolling.map((r) => ({
    label: `${r.horizonDays}d`,
    Need: r.requiredUsd,
    deals: r.deals,
  }));

  const blockedData = cash.blockedByLocation.map((b) => ({
    label: b.location,
    Amount: b.amountUsd,
    deals: b.deals,
  }));

  const commissionData = [
    {
      label: "Awaiting / invoiced",
      Amount: cash.commissionAwaitingUsd,
      deals: cash.commissionLines.filter(
        (d) =>
          (d.meta || "").toLowerCase().includes("invoice") ||
          (d.meta || "").toLowerCase().includes("fx"),
      ),
    },
    {
      label: "Chasing",
      Amount: cash.commissionChasingUsd,
      deals: cash.commissionLines.filter((d) =>
        (d.meta || "").toLowerCase().includes("chas"),
      ),
    },
    {
      label: "Received",
      Amount: cash.commissionReceivedUsd,
      deals: cash.commissionLines.filter((d) =>
        (d.meta || "").toLowerCase().includes("received"),
      ),
    },
  ].filter((x) => x.Amount > 0 || x.deals.length);

  const deployCompare = [
    {
      label: "Deployed",
      Amount: cash.cashDeployedUsd,
      deals: cash.deployedDeals,
    },
    {
      label: "Still required",
      Amount: cash.cashStillRequiredUsd,
      deals: cash.stillRequiredDeals,
    },
    {
      label: "Recoveries",
      Amount: cash.expectedRecoveriesUsd,
      deals: cash.recoveries,
    },
  ];

  const monthChart = pay.byMonth.map((m) => ({
    label: m.monthLabel,
    Received: m.receivedUsd,
    Upcoming: m.upcomingUsd,
    Overdue: m.overdueUsd,
    lines: m.lines,
  }));

  const orderChart = pay.byOrder.slice(0, 8).map((o) => ({
    label: o.dealCode,
    Received: o.receivedUsd,
    Upcoming: o.upcomingUsd,
    Overdue: o.overdueUsd,
    title: o.title,
    buyerTerms: o.buyerTerms,
    factoryTerms: o.factoryTerms,
    lines: o.lines,
    order: o,
  }));

  function openDrill(
    title: string,
    dealsList: CashDrillDeal[],
    subtitle?: string,
  ) {
    setDealFocus(null);
    setDrill({ title, subtitle, deals: dealsList });
  }

  function openPaymentLines(
    title: string,
    lines: typeof pay.lines,
    subtitle?: string,
  ) {
    openDrill(title, lines.map(paymentLineToDrill), subtitle);
  }

  function openDealMonth(order: OrderPaymentBucket) {
    setDrill(null);
    setDealFocus({ order });
  }

  if (!hydrated) {
    return <PageHeader title="Finance" description="Loading…" />;
  }

  return (
    <div>
      <PageHeader
        title="Finance"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/home">
              <Button variant="ghost">Command Center</Button>
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                seedBookOfBusiness();
                toast.success("Data refreshed");
              }}
            >
              Refresh data
            </Button>
          </div>
        }
      />

      {/* Payment terms — buyer / factory */}
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Payment terms · checkpoints
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openPaymentLines(
              "Buyer payments received",
              pay.lines.filter(
                (l) => l.side === "buyer" && l.status === "received",
              ),
              "Confirmed remittances against PO terms",
            )
          }
        >
          <KpiTile
            size="lg"
            label="Buyer received"
            value={k(pay.buyerReceivedUsd)}
            tone="success"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openPaymentLines(
              "Buyer payments due / upcoming",
              pay.lines.filter(
                (l) =>
                  l.side === "buyer" &&
                  (l.status === "upcoming" || l.status === "due"),
              ),
              "Installments waiting on the next checkpoint",
            )
          }
        >
          <KpiTile
            size="lg"
            label="Buyer upcoming"
            value={k(pay.buyerUpcomingUsd)}
            tone="info"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openPaymentLines(
              "Buyer payments overdue",
              pay.lines.filter(
                (l) => l.side === "buyer" && l.status === "overdue",
              ),
            )
          }
        >
          <KpiTile
            size="lg"
            label="Buyer overdue"
            value={k(pay.buyerOverdueUsd)}
            tone="danger"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openPaymentLines(
              "Factory payments made",
              pay.lines.filter(
                (l) => l.side === "factory" && l.status === "received",
              ),
              "Cash already deployed to factories",
            )
          }
        >
          <KpiTile
            size="lg"
            label="Factory paid"
            value={k(pay.factoryReceivedUsd)}
            tone="info"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openPaymentLines(
              "Factory payments still due",
              pay.lines.filter(
                (l) =>
                  l.side === "factory" &&
                  (l.status === "upcoming" ||
                    l.status === "due" ||
                    l.status === "overdue"),
              ),
            )
          }
        >
          <KpiTile
            size="lg"
            label="Factory still due"
            value={k(pay.factoryUpcomingUsd + pay.factoryOverdueUsd)}
            tone="warning"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openDrill(
              "Cash deployed (from payment terms)",
              cash.deployedDeals,
              "Aligned to factory installments already paid",
            )
          }
        >
          <KpiTile
            size="lg"
            label="Cash deployed"
            value={k(cash.cashDeployedUsd)}
            tone="info"
          />
        </button>
      </div>

      <Card className="mb-4 p-3">
        <OrderPaymentFlowGrid
          orders={pay.byOrder}
          onSelectOrder={openDealMonth}
          onSelectLines={openPaymentLines}
        />
      </Card>

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Payments by month
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">
            Received vs about to come (and overdue) from PO/PI checkpoints —
            email confirmations ground each received installment
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthChart.length ? monthChart : [{ label: "—", Received: 0, Upcoming: 0, Overdue: 0, lines: [] }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => k(Number(v))}
                  tick={{ fontSize: 10 }}
                  width={48}
                />
                <Tooltip formatter={(v: number) => usd(v)} />
                <Legend />
                <Bar
                  dataKey="Received"
                  stackId="a"
                  fill={EMERALD}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = monthChart[index];
                    if (row)
                      openPaymentLines(
                        `Payments · ${row.label} · received`,
                        row.lines.filter((l) => l.status === "received"),
                      );
                  }}
                />
                <Bar
                  dataKey="Upcoming"
                  stackId="a"
                  fill={SKY}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = monthChart[index];
                    if (row)
                      openPaymentLines(
                        `Payments · ${row.label} · upcoming`,
                        row.lines.filter(
                          (l) =>
                            l.status === "upcoming" || l.status === "due",
                        ),
                      );
                  }}
                />
                <Bar
                  dataKey="Overdue"
                  stackId="a"
                  fill={RED}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = monthChart[index];
                    if (row)
                      openPaymentLines(
                        `Payments · ${row.label} · overdue`,
                        row.lines.filter((l) => l.status === "overdue"),
                      );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Payments by order
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">
            Select an order to see month-wise received vs about to come for that
            deal
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={
                  orderChart.length
                    ? orderChart
                    : [
                        {
                          label: "—",
                          Received: 0,
                          Upcoming: 0,
                          Overdue: 0,
                          lines: [],
                          order: null as OrderPaymentBucket | null,
                        },
                      ]
                }
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => k(Number(v))}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={78}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  formatter={(v: number) => usd(v)}
                  labelFormatter={(_, payload) => {
                    const row = payload?.[0]?.payload as
                      | (typeof orderChart)[number]
                      | undefined;
                    if (!row) return "";
                    return `${row.label} · ${row.title || ""}`;
                  }}
                />
                <Legend />
                <Bar
                  dataKey="Received"
                  stackId="o"
                  fill={EMERALD}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = orderChart[index];
                    if (row?.order) openDealMonth(row.order);
                  }}
                />
                <Bar
                  dataKey="Upcoming"
                  stackId="o"
                  fill={SKY}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = orderChart[index];
                    if (row?.order) openDealMonth(row.order);
                  }}
                />
                <Bar
                  dataKey="Overdue"
                  stackId="o"
                  fill={RED}
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = orderChart[index];
                    if (row?.order) openDealMonth(row.order);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 max-h-28 space-y-1 overflow-auto">
            {pay.byOrder.map((o) => (
              <button
                key={o.dealId}
                type="button"
                onClick={() => openDealMonth(o)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-zinc-50"
              >
                <span className="min-w-0 truncate">
                  <span className="font-mono text-teal-800">{o.dealCode}</span>
                  <span className="text-zinc-500"> · {o.title}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-zinc-600">
                  {k(o.receivedUsd)}
                  <span className="text-zinc-400"> / </span>
                  {k(o.upcomingUsd + o.overdueUsd)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Working capital KPIs */}
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Working capital exposure
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-5">
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openDrill(
              "Funding still required",
              cash.stillRequiredDeals,
              "Remaining factory installments from payment terms",
            )
          }
        >
          <KpiTile
            size="lg"
            label="Still required"
            value={k(cash.cashStillRequiredUsd)}
            tone="warning"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openDrill(
              "Funding need · next 30 days",
              cash.rolling.find((r) => r.horizonDays === 30)?.deals || [],
            )
          }
        >
          <KpiTile
            size="lg"
            label="Need · 30 days"
            value={k(cash.rolling[0]?.requiredUsd || 0)}
            tone="warning"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openDrill(
              "Expected recoveries",
              cash.recoveries,
              "Open buyer installments from PO terms",
            )
          }
        >
          <KpiTile
            size="lg"
            label="Recoveries due"
            value={k(cash.expectedRecoveriesUsd)}
            tone="success"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openDrill(
              "Cash blocked by stage",
              cash.blockedByLocation.flatMap((b) => b.deals),
            )
          }
        >
          <KpiTile
            size="lg"
            label="Cash blocked"
            value={k(
              cash.blockedByLocation.reduce((a, b) => a + b.amountUsd, 0),
            )}
            tone="danger"
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() =>
            openDrill(
              "Vendor pay vs buyer recovery gap",
              cash.payGapDeals,
              `Average gap ${cash.avgPayGapDays} days`,
            )
          }
        >
          <KpiTile
            size="lg"
            label="Pay gap"
            value={`${cash.avgPayGapDays}d`}
            tone="info"
          />
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Funding need by horizon
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">
            Net capital still required in the next 30 / 60 / 90 / 120 days
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rollingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) => k(Number(v))}
                  tick={{ fontSize: 10 }}
                  width={48}
                />
                <Tooltip formatter={(v: number) => usd(v)} />
                <Bar
                  dataKey="Need"
                  fill={AMBER}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = rollingData[index];
                    if (row)
                      openDrill(`Funding need · ${row.label}`, row.deals);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Where cash is blocked
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">
            By exposure stage — vendor, production, transit, port, inventory,
            buyer
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={blockedData}
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => k(Number(v))}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={72}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip formatter={(v: number) => usd(v)} />
                <Bar
                  dataKey="Amount"
                  fill={RED}
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = blockedData[index];
                    if (row) openDrill(`Blocked at ${row.label}`, row.deals);
                  }}
                >
                  {blockedData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={[RED, AMBER, SKY, TEAL, ZINC, EMERALD][i % 6]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Deployed · still required · recoveries
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deployCompare}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => k(Number(v))}
                  tick={{ fontSize: 10 }}
                  width={48}
                />
                <Tooltip formatter={(v: number) => usd(v)} />
                <Bar
                  dataKey="Amount"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = deployCompare[index];
                    if (row) openDrill(row.label, row.deals);
                  }}
                >
                  <Cell fill={SKY} />
                  <Cell fill={AMBER} />
                  <Cell fill={EMERALD} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Agency commission settlement
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">
            After buyer remittance confirms — FX → invoice → chase → receipt
          </p>
          <div className="mb-2 grid grid-cols-3 gap-2">
            <KpiTile label="Awaiting" value={k(cash.commissionAwaitingUsd)} />
            <KpiTile
              label="Chasing"
              value={k(cash.commissionChasingUsd)}
              tone="warning"
            />
            <KpiTile
              label="Received"
              value={k(cash.commissionReceivedUsd)}
              tone="success"
            />
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={
                  commissionData.length
                    ? commissionData
                    : [{ label: "—", Amount: 0, deals: [] }]
                }
              >
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis
                  tickFormatter={(v) => k(Number(v))}
                  tick={{ fontSize: 10 }}
                  width={44}
                />
                <Tooltip formatter={(v: number) => usd(v)} />
                <Legend />
                <Bar
                  dataKey="Amount"
                  fill={TEAL}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(_d, index) => {
                    const row = commissionData[index];
                    if (row)
                      openDrill(`Commission · ${row.label}`, row.deals);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <DealPaymentMonthPanel
        focus={dealFocus}
        onClose={() => setDealFocus(null)}
        onOpenLines={(title, lines, subtitle) => {
          openPaymentLines(title, lines, subtitle);
        }}
      />
      <ChartDrillPanel drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
