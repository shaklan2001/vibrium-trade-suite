"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Landmark, ListTodo, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { useWorkspaceProcess } from "@/components/layout/workspace-process";
import { Button, Card } from "@/components/ui/primitives";
import { LoadingBlock, KpiSkeletonRow } from "@/components/ui/loading-block";
import { KpiTile } from "@/components/ops/command-center-ui";
import { BookInsightsStrip } from "@/components/ops/book-insights-strip";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import { companyPulse } from "@/lib/trade/opsIntelligence";
import { buildCashExposureReport } from "@/lib/trade/cashExposure";
import {
  hydrateMailboxBook,
  friendlyMailboxError,
} from "@/lib/trade/mailboxHydrate";
import {
  buildShipmentPulseFromDeals,
  usd,
} from "@/lib/trade/commandCenterMetrics";
import { useAgencyCommissionStore } from "@/lib/trade/agencyCommissionStore";
import { buildBookInsights } from "@/lib/trade/bookInsights";
import {
  formatMoneyWithRate,
  getDisplayCurrency,
  USD_TO_INR,
} from "@/lib/trade/currencyDisplay";

function k(n: number) {
  const cur = getDisplayCurrency();
  if (cur === "INR") {
    const inr = n * USD_TO_INR;
    if (Math.abs(inr) >= 100_000) return `₹${(inr / 100_000).toFixed(1)}L`;
    if (Math.abs(inr) >= 1000) return `₹${(inr / 1000).toFixed(1)}k`;
    return formatMoneyWithRate(n, "INR", USD_TO_INR);
  }
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return usd(n);
}

export default function CommandCenterHubPage() {
  const deals = useVisibleDeals();
  const filter = useTradeStore((s) => s.commercialModelFilter);
  const agencyMode = filter === "agency_commission";
  const rates = useAgencyCommissionStore((s) => s.rates);
  const opsIntel = useTradeStore((s) => s.opsIntel);
  const { setProcessId } = useWorkspaceProcess();
  const mailboxStatus = useTradeStore((s) => s.mailboxBookStatus);

  useEffect(() => {
    if (mailboxStatus === "idle") void hydrateMailboxBook();
  }, [mailboxStatus]);

  useTradeStore((s) => s.displayCurrency);

  const pulse = useMemo(() => companyPulse(deals), [deals]);
  const cash = useMemo(
    () => buildCashExposureReport(deals, { agencyMode, rates }),
    [deals, agencyMode, rates],
  );
  const ship = useMemo(() => buildShipmentPulseFromDeals(deals), [deals]);
  const insights = useMemo(
    () => buildBookInsights(deals, rates),
    [deals, rates],
  );
  const alerts = (opsIntel.attention || []).filter(
    (a) => a.severity === "critical" || a.severity === "warning",
  ).length;

  const bookLoading =
    mailboxStatus === "idle" || mailboxStatus === "loading";

  return (
    <div>
      <PageHeader
        title="Command Center"
        description="Mailbox book visibility — Finance and Ops share one truth. Switch process in the header to focus."
        actions={
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
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh data
          </Button>
        }
      />

      {bookLoading ? (
        <>
          <LoadingBlock label="Loading live book…" className="mb-4" />
          <KpiSkeletonRow count={4} />
        </>
      ) : (
        <div className="animate-in fade-in duration-300">
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KpiTile label="Open deals" value={pulse.openDeals} size="lg" />
            {agencyMode ? (
              <>
                <KpiTile
                  label="Commission due"
                  value={k(insights.agency?.outstandingUsd || 0)}
                  tone="warning"
                  size="lg"
                />
                <KpiTile
                  label="Commission overdue"
                  value={k(insights.agency?.overdueUsd || 0)}
                  tone="danger"
                  size="lg"
                />
                <KpiTile
                  label="Collection %"
                  value={`${insights.agency?.collectionPct ?? 0}%`}
                  tone={
                    (insights.agency?.collectionPct || 0) >= 50
                      ? "success"
                      : "neutral"
                  }
                  size="lg"
                />
              </>
            ) : (
              <>
                <KpiTile
                  label="Cash deployed"
                  value={k(cash.cashDeployedUsd)}
                  tone="info"
                  size="lg"
                />
                <KpiTile
                  label="Funding still due"
                  value={k(cash.cashStillRequiredUsd)}
                  tone="warning"
                  size="lg"
                />
                <KpiTile
                  label="Ops alerts"
                  value={alerts}
                  tone={alerts ? "danger" : "success"}
                  size="lg"
                />
              </>
            )}
          </div>

          <BookInsightsStrip insights={insights} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Link
              href="/finance"
              className="group block"
              onClick={() => setProcessId("finance", { navigate: false })}
            >
              <Card className="h-full p-5 transition hover:border-teal-300 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-teal-50 p-2.5 text-teal-800">
                    <Landmark className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-zinc-900">
                        Finance process
                      </h2>
                      <ArrowRight className="h-4 w-4 text-teal-700 opacity-0 transition group-hover:opacity-100" />
                    </div>
                    <p className="mt-1 text-sm text-zinc-600">
                      {agencyMode
                        ? "Agency commission book — due after shipment, collected vs overdue, INR/USD settlement filter."
                        : "Payment checkpoints, cash exposure, recoveries, and order-wise remittance flow."}
                    </p>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <KpiTile
                        label="Overdue"
                        value={k(insights.overdueTotalUsd)}
                        tone="danger"
                      />
                      <KpiTile
                        label="INR deals"
                        value={insights.inrSettlementCount}
                      />
                      <KpiTile
                        label={agencyMode ? "Not yet due" : "Recoveries"}
                        value={
                          agencyMode
                            ? k(insights.agency?.notYetDueUsd || 0)
                            : k(cash.expectedRecoveriesUsd)
                        }
                        tone="warning"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </Link>

            <Link
              href="/operations"
              className="group block"
              onClick={() => setProcessId("ops", { navigate: false })}
            >
              <Card className="h-full p-5 transition hover:border-teal-300 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-zinc-100 p-2.5 text-zinc-800">
                    <ListTodo className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-zinc-900">
                        Ops process
                      </h2>
                      <ArrowRight className="h-4 w-4 text-teal-700 opacity-0 transition group-hover:opacity-100" />
                    </div>
                    <p className="mt-1 text-sm text-zinc-600">
                      Sourcing execution — risk, work queue, pipeline by stage,
                      and shipment posture across the mailbox book.
                    </p>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <KpiTile
                        label="Alerts"
                        value={alerts}
                        tone={alerts ? "danger" : "neutral"}
                      />
                      <KpiTile
                        label="About to sail"
                        value={ship.aboutToGo}
                        tone="warning"
                      />
                      <KpiTile
                        label="In transit"
                        value={ship.inWaters}
                        tone="info"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          </div>

          <p className="mt-6 text-xs text-zinc-500">
            Visibility layer over the Outlook mailbox ingest. Open Mailbox book
            for ingest progress.
          </p>
        </div>
      )}
    </div>
  );
}
