"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Landmark, ListTodo, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { useWorkspaceProcess } from "@/components/layout/workspace-process";
import { Button, Card } from "@/components/ui/primitives";
import { KpiTile } from "@/components/ops/command-center-ui";
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

function k(n: number) {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return usd(n);
}

export default function CommandCenterHubPage() {
  const deals = useVisibleDeals();
  const opsIntel = useTradeStore((s) => s.opsIntel);
  const { setProcessId } = useWorkspaceProcess();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void hydrateMailboxBook();
  }, [hydrated]);

  // Re-render money when currency toggles
  useTradeStore((s) => s.displayCurrency);

  const pulse = useMemo(() => companyPulse(deals), [deals]);
  const cash = useMemo(() => buildCashExposureReport(deals), [deals]);
  const ship = useMemo(() => buildShipmentPulseFromDeals(deals), [deals]);
  const alerts = (opsIntel.attention || []).filter(
    (a) => a.severity === "critical" || a.severity === "warning",
  ).length;

  if (!hydrated) {
    return <PageHeader title="Command Center" description="Loading…" />;
  }

  return (
    <div>
      <PageHeader
        title="Command Center"
        description="Company pulse from the Outlook mailbox ingest — switch process in the header to focus the workspace."
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

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile label="Open deals" value={pulse.openDeals} size="lg" />
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
      </div>

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
                  Live cash exposure and forecast — capital deployed, funding
                  still required, recovery outlook, blocked cash, and
                  commission settlement status.
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <KpiTile
                    label="Recoveries due"
                    value={k(cash.expectedRecoveriesUsd)}
                  />
                  <KpiTile
                    label="Avg pay gap"
                    value={`${cash.avgPayGapDays}d`}
                  />
                  <KpiTile
                    label="Commission open"
                    value={k(cash.commissionChasingUsd)}
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
                  Sourcing execution — daily brief, risk radar, work queue,
                  pipeline by stage, and shipment posture across the book.
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
        Command Center reads the shared mailbox book. Open Mailbox book for
        ingest progress and LLM cost.
      </p>
    </div>
  );
}
