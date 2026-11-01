import { readFileSync } from "fs";
import { mapProcessedDeal } from "../src/lib/trade/processedDealMapper";
import { enrichMailboxDeals } from "../src/lib/trade/enrichMailboxDeals";
import {
  filterDealsByCommissionCurrency,
  resolveCommissionPaymentCurrency,
} from "../src/lib/trade/commissionCurrency";
import { buildPaymentScheduleReport } from "../src/lib/trade/paymentSchedule";
import {
  buildAgencyCommissionBook,
  isShipmentDone,
} from "../src/lib/trade/commissionSettlement";
import { buildBookInsights } from "../src/lib/trade/bookInsights";
import { buildCashExposureReport } from "../src/lib/trade/cashExposure";

const path = process.argv[2] || "/tmp/vts-audit/deals.json";
const body = JSON.parse(readFileSync(path, "utf8")) as {
  deals?: unknown[];
};

const deals = (body.deals || [])
  .filter((r) => (r as { status?: string }).status === "completed")
  .filter((r) => {
    const result = (r as { result_json?: { isTradeDeal?: boolean } })
      .result_json;
    if (result && result.isTradeDeal === false) return false;
    return true;
  })
  .map((r) => mapProcessedDeal(r as never))
  .filter((d): d is NonNullable<typeof d> => Boolean(d));

const enriched = enrichMailboxDeals(deals);

const inr = filterDealsByCommissionCurrency(enriched, "INR");
const usd = filterDealsByCommissionCurrency(enriched, "USD");
const agency = enriched.filter((d) => d.commercialModel !== "trader_principal");
const trader = enriched.filter((d) => d.commercialModel === "trader_principal");

const payAll = buildPaymentScheduleReport(enriched);
const payInr = buildPaymentScheduleReport(inr);
const agencyBook = buildAgencyCommissionBook(agency, []);
const insights = buildBookInsights(enriched, []);
const cashAgency = buildCashExposureReport(agency, {
  agencyMode: true,
  rates: [],
});
const cashTrader = buildCashExposureReport(trader, {
  agencyMode: false,
});

const henlo = enriched.find(
  (d) =>
    (d.payment?.summary || "").includes("16,176") ||
    (d.payment?.summary || "").includes("Henlo"),
);

console.log(
  JSON.stringify(
    {
      totals: {
        deals: enriched.length,
        inr: inr.length,
        usd: usd.length,
        agency: agency.length,
        trader: trader.length,
      },
      financeAll: {
        buyerOverdue: Math.round(payAll.buyerOverdueUsd),
        buyerReceived: Math.round(payAll.buyerReceivedUsd),
        buyerUpcoming: Math.round(payAll.buyerUpcomingUsd),
        factoryDue: Math.round(
          payAll.factoryUpcomingUsd + payAll.factoryOverdueUsd,
        ),
        withSchedule: enriched.filter(
          (d) => d.paymentSchedule?.checkpoints?.length,
        ).length,
      },
      financeInr: {
        buyerOverdue: Math.round(payInr.buyerOverdueUsd),
        buyerOverdueInrApprox: Math.round(payInr.buyerOverdueUsd * 96),
        lines: payInr.lines.length,
      },
      agencyCommission: {
        book: Math.round(agencyBook.bookUsd),
        collected: Math.round(agencyBook.collectedUsd),
        outstanding: Math.round(agencyBook.outstandingUsd),
        overdue: Math.round(agencyBook.overdueUsd),
        notYetDue: Math.round(agencyBook.notYetDueUsd),
        shipped: agency.filter((d) => isShipmentDone(d)).length,
        shippedWithValue: agency.filter(
          (d) =>
            isShipmentDone(d) &&
            (d.economics?.commercialValueUsd || 0) > 0,
        ).length,
      },
      cash: {
        agencyDeployed: Math.round(cashAgency.cashDeployedUsd),
        agencyCommAwait: Math.round(cashAgency.commissionAwaitingUsd),
        traderDeployed: Math.round(cashTrader.cashDeployedUsd),
        traderCommAwait: Math.round(cashTrader.commissionAwaitingUsd),
      },
      henlo: henlo && {
        code: henlo.code,
        cur: resolveCommissionPaymentCurrency(henlo),
        paymentCur: henlo.payment?.currency,
        amountUsd: henlo.payment?.amountUsd,
        amountInrApprox: Math.round((henlo.payment?.amountUsd || 0) * 96),
        status: henlo.payment?.status,
        checkpoints: henlo.paymentSchedule?.checkpoints?.map((c) => ({
          label: c.label,
          amt: c.amountUsd,
          status: c.status,
          due: c.dueDate,
        })),
        shipped: isShipmentDone(henlo),
      },
      insightsHeadlines: insights.headlines,
    },
    null,
    2,
  ),
);
