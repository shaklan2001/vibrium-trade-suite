"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { useWorkspaceProcess } from "@/components/layout/workspace-process";
import {
  CommandCenterSkeleton,
  CommandHero,
  MorningBrief,
  OverdueAgeChart,
  PriorityList,
  ProcessCard,
  PulseStrip,
  StatTile,
} from "@/components/ops/command-center-home";
import { OffMailUpdates } from "@/components/ops/off-mail-updates";
import { useTradeStore } from "@/lib/trade/store";
import { useVisibleDeals } from "@/lib/trade/useVisibleDeals";
import { filterDealsByCommercialModel } from "@/lib/trade/commercialModel";
import { collectEarlyWarnings } from "@/lib/trade/earlyWarnings";
import { groupWarnings } from "@/lib/trade/groupWarnings";
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

/** One decimal under 100, none above; drops a trailing ".0". */
function trim(x: number) {
  const s = Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Compact money for tiles and copy: $9.3M / $412k, ₹7.7 Cr / ₹4.1 L. */
function k(n: number) {
  const cur = getDisplayCurrency();
  if (cur === "INR") {
    const inr = n * USD_TO_INR;
    if (Math.abs(inr) >= 1e7) return `₹${trim(inr / 1e7)} Cr`;
    if (Math.abs(inr) >= 1e5) return `₹${trim(inr / 1e5)} L`;
    if (Math.abs(inr) >= 1000) return `₹${trim(inr / 1000)}k`;
    return formatMoneyWithRate(n, "INR", USD_TO_INR);
  }
  if (Math.abs(n) >= 1e6) return `$${trim(n / 1e6)}M`;
  if (Math.abs(n) >= 1000) return `$${trim(n / 1000)}k`;
  return usd(n);
}

const PRIORITY_LIMIT = 6;

function greetingFor(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export default function CommandCenterHubPage() {
  const deals = useVisibleDeals();
  const allDeals = useTradeStore((s) => s.deals);
  const filter = useTradeStore((s) => s.commercialModelFilter);
  const agencyMode = filter === "agency_commission";
  const rates = useAgencyCommissionStore((s) => s.rates);
  const { setProcessId } = useWorkspaceProcess();
  const mailboxStatus = useTradeStore((s) => s.mailboxBookStatus);
  const mailboxError = useTradeStore((s) => s.mailboxBookError);
  const refreshing = useTradeStore((s) => s.mailboxBookRefreshing);
  const failedExtracts = useTradeStore((s) => s.mailboxFailedCount);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (mailboxStatus === "idle") void hydrateMailboxBook();
  }, [mailboxStatus]);

  // Client clock only (avoids a server/client mismatch on the greeting).
  useEffect(() => setNow(new Date()), []);

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
  const warnings = useMemo(
    () =>
      collectEarlyWarnings(filterDealsByCommercialModel(allDeals, filter), {
        failedExtracts,
      }),
    [allDeals, filter, failedExtracts],
  );
  const bookUsd = useMemo(
    () =>
      deals.reduce(
        (sum, d) =>
          d.stage === "closed" ? sum : sum + (d.paymentSchedule?.orderValueUsd || 0),
        0,
      ),
    [deals],
  );

  const bookLoading = mailboxStatus === "idle" || mailboxStatus === "loading";
  const critical = warnings.filter((w) => w.severity === "critical").length;
  const warningGroups = groupWarnings(warnings);
  const overdueLines = insights.overdueAging.reduce((n, b) => n + b.count, 0);
  const dateLabel = now
    ? now.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "";

  const refresh = () => {
    void hydrateMailboxBook({ force: true }).then((r) => {
      if (r.error) {
        toast.error(friendlyMailboxError(r.error));
        return;
      }
      toast.success(`Loaded ${r.count} mailbox deals`);
    });
  };

  if (bookLoading) return <CommandCenterSkeleton />;

  const summaryParts: string[] = [];
  summaryParts.push(
    `${plural(pulse.openDeals, "open deal")}${bookUsd ? ` worth ${k(bookUsd)}` : ""}.`,
  );
  if (overdueLines) {
    summaryParts.push(
      `${plural(overdueLines, "payment")} ${overdueLines === 1 ? "is" : "are"} overdue (${k(insights.overdueTotalUsd)}).`,
    );
  }
  if (critical) {
    summaryParts.push(`${plural(critical, "item")} need${critical === 1 ? "s" : ""} you today.`);
  } else if (!warnings.length) {
    summaryParts.push("Nothing urgent needs you today.");
  }

  const briefRows = [
    {
      area: "Payments",
      text: overdueLines
        ? `${plural(overdueLines, "buyer or factory payment")} overdue, ${k(insights.overdueTotalUsd)} in total. ${k(cash.expectedRecoveriesUsd)} is expected back from buyers.`
        : `No overdue payments. ${k(cash.expectedRecoveriesUsd)} is expected back from buyers.`,
      href: "/finance",
    },
    agencyMode
      ? {
          area: "Commission",
          text: `${k(insights.agency?.outstandingUsd || 0)} commission due, ${k(insights.agency?.overdueUsd || 0)} of it overdue. ${insights.agency?.collectionPct ?? 0}% collected so far.`,
          href: "/finance",
        }
      : {
          area: "Cash",
          text: `${k(cash.cashDeployedUsd)} paid out to factories, ${k(cash.cashStillRequiredUsd)} still to fund on open orders.`,
          href: "/finance",
        },
    {
      area: "Shipments",
      text: `${plural(ship.aboutToGo, "shipment")} about to sail, ${ship.inWaters} at sea and ${ship.aboutToCome} about to arrive.`,
      href: "/shipments",
    },
    {
      area: "Deals",
      text: `${plural(pulse.openDeals, "open deal")}, ${pulse.atRiskCount} at risk. Deals sit ${pulse.avgStageAgeDays} days in a stage on average.`,
      href: "/deals",
    },
    {
      area: "Mailbox",
      text: `${insights.coveragePct}% of deals have payment terms read from email.${failedExtracts ? ` ${plural(failedExtracts, "email thread")} could not be read.` : ""}`,
      href: "/mailbox",
    },
  ];

  return (
    <div className="cc-page">
      <CommandHero
        dateLabel={dateLabel}
        greeting={`${greetingFor(now?.getHours() ?? 9)}, Savvy Net.`}
        summary={summaryParts.join(" ")}
        onRefresh={refresh}
        refreshing={refreshing}
        chips={[
          { label: plural(pulse.openDeals, "open deal"), href: "/deals" },
          { label: `${plural(warnings.length, "warning")}`, href: "#cc-priority" },
          { label: `${ship.aboutToGo} about to sail`, href: "/shipments" },
          { label: `${ship.inWaters} at sea`, href: "/shipments" },
        ]}
      />

      <div className="cc-tiles">
        <StatTile
          label="Open deals"
          value={pulse.openDeals.toLocaleString()}
          caption={bookUsd ? `${k(bookUsd)} book` : `${pulse.closedDeals} closed`}
          href="/deals"
        />
        {agencyMode ? (
          <>
            <StatTile
              label="Commission due"
              value={k(insights.agency?.outstandingUsd || 0)}
              caption={`${insights.agency?.collectionPct ?? 0}% collected`}
              tone="info"
              href="/finance"
            />
            <StatTile
              label="Commission overdue"
              value={k(insights.agency?.overdueUsd || 0)}
              caption="past due date"
              tone={(insights.agency?.overdueUsd || 0) > 0 ? "bad" : "good"}
              href="/finance"
            />
          </>
        ) : (
          <>
            <StatTile
              label="Paid to factories"
              value={k(cash.cashDeployedUsd)}
              caption={plural(cash.deployedDeals.length, "deal")}
              tone="info"
              href="/finance"
            />
            <StatTile
              label="Still to fund"
              value={k(cash.cashStillRequiredUsd)}
              caption={plural(cash.stillRequiredDeals.length, "open order")}
              tone="warn"
              href="/finance"
            />
          </>
        )}
        <StatTile
          label="Overdue payments"
          value={k(insights.overdueTotalUsd)}
          caption={plural(overdueLines, "line")}
          tone={overdueLines ? "warn" : "good"}
          href="/finance"
        />
        <StatTile
          label="Needs attention"
          value={warnings.length}
          caption={critical ? `${critical} critical` : "none critical"}
          tone={critical ? "bad" : "good"}
          href="#cc-priority"
        />
      </div>

      <PulseStrip
        items={[
          {
            label: "Expected from buyers",
            value: k(cash.expectedRecoveriesUsd),
            link: "Recoveries",
            href: "/finance",
          },
          {
            label: "About to sail",
            value: ship.aboutToGo,
            link: "Shipments",
            href: "/shipments",
          },
          {
            label: "Deals at risk",
            value: pulse.atRiskCount,
            link: "Deal board",
            href: "/deals",
          },
          {
            label: "Terms read from email",
            value: `${insights.coveragePct}%`,
            link: "Mailbox book",
            href: "/mailbox",
          },
        ]}
      />

      <div className="cc-split">
        <div className="cc-stack">
          <MorningBrief dateLabel={dateLabel} rows={briefRows} />
          <OffMailUpdates />
          <OverdueAgeChart
            buckets={insights.overdueAging}
            total={k(insights.overdueTotalUsd)}
            money={k}
          />
        </div>
        <div>
          <PriorityList
            groups={warningGroups}
            limit={PRIORITY_LIMIT}
            total={warnings.length}
            critical={critical}
            loading={false}
            error={mailboxStatus === "error" && mailboxError ? friendlyMailboxError(mailboxError) : null}
          />
          {warningGroups.length > PRIORITY_LIMIT ? (
            <Link href="/operations" className="cc-inline-link cc-more">
              See all {warningGroups.length} issues
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="cc-processes">
        <ProcessCard
          title="Finance"
          href="/finance"
          onOpen={() => setProcessId("finance", { navigate: false })}
          description={
            agencyMode
              ? "Commission due after shipment: what's collected, what's overdue, INR or USD."
              : "Payment checkpoints, cash out to factories and money coming back from buyers."
          }
          stats={[
            { label: "Overdue", value: k(insights.overdueTotalUsd), tone: insights.overdueTotalUsd ? "bad" : undefined },
            { label: "INR deals", value: insights.inrSettlementCount },
            agencyMode
              ? { label: "Not yet due", value: k(insights.agency?.notYetDueUsd || 0), tone: "warn" }
              : { label: "Recoveries", value: k(cash.expectedRecoveriesUsd), tone: "warn" },
          ]}
        />
        <ProcessCard
          title="Operations"
          href="/operations"
          onOpen={() => setProcessId("ops", { navigate: false })}
          description="Sourcing work: risks, the work queue, deals by stage and where each shipment is."
          stats={[
            { label: "Warnings", value: warnings.length, tone: critical ? "bad" : undefined },
            { label: "About to sail", value: ship.aboutToGo, tone: "warn" },
            { label: "At sea", value: ship.inWaters, tone: "info" },
          ]}
        />
      </div>
    </div>
  );
}
