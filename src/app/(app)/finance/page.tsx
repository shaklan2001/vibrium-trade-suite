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
import { Badge, Button, Card } from "@/components/ui/primitives";
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
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import {
  hydrateMailboxBook,
  friendlyMailboxError,
} from "@/lib/trade/mailboxHydrate";
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
import { useAgencyCommissionStore } from "@/lib/trade/agencyCommissionStore";
import { seedDefaultRatesForDeals } from "@/lib/trade/agencyCommission";
import {
  formatMoneyWithRate,
  getDisplayCurrency,
  USD_TO_INR,
} from "@/lib/trade/currencyDisplay";
import {
  dealFxAsOfDate,
  extractFxFromDeal,
  type DealFxRate,
} from "@/lib/trade/fxFromEvidence";
import { buildAgencyCommissionBook } from "@/lib/trade/commissionSettlement";
import { resolveCommissionPaymentCurrency } from "@/lib/trade/commissionCurrency";
import { buildBookInsights } from "@/lib/trade/bookInsights";
import { BookInsightsStrip } from "@/components/ops/book-insights-strip";

const TEAL = "#0f766e";
const AMBER = "#d97706";
const RED = "#dc2626";
const SKY = "#0284c7";
const EMERALD = "#059669";
const ZINC = "#3f3f46";

/** Format commission amounts. INR filter uses deal/book FX — not a book-wide convert of all deals. */
function k(n: number, rate = USD_TO_INR) {
  const currency = getDisplayCurrency();
  if (currency === "INR") {
    const inr = n * (rate > 0 ? rate : USD_TO_INR);
    if (Math.abs(inr) >= 100_000) return `₹${(inr / 100_000).toFixed(1)}L`;
    if (Math.abs(inr) >= 1000) return `₹${(inr / 1000).toFixed(1)}k`;
    return formatMoneyWithRate(n, "INR", rate);
  }
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return usd(n);
}

export default function FinanceDashboardPage() {
  const deals = useVisibleDeals();
  const filter = useTradeStore((s) => s.commercialModelFilter);
  const rates = useAgencyCommissionStore((s) => s.rates);
  const upsertRate = useAgencyCommissionStore((s) => s.upsertRate);
  const agencyMode = filter === "agency_commission";
  const mailboxStatus = useTradeStore((s) => s.mailboxBookStatus);
  const [drill, setDrill] = useState<DrillPayload | null>(null);
  const [dealFocus, setDealFocus] = useState<DealMonthFocus | null>(null);
  const [fxByDeal, setFxByDeal] = useState<Record<string, DealFxRate>>({});
  const [marketFxByDeal, setMarketFxByDeal] = useState<
    Record<string, DealFxRate>
  >({});

  useEffect(() => {
    if (mailboxStatus === "idle") void hydrateMailboxBook();
  }, [mailboxStatus]);
  const commissionCurrencyFilter = useTradeStore((s) => s.displayCurrency);
  const bookLoading =
    mailboxStatus === "idle" || mailboxStatus === "loading";
  const inrCommissionView = commissionCurrencyFilter === "INR";

  // Persist default 5% for any Agency buyer missing a saved rate.
  useEffect(() => {
    if (!agencyMode || !deals.length) return;
    seedDefaultRatesForDeals(deals, rates, upsertRate);
  }, [agencyMode, deals, rates, upsertRate]);

  const cash = useMemo(
    () => buildCashExposureReport(deals, { agencyMode, rates }),
    [deals, agencyMode, rates],
  );
  const pay = useMemo(
    () => buildPaymentScheduleReport(deals, { agencyMode, rates }),
    [deals, agencyMode, rates],
  );
  const agencyBook = useMemo(
    () => (agencyMode ? buildAgencyCommissionBook(deals, rates) : null),
    [agencyMode, deals, rates],
  );
  const insights = useMemo(
    () => buildBookInsights(deals, rates),
    [deals, rates],
  );

  // Agreed FX from email + market FX for comparison (INR commission deals).
  useEffect(() => {
    if (!deals.length) return;
    let cancelled = false;
    async function resolve() {
      const agreed: Record<string, DealFxRate> = {};
      const market: Record<string, DealFxRate> = {};
      const needMarket: { id: string; date: string }[] = [];

      for (const d of deals) {
        const isInr =
          resolveCommissionPaymentCurrency(d) === "INR" || inrCommissionView;
        if (!isInr && !agencyMode) continue;

        const fromMail = extractFxFromDeal(d);
        if (fromMail) agreed[d.id] = fromMail;
        needMarket.push({ id: d.id, date: dealFxAsOfDate(d) });
      }

      await Promise.all(
        needMarket.slice(0, 60).map(async ({ id, date }) => {
          try {
            const res = await fetch(
              `/api/fx/usd-inr?date=${encodeURIComponent(date)}`,
              { cache: "force-cache" },
            );
            const body = (await res.json()) as {
              rate?: number;
              date?: string;
              warning?: string;
            };
            if (res.ok && body.rate) {
              market[id] = {
                rate: body.rate,
                source: "internet",
                asOfDate: body.date || date,
                excerpt: body.warning,
              };
              if (!agreed[id]) {
                agreed[id] = {
                  rate: body.rate,
                  source: "internet",
                  asOfDate: body.date || date,
                  excerpt: body.warning,
                };
              }
            } else if (!agreed[id]) {
              agreed[id] = {
                rate: USD_TO_INR,
                source: "default",
                asOfDate: date,
              };
            }
          } catch {
            if (!agreed[id]) {
              agreed[id] = {
                rate: USD_TO_INR,
                source: "default",
                asOfDate: date,
              };
            }
          }
        }),
      );
      if (!cancelled) {
        setFxByDeal(agreed);
        setMarketFxByDeal(market);
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [agencyMode, deals, inrCommissionView]);

  const bookRate = useMemo(() => {
    const emailRates = Object.values(fxByDeal)
      .filter((f) => f.source === "email")
      .map((f) => f.rate);
    const vals = emailRates.length
      ? emailRates
      : Object.values(fxByDeal).map((f) => f.rate);
    if (!vals.length) return USD_TO_INR;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [fxByDeal]);

  const fxEmailCount = useMemo(
    () => Object.values(fxByDeal).filter((f) => f.source === "email").length,
    [fxByDeal],
  );

  const fxCompareRows = useMemo(() => {
    return deals
      .filter((d) => resolveCommissionPaymentCurrency(d) === "INR")
      .map((d) => {
        const agreed = fxByDeal[d.id];
        const market = marketFxByDeal[d.id];
        const agreedRate = agreed?.source === "email" ? agreed.rate : undefined;
        const marketRate = market?.rate;
        const deltaPct =
          agreedRate && marketRate
            ? Math.round(((agreedRate - marketRate) / marketRate) * 1000) / 10
            : undefined;
        return {
          dealId: d.id,
          dealCode: d.code,
          title: d.title,
          agreedRate,
          marketRate,
          deltaPct,
          excerpt: agreed?.excerpt,
          costly:
            deltaPct != null ? deltaPct > 0.5 : false /* agreed > market */,
          cheaper: deltaPct != null ? deltaPct < -0.5 : false,
        };
      })
      .filter((r) => r.agreedRate != null || r.marketRate != null)
      .slice(0, 24);
  }, [deals, fxByDeal, marketFxByDeal]);

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

  // Agency CXO book: commission becomes due when shipment is done (last lifecycle step).
  const agencyCollectedUsd = agencyBook?.collectedUsd || 0;
  const agencyOutstandingUsd = agencyBook?.outstandingUsd || 0;
  const agencyOverdueUsd = agencyBook?.overdueUsd || 0;
  const agencyBookUsd = agencyBook?.bookUsd || 0;
  const agencyNotYetDueUsd = agencyBook?.notYetDueUsd || 0;
  const agencyCollectionPct = agencyBook?.collectionPct || 0;

  const agencyStatusChart = [
    {
      label: "Collected",
      Amount: agencyCollectedUsd,
      deals: agencyBook?.collectedLines || [],
    },
    {
      label: "Due",
      Amount: Math.max(0, agencyOutstandingUsd - agencyOverdueUsd),
      deals: (agencyBook?.outstandingLines || []).filter(
        (l) => l.lifecycle === "due",
      ),
    },
    {
      label: "Overdue",
      Amount: agencyOverdueUsd,
      deals: agencyBook?.overdueLines || [],
    },
  ];

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

  return (
    <div>
      <PageHeader
        title="Finance"
        description={
          agencyMode
            ? "Agency book — figures are commission (buyer %), not trade size"
            : undefined
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/home">
              <Button variant="ghost">Command Center</Button>
            </Link>
            {agencyMode ? (
              <Link href="/partners/commissions">
                <Button variant="secondary">Commission rates</Button>
              </Link>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                void hydrateMailboxBook().then((r) => {
                  if (r.error) {
                    toast.error(friendlyMailboxError(r.error));
                    return;
                  }
                  toast.success(`Loaded ${r.count} mailbox deals`);
                });
              }}
            >
              Refresh data
            </Button>
          </div>
        }
      />

      {bookLoading ? (
        <div className="mb-4">
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white px-6 py-16 text-center shadow-sm">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-teal-700" />
            <p className="text-sm font-medium text-zinc-700">
              Loading finance book…
            </p>
          </div>
        </div>
      ) : null}

      <div className={bookLoading ? "pointer-events-none opacity-40" : undefined}>

      <BookInsightsStrip insights={insights} bookRate={bookRate} />

      {agencyMode ? (
        <div className="mb-4 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Agency commission book
          </div>
          <p className="text-[11px] text-zinc-500">
            Commission is the last lifecycle step — it becomes{" "}
            <span className="font-medium text-zinc-700">due once shipment is done</span>
            . Use Comm. currency to filter deals by how commission is paid (USD vs
            INR), not to convert the whole book.
          </p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <button
              type="button"
              className="text-left"
              onClick={() =>
                openDrill(
                  "Commission book (shipped)",
                  agencyBook?.lines.filter((l) => l.lifecycle !== "not_due") ||
                    [],
                  "Shipped deals × buyer commission %",
                )
              }
            >
              <KpiTile
                size="lg"
                label="Commission book"
                value={k(agencyBookUsd, bookRate)}
                tone="success"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() =>
                openDrill(
                  "Commission collected",
                  agencyBook?.collectedLines || [],
                  "Commission marked received / complete",
                )
              }
            >
              <KpiTile
                size="lg"
                label="Collected"
                value={k(agencyCollectedUsd, bookRate)}
                tone="info"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() =>
                openDrill(
                  "Commission outstanding",
                  agencyBook?.outstandingLines || [],
                  "Shipped · commission not yet received",
                )
              }
            >
              <KpiTile
                size="lg"
                label="Outstanding"
                value={k(agencyOutstandingUsd, bookRate)}
                tone="warning"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() =>
                openDrill(
                  "Commission overdue",
                  agencyBook?.overdueLines || [],
                  "Shipped · unpaid beyond typical post-shipment window",
                )
              }
            >
              <KpiTile
                size="lg"
                label="Overdue"
                value={k(agencyOverdueUsd, bookRate)}
                tone="danger"
              />
            </button>
            <KpiTile
              size="lg"
              label="Collection %"
              value={`${agencyCollectionPct}%`}
              tone={agencyCollectionPct >= 50 ? "success" : "neutral"}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
            <span>
              Not yet due (pre-shipment): {k(agencyNotYetDueUsd, bookRate)}
            </span>
            <span>
              Underlying trade size:{" "}
              {k(
                agencyBook?.commercialFootnoteUsd ||
                  cash.agencyCommercialFootnoteUsd ||
                  0,
                bookRate,
              )}
            </span>
            {fxEmailCount > 0 ? (
              <Badge tone="success">
                Agreed FX from email · {fxEmailCount}
              </Badge>
            ) : null}
            {commissionCurrencyFilter !== "all" ? (
              <Badge tone="info">
                Filtered · commission in {commissionCurrencyFilter}
              </Badge>
            ) : null}
            <Link
              href="/partners/commissions"
              className="text-teal-700 underline"
            >
              Edit buyer commission %
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Trader / all — payment terms checkpoints */}
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Payment terms · checkpoints
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">
            Installments inferred from PO/PI when present; outstanding payment
            threads use a single invoice line. Comm. currency filters by
            settlement currency (not a book-wide FX convert).
          </p>
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
                value={k(pay.buyerReceivedUsd, bookRate)}
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
                value={k(pay.buyerUpcomingUsd, bookRate)}
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
                value={k(pay.buyerOverdueUsd, bookRate)}
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
                value={k(pay.factoryReceivedUsd, bookRate)}
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
                value={k(
                  pay.factoryUpcomingUsd + pay.factoryOverdueUsd,
                  bookRate,
                )}
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
                value={k(cash.cashDeployedUsd, bookRate)}
                tone="info"
              />
            </button>
          </div>
        </>
      )}

      <Card className="mb-4 p-4">
        <h2 className="mb-1 text-base font-semibold tracking-tight text-[var(--ink)]">
          {agencyMode
            ? "Order-wise commission flow"
            : "Order-wise payment flow"}
        </h2>
        <OrderPaymentFlowGrid
          orders={pay.byOrder}
          onSelectOrder={openDealMonth}
          onSelectLines={openPaymentLines}
        />
      </Card>

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Card className="p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {agencyMode ? "Commission by month" : "Payments by month"}
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">
            {agencyMode
              ? "Collected vs upcoming vs overdue commission share by due month"
              : "Received vs about to come (and overdue) from PO/PI checkpoints"}
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
            {agencyMode ? "Top deals by commission" : "Payments by order"}
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">
            {agencyMode
              ? "Collected vs still open commission share per order"
              : "Select an order to see month-wise received vs about to come for that deal"}
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

      {!agencyMode ? (
        <>
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
                value={k(cash.cashStillRequiredUsd, bookRate)}
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
                value={k(cash.rolling[0]?.requiredUsd || 0, bookRate)}
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
                value={k(cash.expectedRecoveriesUsd, bookRate)}
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
                  bookRate,
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
        </>
      ) : null}

      {agencyMode ? (
        <div className="mb-4 space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Collected · due · overdue
              </div>
              <p className="mb-2 text-[11px] text-zinc-500">
                Post-shipment commission only — same definition as the KPI strip
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agencyStatusChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis
                      tickFormatter={(v) => k(Number(v), bookRate)}
                      tick={{ fontSize: 10 }}
                      width={48}
                    />
                    <Tooltip
                      formatter={(v: number) =>
                        formatMoneyWithRate(
                          v,
                          getDisplayCurrency() === "INR" ? "INR" : "USD",
                          bookRate,
                        )
                      }
                    />
                    <Bar
                      dataKey="Amount"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(_d, index) => {
                        const row = agencyStatusChart[index];
                        if (row)
                          openDrill(`Commission · ${row.label}`, row.deals);
                      }}
                    >
                      <Cell fill={EMERALD} />
                      <Cell fill={SKY} />
                      <Cell fill={RED} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Book health
              </div>
              <ul className="space-y-3 px-1 py-2 text-sm text-zinc-700">
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-zinc-500">
                    Commission book (shipped)
                  </span>
                  <span className="font-semibold tabular-nums">
                    {k(agencyBookUsd, bookRate)}
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-zinc-500">Collected</span>
                  <span className="font-semibold tabular-nums text-emerald-700">
                    {k(agencyCollectedUsd, bookRate)} · {agencyCollectionPct}%
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-zinc-500">Still to collect</span>
                  <span className="font-semibold tabular-nums text-amber-700">
                    {k(agencyOutstandingUsd, bookRate)}
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-zinc-500">Overdue — chase now</span>
                  <span className="font-semibold tabular-nums text-red-700">
                    {k(agencyOverdueUsd, bookRate)}
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3">
                  <span className="text-zinc-500">Not yet due</span>
                  <span className="font-semibold tabular-nums text-zinc-500">
                    {k(agencyNotYetDueUsd, bookRate)}
                  </span>
                </li>
              </ul>
            </Card>
          </div>

          {fxCompareRows.length > 0 ? (
            <Card className="p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Agreed FX vs market (INR commission deals)
              </div>
              <p className="mb-3 text-[11px] text-zinc-500">
                Agreed USD→INR from email vs internet market rate on the deal
                date. Positive delta = agreed rate higher than market (costlier
                INR per USD).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wider text-zinc-500">
                      <th className="py-2 pr-3 font-semibold">Deal</th>
                      <th className="py-2 pr-3 font-semibold">Agreed</th>
                      <th className="py-2 pr-3 font-semibold">Market</th>
                      <th className="py-2 pr-3 font-semibold">Δ vs market</th>
                      <th className="py-2 font-semibold">Mail excerpt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fxCompareRows.map((row) => (
                      <tr
                        key={row.dealId}
                        className="border-b border-zinc-100 align-top"
                      >
                        <td className="py-2 pr-3">
                          <Link
                            href={`/deals/${row.dealId}`}
                            className="font-medium text-teal-800 hover:underline"
                          >
                            {row.dealCode}
                          </Link>
                          <div className="text-[11px] text-zinc-500 line-clamp-1">
                            {row.title}
                          </div>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.agreedRate != null
                            ? row.agreedRate.toFixed(2)
                            : "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-zinc-600">
                          {row.marketRate != null
                            ? row.marketRate.toFixed(2)
                            : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          {row.deltaPct == null ? (
                            <span className="text-zinc-400">—</span>
                          ) : (
                            <span
                              className={
                                row.costly
                                  ? "font-semibold text-red-700"
                                  : row.cheaper
                                    ? "font-semibold text-emerald-700"
                                    : "tabular-nums text-zinc-700"
                              }
                            >
                              {row.deltaPct > 0 ? "+" : ""}
                              {row.deltaPct}%
                              {row.costly
                                ? " · costly"
                                : row.cheaper
                                  ? " · better"
                                  : ""}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-[11px] text-zinc-500 line-clamp-2 max-w-xs">
                          {row.excerpt || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </div>
      ) : (
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
              After buyer remittance confirms — FX → invoice · chase · receipt
            </p>
            <div className="mb-2 grid grid-cols-3 gap-2">
              <KpiTile
                label="Awaiting"
                value={k(cash.commissionAwaitingUsd, bookRate)}
              />
              <KpiTile
                label="Chasing"
                value={k(cash.commissionChasingUsd, bookRate)}
                tone="warning"
              />
              <KpiTile
                label="Received"
                value={k(cash.commissionReceivedUsd, bookRate)}
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
      )}

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
