/**
 * Full production verification of mailbox → KPI pipeline.
 * Run: npx tsx scripts/audit-full-verify.ts [/path/to/deals.json]
 */
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
  isCommissionGateOpen,
  isShipmentDone,
  commissionLifecycleStatus,
} from "../src/lib/trade/commissionSettlement";
import { buildBookInsights } from "../src/lib/trade/bookInsights";
import { buildCashExposureReport } from "../src/lib/trade/cashExposure";
import { dealCommercialModel } from "../src/lib/trade/commercialModel";
import { commercialValueUsd } from "../src/lib/trade/agencyCommission";
import { USD_TO_INR } from "../src/lib/trade/currencyDisplay";
import type { Deal } from "../src/types/trade";

type Issue = { severity: "P0" | "P1" | "P2"; area: string; detail: string };

const path = process.argv[2] || "/tmp/vts-audit/deals.json";
const body = JSON.parse(readFileSync(path, "utf8")) as {
  deals?: unknown[];
  counts?: Record<string, unknown>;
};

const raw = body.deals || [];
const mapped = enrichMailboxDeals(
  raw
    .filter((r) => (r as { status?: string }).status === "completed")
    .filter((r) => {
      const result = (r as { result_json?: { isTradeDeal?: boolean } })
        .result_json;
      return !(result && result.isTradeDeal === false);
    })
    .map((r) => mapProcessedDeal(r as never))
    .filter((d): d is Deal => Boolean(d)),
);

const issues: Issue[] = [];
const note = (severity: Issue["severity"], area: string, detail: string) =>
  issues.push({ severity, area, detail });

// --- Spot checks ---
const henlo = mapped.find(
  (d) =>
    (d.payment?.summary || "").includes("16,176") ||
    (d.payment?.summary || "").includes("Henlo"),
);
if (!henlo) {
  note("P0", "henlo", "Henlo / INR 16,176 deal missing from mapped book");
} else {
  const cur = resolveCommissionPaymentCurrency(henlo);
  const amt = henlo.payment?.amountUsd || 0;
  const inrApprox = Math.round(amt * USD_TO_INR);
  if (cur !== "INR") note("P0", "henlo", `Currency resolved as ${cur}, expected INR`);
  if (Math.abs(inrApprox - 16176) > 50)
    note(
      "P0",
      "henlo",
      `INR approx ${inrApprox} vs expected 16176 (usd=${amt}, fx=${USD_TO_INR})`,
    );
  if (henlo.payment?.status !== "overdue")
    note("P1", "henlo", `Payment status ${henlo.payment?.status}, expected overdue`);
  const cps = henlo.paymentSchedule?.checkpoints || [];
  if (cps.length !== 1)
    note("P1", "henlo", `Expected 1 outstanding checkpoint, got ${cps.length}`);
  if (cps[0] && cps[0].status !== "overdue")
    note("P1", "henlo", `Checkpoint status ${cps[0].status}`);
  if (henlo.payment?.status === "paid")
    note("P0", "henlo", "Payment advice was treated as receipt");
}

// The same outstanding statement must not sit on two payment threads.
for (const amt of [124852.3, 118426.22]) {
  const hits = mapped.filter((d) =>
    (d.paymentSchedule?.checkpoints || []).some(
      (c) => c.side === "buyer" && Math.abs(c.amountUsd - amt) < 1,
    ),
  );
  if (hits.length > 1) {
    note(
      "P0",
      "duplicate",
      `Outstanding ~$${amt} still counted on ${hits.map((d) => d.code).join(", ")}`,
    );
  }
}

// Explicit 100% TT is one payment, and it is not due before a B/L date.
const fullTt = mapped.find((d) => d.code === "PO-G2625141");
if (fullTt) {
  const buyer = (fullTt.paymentSchedule?.checkpoints || []).filter(
    (c) => c.side === "buyer",
  );
  if (buyer.some((c) => /70%/.test(c.label))) {
    note("P0", "terms", `${fullTt.code} still shows a 70% balance`);
  }
  if (buyer.length !== 1 || buyer[0]?.percent !== 100) {
    note(
      "P0",
      "terms",
      `${fullTt.code} buyer checkpoints ${buyer.map((c) => c.label).join(" | ") || "none"}`,
    );
  }
  if (!fullTt.booking?.etd && !fullTt.payment?.blSharedDate && buyer[0]?.status === "overdue") {
    note("P1", "terms", `${fullTt.code} 100% TT marked overdue with no B/L date`);
  }
  if (dealCommercialModel(fullTt) !== "trader_principal") {
    note("P1", "model", `${fullTt.code} shipper is Global Praise but model is agency`);
  }
}

// Cottonsmiths / payment required should NOT be ~1.3M
const payReq = mapped.find((d) => d.code === "MB-REQUIRED" || (d.payment?.summary || "").includes("Cottonsmiths"));
if (payReq) {
  const amt = payReq.payment?.amountUsd || payReq.economics?.commercialValueUsd || 0;
  if (amt > 200_000)
    note("P0", "money-parse", `MB-REQUIRED / Cottonsmiths still inflated: $${Math.round(amt)}`);
  if (amt < 28_000 || amt > 37_000)
    note(
      "P1",
      "money-parse",
      `Cottonsmiths amount $${Math.round(amt)} outside expected ~30–35k midpoint band`,
    );
}

// PO-8602: origin charges ≠ trade commercial; FOB Houston ≠ INR settlement
const po8602 = mapped.find((d) => d.code === "PO-8602");
if (po8602) {
  const sch = po8602.paymentSchedule?.checkpoints || [];
  const buyer = sch
    .filter((c) => c.side === "buyer")
    .reduce((a, c) => a + c.amountUsd, 0);
  if (buyer > 10_000) {
    note(
      "P0",
      "local-charges",
      `PO-8602 buyer schedule $${Math.round(buyer)} — origin charges should not be trade commercial`,
    );
  }
  if ((po8602.economics?.commercialValueUsd || 0) > 10_000) {
    note(
      "P0",
      "local-charges",
      `PO-8602 commercial $${Math.round(po8602.economics!.commercialValueUsd)} still inflated`,
    );
  }
  if (resolveCommissionPaymentCurrency(po8602) === "INR") {
    note("P0", "currency", "PO-8602 (FOB Houston) still classified INR");
  }
}

// --- Filter sets ---
const inr = filterDealsByCommissionCurrency(mapped, "INR");
const usd = filterDealsByCommissionCurrency(mapped, "USD");
const agency = mapped.filter((d) => dealCommercialModel(d) === "agency_commission");
const trader = mapped.filter((d) => dealCommercialModel(d) === "trader_principal");

if (inr.length + usd.length !== mapped.length) {
  note(
    "P0",
    "currency",
    `INR(${inr.length})+USD(${usd.length}) != total(${mapped.length})`,
  );
}

// INR book should be small and include Henlo
if (henlo && !inr.some((d) => d.id === henlo.id)) {
  note("P0", "currency", "Henlo not in INR filter set");
}
for (const d of inr) {
  if (resolveCommissionPaymentCurrency(d) !== "INR") {
    note("P0", "currency", `${d.code} in INR set but resolves ${resolveCommissionPaymentCurrency(d)}`);
  }
  // FOB exports shouldn't sneak in
  const blob = `${d.economics?.summary || ""} ${d.pi?.summary || ""}`;
  if (/\bFOB\b/i.test(blob) && !/\bINR\s*[\d,]/.test(blob) && d.payment?.currency !== "INR") {
    note("P1", "currency", `${d.code} looks like FOB export but in INR filter`);
  }
}

// --- Finance KPIs ---
const payAll = buildPaymentScheduleReport(mapped);
const payInr = buildPaymentScheduleReport(inr);
const payUsd = buildPaymentScheduleReport(usd);
const payAgency = buildPaymentScheduleReport(agency, { agencyMode: true, rates: [] });
const payTrader = buildPaymentScheduleReport(trader);

const agencyBook = buildAgencyCommissionBook(agency, []);
const insights = buildBookInsights(mapped, []);
const cashAgency = buildCashExposureReport(agency, { agencyMode: true, rates: [] });
const cashTrader = buildCashExposureReport(trader, { agencyMode: false });

// Identity: received + upcoming + overdue (buyer) should equal sum of buyer line amounts (excl waived)
const buyerLines = payAll.lines.filter((l) => l.side === "buyer");
const buyerSum = buyerLines.reduce((a, l) => a + l.amountUsd, 0);
const buyerKpi =
  payAll.buyerReceivedUsd + payAll.buyerUpcomingUsd + payAll.buyerOverdueUsd;
if (Math.abs(buyerSum - buyerKpi) > 1) {
  note(
    "P0",
    "finance",
    `Buyer KPI identity broken: lines=${Math.round(buyerSum)} vs kpi=${Math.round(buyerKpi)}`,
  );
}

// No NaN / Infinity
for (const [name, n] of Object.entries({
  buyerOverdue: payAll.buyerOverdueUsd,
  agencyBook: agencyBook.bookUsd,
  agencyCollected: agencyBook.collectedUsd,
  inrOverdue: payInr.buyerOverdueUsd,
})) {
  if (!Number.isFinite(n)) note("P0", "finance", `${name} is not finite`);
  if (n < 0) note("P0", "finance", `${name} is negative: ${n}`);
}

// Agency commission book identity
const agId =
  agencyBook.collectedUsd + agencyBook.outstandingUsd - agencyBook.bookUsd;
if (Math.abs(agId) > 1) {
  note("P0", "agency", `Commission book identity broken delta=${agId}`);
}
// outstanding should include overdue
if (agencyBook.overdueUsd - agencyBook.outstandingUsd > 1) {
  note("P0", "agency", "Overdue exceeds outstanding");
}

// Payment received should not also be overdue on same checkpoint
for (const l of payAll.lines) {
  if (l.status === "received" && l.notReceived) {
    note("P1", "finance", `${l.dealCode} ${l.label} received but notReceived flag`);
  }
}

// Phantom trader commission awaiting should be ~0 without commission objects
if (cashTrader.commissionAwaitingUsd > 10_000) {
  note(
    "P1",
    "cash",
    `Trader commission awaiting inflated: $${Math.round(cashTrader.commissionAwaitingUsd)}`,
  );
}

// Schedules: payment_clock outstanding should be single line
for (const d of mapped.filter((x) => x.mailboxSlot === "payment_clock")) {
  const n = d.paymentSchedule?.checkpoints?.length || 0;
  if (n > 2) {
    note("P1", "schedule", `${d.code} payment_clock has ${n} checkpoints (expect 1)`);
  }
}

// Top overdue sanity: no single line > $500k unless summary supports it
const topOverdue = payAll.lines
  .filter((l) => l.status === "overdue")
  .sort((a, b) => b.amountUsd - a.amountUsd)
  .slice(0, 8);
for (const l of topOverdue) {
  if (l.amountUsd > 500_000) {
    const deal = mapped.find((d) => d.id === l.dealId);
    const s = deal?.payment?.summary || deal?.economics?.summary || "";
    if (!s.includes(String(Math.round(l.amountUsd))) && !s.includes("1,319,048")) {
      note(
        "P1",
        "overdue",
        `Very large overdue $${Math.round(l.amountUsd)} on ${l.dealCode} — verify extract`,
      );
    }
  }
}

// Agency: every due/overdue line should pass commission gate
for (const l of agencyBook.outstandingLines) {
  const deal = agency.find((d) => d.id === l.dealId);
  if (deal && !isCommissionGateOpen(deal)) {
    note("P0", "agency", `${l.dealCode} in outstanding but gate closed`);
  }
}

// Coverage
const withSchedule = mapped.filter((d) => d.paymentSchedule?.checkpoints?.length).length;
const withValue = mapped.filter((d) => commercialValueUsd(d) > 0).length;

const report = {
  meta: {
    fxDefault: USD_TO_INR,
    rawRows: raw.length,
    mappedDeals: mapped.length,
    counts: body.counts,
  },
  segments: {
    agency: agency.length,
    trader: trader.length,
    inr: inr.length,
    usd: usd.length,
    withSchedule,
    withValue,
    shippedEvidence: mapped.filter((d) => isShipmentDone(d)).length,
    commissionGateOpen: mapped.filter((d) => isCommissionGateOpen(d)).length,
  },
  financeAll: {
    buyerReceived: Math.round(payAll.buyerReceivedUsd),
    buyerUpcoming: Math.round(payAll.buyerUpcomingUsd),
    buyerOverdue: Math.round(payAll.buyerOverdueUsd),
    factoryPaid: Math.round(payAll.factoryReceivedUsd),
    factoryDue: Math.round(payAll.factoryUpcomingUsd + payAll.factoryOverdueUsd),
  },
  financeInr: {
    deals: inr.length,
    buyerOverdueUsd: Math.round(payInr.buyerOverdueUsd),
    buyerOverdueInr: Math.round(payInr.buyerOverdueUsd * USD_TO_INR),
    codes: inr.map((d) => d.code),
  },
  financeUsd: {
    deals: usd.length,
    buyerOverdue: Math.round(payUsd.buyerOverdueUsd),
  },
  agencyCommission: {
    book: Math.round(agencyBook.bookUsd),
    collected: Math.round(agencyBook.collectedUsd),
    outstanding: Math.round(agencyBook.outstandingUsd),
    overdue: Math.round(agencyBook.overdueUsd),
    notYetDue: Math.round(agencyBook.notYetDueUsd),
    collectionPct: agencyBook.collectionPct,
    dueDealCodes: agencyBook.outstandingLines.slice(0, 12).map((l) => l.dealCode),
  },
  cash: {
    agencyDeployed: Math.round(cashAgency.cashDeployedUsd),
    agencyCommAwait: Math.round(cashAgency.commissionAwaitingUsd),
    traderDeployed: Math.round(cashTrader.cashDeployedUsd),
    traderCommAwait: Math.round(cashTrader.commissionAwaitingUsd),
  },
  henlo: henlo && {
    code: henlo.code,
    currency: resolveCommissionPaymentCurrency(henlo),
    paymentCurrency: henlo.payment?.currency,
    amountUsd: henlo.payment?.amountUsd,
    amountInr: Math.round((henlo.payment?.amountUsd || 0) * USD_TO_INR),
    status: henlo.payment?.status,
    lifecycle: commissionLifecycleStatus(henlo),
    checkpoints: henlo.paymentSchedule?.checkpoints?.map((c) => ({
      label: c.label,
      amountUsd: c.amountUsd,
      status: c.status,
      due: c.dueDate,
    })),
  },
  topOverdue: topOverdue.map((l) => ({
    code: l.dealCode,
    label: l.label,
    usd: Math.round(l.amountUsd),
    due: l.dueDate,
    side: l.side,
  })),
  insights: insights.headlines,
  issueCount: {
    P0: issues.filter((i) => i.severity === "P0").length,
    P1: issues.filter((i) => i.severity === "P1").length,
    P2: issues.filter((i) => i.severity === "P2").length,
  },
  issues,
};

console.log(JSON.stringify(report, null, 2));
process.exit(issues.some((i) => i.severity === "P0") ? 2 : 0);
