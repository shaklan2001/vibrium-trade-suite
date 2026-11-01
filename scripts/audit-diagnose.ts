import { readFileSync } from "fs";
import { mapProcessedDeal } from "../src/lib/trade/processedDealMapper";
import {
  filterDealsByCommissionCurrency,
  resolveCommissionPaymentCurrency,
} from "../src/lib/trade/commissionCurrency";
import { buildPaymentScheduleReport } from "../src/lib/trade/paymentSchedule";
import {
  buildAgencyCommissionBook,
  isShipmentDone,
} from "../src/lib/trade/commissionSettlement";
import {
  agencyCommissionForDeal,
  commercialValueUsd,
} from "../src/lib/trade/agencyCommission";

const body = JSON.parse(readFileSync("/tmp/vts-audit/deals.json", "utf8"));
const deals = (body.deals || [])
  .filter((r: { status?: string }) => r.status === "completed")
  .filter((r: { result_json?: { isTradeDeal?: boolean } }) => {
    if (r.result_json && r.result_json.isTradeDeal === false) return false;
    return true;
  })
  .map((r: never) => mapProcessedDeal(r))
  .filter(Boolean);

const pay = buildPaymentScheduleReport(deals as never[]);
const overdue = pay.lines
  .filter((l) => l.status === "overdue")
  .sort((a, b) => b.amountUsd - a.amountUsd)
  .slice(0, 15);
console.log("TOP OVERDUE LINES");
for (const l of overdue) {
  console.log(
    Math.round(l.amountUsd),
    l.dealCode,
    l.label,
    l.dueDate,
    l.side,
  );
}

const inr = filterDealsByCommissionCurrency(deals as never[], "INR");
console.log("\nINR DEALS", inr.length);
for (const d of inr) {
  console.log({
    code: d.code,
    cur: resolveCommissionPaymentCurrency(d),
    payCur: d.payment?.currency,
    amt: d.payment?.amountUsd || d.economics?.commercialValueUsd,
    stage: d.stage,
    slot: d.mailboxSlot,
    summary: (d.payment?.summary || d.title || "").slice(0, 120),
    cps: d.paymentSchedule?.checkpoints?.map((c) => ({
      l: c.label,
      a: c.amountUsd,
      s: c.status,
    })),
  });
}

const agency = deals.filter(
  (d) => d!.commercialModel !== "trader_principal",
);
const shipped = agency.filter((d) => isShipmentDone(d!));
console.log("\nSHIPPED AGENCY", shipped.length);
for (const d of shipped.slice(0, 12)) {
  const o = agencyCommissionForDeal(d!, []);
  console.log({
    code: d!.code,
    stage: d!.stage,
    slot: d!.mailboxSlot,
    commercial: o.commercialValueUsd,
    commission: o.commissionUsd,
    vessel: d!.booking?.vessel,
    etd: d!.booking?.etd,
    status: d!.booking?.shipmentStatus,
  });
}

const withValue = agency.filter((d) => commercialValueUsd(d!) > 0);
console.log(
  "\nagency with value",
  withValue.length,
  "shipped with value",
  withValue.filter((d) => isShipmentDone(d!)).length,
);
const book = buildAgencyCommissionBook(agency as never[], []);
console.log({
  book: book.bookUsd,
  notYet: book.notYetDueUsd,
  lines: book.lines.length,
  collected: book.collectedUsd,
});
