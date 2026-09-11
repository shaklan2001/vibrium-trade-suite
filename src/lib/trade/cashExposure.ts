/**
 * Finance cash exposure model for the open book of business.
 *
 * Output views: cash deployed, funding still required, rolling need
 * (30/60/90/120), expected recoveries, blocked cash by stage, vendor↔buyer
 * pay gap, plus agency commission settlement.
 */
import type {
  Deal,
  DealCashExposure,
  ProvenanceCite,
} from "@/types/trade";
import type { CashBlockLocation } from "@/types/trade";
import { ensureDealEconomics } from "./commandCenterMetrics";
import { scheduleCashHints } from "./paymentSchedule";

export type { CashBlockLocation };

export interface CashDrillDeal {
  dealId: string;
  dealCode: string;
  title: string;
  amountUsd: number;
  meta?: string;
  blockedAt?: CashBlockLocation;
  sources: ProvenanceCite[];
  href: string;
}

export interface RollingBucket {
  horizonDays: 30 | 60 | 90 | 120;
  requiredUsd: number;
  deals: CashDrillDeal[];
}

export interface CashExposureReport {
  asOf: string;
  /** 1 */ cashDeployedUsd: number;
  /** 2 */ cashStillRequiredUsd: number;
  /** 3 */ rolling: RollingBucket[];
  /** 4 */ expectedRecoveriesUsd: number;
  recoveries: CashDrillDeal[];
  /** 5 */ blockedByLocation: {
    location: CashBlockLocation;
    amountUsd: number;
    deals: CashDrillDeal[];
  }[];
  /** 6 */ avgPayGapDays: number;
  payGapDeals: CashDrillDeal[];
  /** Agency commission settlement */
  commissionAwaitingUsd: number;
  commissionReceivedUsd: number;
  commissionChasingUsd: number;
  commissionLines: CashDrillDeal[];
  deployedDeals: CashDrillDeal[];
  stillRequiredDeals: CashDrillDeal[];
  summary: string;
}

function cites(deal: Deal): ProvenanceCite[] {
  const econ = ensureDealEconomics(deal);
  if (deal.cashExposure?.sources?.length) return deal.cashExposure.sources;
  if (econ.sources?.length) return econ.sources;
  return (deal.sources || [])
    .filter((s) =>
      ["payment", "commission", "pi", "po", "booking"].includes(s.kind),
    )
    .slice(0, 3)
    .map((s) => ({
      dealId: deal.id,
      dealCode: deal.code,
      sourceId: s.id,
      kind: s.kind,
      subject: s.subject,
      from: s.from,
      excerpt: (s.extractedSummary || s.body || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180),
    }));
}

function blockFromStage(deal: Deal): CashBlockLocation {
  if (deal.cashExposure?.blockedAt) return deal.cashExposure.blockedAt;
  switch (deal.stage) {
    case "pi_po":
    case "quoting":
    case "selection":
    case "requirement":
    case "outreach":
      return "vendor";
    case "artwork":
    case "samples":
    case "packaging":
    case "production":
      return "production";
    case "booking":
      return "transit";
    case "docs_payment":
      return deal.payment?.status === "paid" ? "none" : "buyer";
    case "closed":
      return "none";
    default:
      return "none";
  }
}

/** Derive cash exposure per deal (seeded cashExposure + payment-term schedule). */
export function ensureCashExposure(deal: Deal): DealCashExposure {
  const hints = scheduleCashHints(deal);
  if (deal.cashExposure) {
    if (!hints) return deal.cashExposure;
    return {
      ...deal.cashExposure,
      cashDeployedUsd: hints.cashDeployedUsd,
      cashStillRequiredUsd: hints.cashStillRequiredUsd,
      receivableExpectedUsd: hints.receivableExpectedUsd,
      receivableStatus: hints.receivableStatus,
    };
  }
  const e = ensureDealEconomics(deal);
  const value = e.commercialValueUsd || 0;
  const stage = deal.stage;
  let deployed = 0;
  let still = 0;
  let receivable = 0;
  let recvStatus: DealCashExposure["receivableStatus"] = "none";

  if (["pi_po", "production", "packaging", "artwork", "samples"].includes(stage)) {
    deployed = Math.round(value * 0.3);
    still = Math.round(value * 0.7);
  }
  if (stage === "booking") {
    deployed = Math.round(value * 0.7);
    still = Math.round(value * 0.3);
  }
  if (stage === "docs_payment" || stage === "closed") {
    deployed = value;
    still = 0;
    receivable = value;
    recvStatus =
      deal.payment?.status === "paid"
        ? "collected"
        : deal.payment?.status === "overdue"
          ? "overdue"
          : "expected";
  }
  if (deal.payment?.status === "paid") {
    receivable = 0;
    recvStatus = "collected";
  }

  if (hints) {
    deployed = hints.cashDeployedUsd;
    still = hints.cashStillRequiredUsd;
    receivable = hints.receivableExpectedUsd;
    recvStatus = hints.receivableStatus;
  }

  const blockedAt = blockFromStage(deal);
  const payGap =
    deal.payment?.daysRemaining != null
      ? Math.abs(deal.payment.daysRemaining) + 30
      : stage === "docs_payment"
        ? 35
        : undefined;

  return {
    pipelineCommitmentUsd: value,
    cashDeployedUsd: deployed,
    cashStillRequiredUsd: still,
    wipValueUsd: stage === "production" ? Math.round(value * 0.55) : undefined,
    receivableExpectedUsd: receivable,
    receivableDueDate: deal.payment?.dueDate,
    receivableStatus: recvStatus,
    blockedAt,
    payGapDays: payGap,
    commissionInvoiceUsd: e.agencyCommissionUsd,
    commissionStatus:
      deal.commission?.complete
        ? "received"
        : deal.stage === "closed"
          ? "chasing"
          : deal.commission
            ? "invoiced"
            : undefined,
    sources: cites(deal),
  };
}

function drill(
  deal: Deal,
  amountUsd: number,
  meta?: string,
  blockedAt?: CashBlockLocation,
): CashDrillDeal {
  const c = ensureCashExposure(deal);
  return {
    dealId: deal.id,
    dealCode: deal.code,
    title: deal.title,
    amountUsd,
    meta,
    blockedAt: blockedAt || c.blockedAt,
    sources: c.sources,
    href: `/deals/${deal.id}`,
  };
}

export function buildCashExposureReport(deals: Deal[]): CashExposureReport {
  const asOf = new Date().toISOString();
  let cashDeployedUsd = 0;
  let cashStillRequiredUsd = 0;
  let expectedRecoveriesUsd = 0;
  let commissionAwaitingUsd = 0;
  let commissionReceivedUsd = 0;
  let commissionChasingUsd = 0;
  const deployedDeals: CashDrillDeal[] = [];
  const stillRequiredDeals: CashDrillDeal[] = [];
  const recoveries: CashDrillDeal[] = [];
  const payGapDeals: CashDrillDeal[] = [];
  const commissionLines: CashDrillDeal[] = [];
  const blockMap = new Map<CashBlockLocation, CashDrillDeal[]>();

  const rollingMap: Record<30 | 60 | 90 | 120, CashDrillDeal[]> = {
    30: [],
    60: [],
    90: [],
    120: [],
  };

  let gapSum = 0;
  let gapN = 0;

  for (const d of deals) {
    const c = ensureCashExposure(d);
    if (c.cashDeployedUsd > 0) {
      cashDeployedUsd += c.cashDeployedUsd;
      deployedDeals.push(
        drill(d, c.cashDeployedUsd, `Deployed · ${d.stage}`),
      );
    }
    if (c.cashStillRequiredUsd > 0) {
      cashStillRequiredUsd += c.cashStillRequiredUsd;
      stillRequiredDeals.push(
        drill(d, c.cashStillRequiredUsd, `Still required · ${d.stage}`),
      );
      // Heuristic horizons by stage urgency
      const h: 30 | 60 | 90 | 120 =
        d.stage === "booking" || d.payment?.status === "due_soon"
          ? 30
          : d.stage === "production"
            ? 60
            : d.stage === "pi_po"
              ? 90
              : 120;
      rollingMap[h].push(
        drill(d, c.cashStillRequiredUsd, `Need within ${h}d`),
      );
    }
    if (
      c.receivableExpectedUsd > 0 &&
      (c.receivableStatus === "expected" || c.receivableStatus === "overdue")
    ) {
      expectedRecoveriesUsd += c.receivableExpectedUsd;
      recoveries.push(
        drill(
          d,
          c.receivableExpectedUsd,
          c.receivableDueDate
            ? `Due ${c.receivableDueDate} · ${c.receivableStatus}`
            : c.receivableStatus,
        ),
      );
    }
    if (c.blockedAt && c.blockedAt !== "none") {
      const amt =
        c.cashDeployedUsd ||
        c.receivableExpectedUsd ||
        c.pipelineCommitmentUsd ||
        0;
      if (amt > 0) {
        const list = blockMap.get(c.blockedAt) || [];
        list.push(drill(d, amt, `Blocked at ${c.blockedAt}`, c.blockedAt));
        blockMap.set(c.blockedAt, list);
      }
    }
    if (c.payGapDays != null && c.payGapDays > 0) {
      gapSum += c.payGapDays;
      gapN += 1;
      payGapDeals.push(
        drill(d, c.pipelineCommitmentUsd, `Gap ${c.payGapDays} days`),
      );
    }
    const comm = c.commissionInvoiceUsd || 0;
    if (comm > 0) {
      if (c.commissionStatus === "received") {
        commissionReceivedUsd += comm;
        commissionLines.push(drill(d, comm, "Commission received"));
      } else if (c.commissionStatus === "chasing") {
        commissionChasingUsd += comm;
        commissionLines.push(drill(d, comm, "Chasing factory payment"));
      } else if (c.commissionStatus === "invoiced" || c.commissionStatus === "awaiting_fx") {
        commissionAwaitingUsd += comm;
        commissionLines.push(
          drill(
            d,
            comm,
            c.commissionStatus === "awaiting_fx"
              ? "Awaiting FX from factory"
              : "Commission invoiced",
          ),
        );
      }
    }
  }

  const blockedByLocation = (
    ["vendor", "production", "transit", "port", "inventory", "buyer"] as CashBlockLocation[]
  )
    .map((location) => {
      const ds = blockMap.get(location) || [];
      return {
        location,
        amountUsd: ds.reduce((a, x) => a + x.amountUsd, 0),
        deals: ds,
      };
    })
    .filter((x) => x.amountUsd > 0);

  const rolling: RollingBucket[] = ([30, 60, 90, 120] as const).map(
    (horizonDays) => ({
      horizonDays,
      requiredUsd: rollingMap[horizonDays].reduce((a, x) => a + x.amountUsd, 0),
      deals: rollingMap[horizonDays],
    }),
  );

  return {
    asOf,
    cashDeployedUsd,
    cashStillRequiredUsd,
    rolling,
    expectedRecoveriesUsd,
    recoveries,
    blockedByLocation,
    avgPayGapDays: gapN ? Math.round(gapSum / gapN) : 0,
    payGapDeals,
    commissionAwaitingUsd,
    commissionReceivedUsd,
    commissionChasingUsd,
    commissionLines,
    deployedDeals,
    stillRequiredDeals,
    summary: `Deployed ${fmt(cashDeployedUsd)} · still required ${fmt(cashStillRequiredUsd)} · recoveries ${fmt(expectedRecoveriesUsd)} · avg vendor–buyer gap ${gapN ? Math.round(gapSum / gapN) : 0}d`,
  };
}

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}
