/**
 * Book-quality and investor-facing insights from the loaded mailbox deals.
 * Visibility-only — no execution side effects.
 */
import type { Deal } from "@/types/trade";
import { dealCommercialModel } from "./commercialModel";
import {
  resolveCommissionPaymentCurrency,
  type CommissionPaymentCurrency,
} from "./commissionCurrency";
import {
  buildAgencyCommissionBook,
  isCommissionGateOpen,
} from "./commissionSettlement";
import {
  agencyCommissionForDeal,
  type BuyerCommissionRate,
} from "./agencyCommission";
import {
  buildPaymentScheduleReport,
  computeDaysLate,
} from "./paymentSchedule";

export type AgingBucket = {
  key: "0_7" | "8_30" | "31_60" | "61_plus";
  label: string;
  count: number;
  amountUsd: number;
};

export type BookInsights = {
  dealCount: number;
  agencyCount: number;
  traderCount: number;
  withAmount: number;
  withSchedule: number;
  withBooking: number;
  shippedCount: number;
  inrSettlementCount: number;
  usdSettlementCount: number;
  overdueAging: AgingBucket[];
  overdueTotalUsd: number;
  agency: {
    bookUsd: number;
    collectedUsd: number;
    outstandingUsd: number;
    overdueUsd: number;
    notYetDueUsd: number;
    collectionPct: number;
  } | null;
  coveragePct: number;
  headlines: string[];
};

function emptyAging(): AgingBucket[] {
  return [
    { key: "0_7", label: "1–7d", count: 0, amountUsd: 0 },
    { key: "8_30", label: "8–30d", count: 0, amountUsd: 0 },
    { key: "31_60", label: "31–60d", count: 0, amountUsd: 0 },
    { key: "61_plus", label: "61d+", count: 0, amountUsd: 0 },
  ];
}

export function buildBookInsights(
  deals: Deal[],
  rates: BuyerCommissionRate[] = [],
): BookInsights {
  let withAmount = 0;
  let withSchedule = 0;
  let withBooking = 0;
  let shippedCount = 0;
  let agencyCount = 0;
  let traderCount = 0;
  let inrSettlementCount = 0;
  let usdSettlementCount = 0;

  for (const d of deals) {
    const model = dealCommercialModel(d);
    if (model === "agency_commission") agencyCount += 1;
    else traderCount += 1;

    const cur: CommissionPaymentCurrency =
      resolveCommissionPaymentCurrency(d);
    if (cur === "INR") inrSettlementCount += 1;
    else usdSettlementCount += 1;

    const amt =
      d.payment?.amountUsd ||
      d.po?.totalAmount ||
      d.pi?.totalAmount ||
      d.economics?.commercialValueUsd ||
      0;
    if (amt > 0) withAmount += 1;
    if (d.paymentSchedule?.checkpoints?.length) withSchedule += 1;
    if (d.booking?.etd || d.booking?.bookingNumber || d.booking?.vessel)
      withBooking += 1;
    if (isCommissionGateOpen(d)) shippedCount += 1;
  }

  const pay = buildPaymentScheduleReport(deals, { agencyMode: false });
  const aging = emptyAging();
  let overdueTotalUsd = 0;
  for (const line of pay.lines) {
    if (line.status !== "overdue" || !(line.amountUsd > 0)) continue;
    overdueTotalUsd += line.amountUsd;
    const days =
      line.daysLate ??
      computeDaysLate({
        dueDate: line.dueDate,
        receivedAt: line.receivedAt,
        status: line.status,
      }) ??
      0;
    const bucket =
      days <= 7
        ? aging[0]!
        : days <= 30
          ? aging[1]!
          : days <= 60
            ? aging[2]!
            : aging[3]!;
    bucket.count += 1;
    bucket.amountUsd += line.amountUsd;
  }

  const agencyBook = buildAgencyCommissionBook(
    deals.filter((d) => dealCommercialModel(d) === "agency_commission"),
    rates,
  );

  const coveragePct =
    deals.length > 0
      ? Math.round((withSchedule / deals.length) * 1000) / 10
      : 0;

  const headlines: string[] = [];
  headlines.push(
    `${deals.length} deals in view · ${agencyCount} agency · ${traderCount} trader`,
  );
  headlines.push(
    `Settlement mix · ${inrSettlementCount} INR · ${usdSettlementCount} USD`,
  );
  if (agencyBook.bookUsd > 0) {
    headlines.push(
      `Agency commission after shipment · collected ${agencyBook.collectionPct}% · overdue $${Math.round(agencyBook.overdueUsd).toLocaleString()}`,
    );
  }
  if (overdueTotalUsd > 0) {
    headlines.push(
      `Open overdue installments ≈ $${Math.round(overdueTotalUsd).toLocaleString()} across aging buckets`,
    );
  }
  const defaulted = deals.filter((d) => {
    if (dealCommercialModel(d) !== "agency_commission") return false;
    return agencyCommissionForDeal(d, rates).defaulted;
  }).length;
  if (defaulted > 0) {
    headlines.push(
      `${defaulted} agency deals on default 5% commission — confirm buyer rates`,
    );
  }

  return {
    dealCount: deals.length,
    agencyCount,
    traderCount,
    withAmount,
    withSchedule,
    withBooking,
    shippedCount,
    inrSettlementCount,
    usdSettlementCount,
    overdueAging: aging,
    overdueTotalUsd,
    agency:
      agencyCount > 0
        ? {
            bookUsd: agencyBook.bookUsd,
            collectedUsd: agencyBook.collectedUsd,
            outstandingUsd: agencyBook.outstandingUsd,
            overdueUsd: agencyBook.overdueUsd,
            notYetDueUsd: agencyBook.notYetDueUsd,
            collectionPct: agencyBook.collectionPct,
          }
        : null,
    coveragePct,
    headlines,
  };
}
