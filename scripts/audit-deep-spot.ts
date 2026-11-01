import { readFileSync } from "fs";
import { mapProcessedDeal } from "../src/lib/trade/processedDealMapper";
import { enrichMailboxDeals } from "../src/lib/trade/enrichMailboxDeals";
import type { Deal } from "../src/types/trade";
import { commercialValueUsd } from "../src/lib/trade/agencyCommission";
import { resolveCommissionPaymentCurrency } from "../src/lib/trade/commissionCurrency";
import {
  ensurePaymentSchedule,
  buildPaymentScheduleReport,
} from "../src/lib/trade/paymentSchedule";
import { buildAgencyCommissionBook } from "../src/lib/trade/commissionSettlement";
import { dealCommercialModel } from "../src/lib/trade/commercialModel";
import { USD_TO_INR } from "../src/lib/trade/currencyDisplay";

const body = JSON.parse(readFileSync("/tmp/vts-audit/deals.json", "utf8"));
const raw = body.deals || [];
const mapped = enrichMailboxDeals(
  raw
    .filter((r: { status?: string }) => r.status === "completed")
    .filter((r: { result_json?: { isTradeDeal?: boolean } }) => {
      const result = r.result_json;
      return !(result && result.isTradeDeal === false);
    })
    .map((r) => mapProcessedDeal(r as never))
    .filter((d): d is Deal => Boolean(d)),
);

const cotton = mapped.filter(
  (d) =>
    d.code === "MB-REQUIRED" ||
    (d.payment?.summary || "").toLowerCase().includes("cotton") ||
    (d.title || "").toLowerCase().includes("cotton") ||
    (d.payment?.summary || "").includes("1,319") ||
    (d.economics?.summary || "").includes("Cotton"),
);
console.log("=== COTTON / REQUIRED ===");
for (const d of cotton) {
  console.log(
    JSON.stringify(
      {
        code: d.code,
        title: d.title,
        payment: d.payment,
        commercialValue: commercialValueUsd(d),
        currency: resolveCommissionPaymentCurrency(d),
        schedule: ensurePaymentSchedule(d)?.checkpoints,
        summary: (d.payment?.summary || d.economics?.summary || "").slice(
          0,
          500,
        ),
      },
      null,
      2,
    ),
  );
}

console.log("\n=== INR DEALS ===");
for (const d of mapped) {
  if (resolveCommissionPaymentCurrency(d) === "INR") {
    console.log(
      JSON.stringify({
        code: d.code,
        payCur: d.payment?.currency,
        amtUsd: d.payment?.amountUsd,
        inr: Math.round((d.payment?.amountUsd || 0) * USD_TO_INR),
        status: d.payment?.status,
        summary: (d.payment?.summary || "").slice(0, 220),
      }),
    );
  }
}

console.log("\n=== TOP CV WITH SCHEDULES ===");
const ranked = mapped
  .map((d) => ({
    code: d.code,
    cv: commercialValueUsd(d),
    cps: (ensurePaymentSchedule(d)?.checkpoints || []).map((c) => ({
      label: c.label,
      amt: Math.round(c.amountUsd),
      status: c.status,
      due: c.dueDate,
      side: c.side,
    })),
    terms: ensurePaymentSchedule(d)?.buyerTerms,
    payStatus: d.payment?.status,
    stage: d.stage,
  }))
  .filter((x) => x.cv > 0 || x.cps.length)
  .sort((a, b) => b.cv - a.cv)
  .slice(0, 25);
for (const x of ranked) console.log(JSON.stringify(x));

let inferredOverdue = 0;
let explicitOverdue = 0;
let outstandingOnly = 0;
for (const d of mapped) {
  const sch = ensurePaymentSchedule(d);
  const terms = sch?.buyerTerms || "";
  const isInferred = /inferred default/i.test(terms);
  const isOutstanding =
    /outstanding/i.test(terms) ||
    sch?.checkpoints?.some((c) => /outstanding/i.test(c.label));
  for (const c of sch?.checkpoints || []) {
    if (c.side !== "buyer" || c.status !== "overdue") continue;
    if (isOutstanding) outstandingOnly += c.amountUsd;
    else if (isInferred) inferredOverdue += c.amountUsd;
    else explicitOverdue += c.amountUsd;
  }
}
console.log("\nOverdue buyer breakdown:", {
  inferredOverdue: Math.round(inferredOverdue),
  explicitOverdue: Math.round(explicitOverdue),
  outstandingOnly: Math.round(outstandingOnly),
  total: Math.round(inferredOverdue + explicitOverdue + outstandingOnly),
});

// Agency commission lines detail
const agency = mapped.filter(
  (d) => dealCommercialModel(d) === "agency_commission",
);
const book = buildAgencyCommissionBook(agency, []);
console.log("\n=== AGENCY OUTSTANDING LINES ===");
for (const l of book.outstandingLines.slice(0, 20)) {
  console.log(
    JSON.stringify({
      code: l.dealCode,
      label: l.label,
      usd: Math.round(l.amountUsd),
      status: l.status,
      due: l.dueDate,
    }),
  );
}

// Raw cottonsmiths money scoring dump
const rawCotton = raw.find(
  (r: { summary?: string; subject?: string }) =>
    `${r.summary || ""} ${r.subject || ""}`.includes("Cottonsmith") ||
    `${r.summary || ""}`.includes("1,319,048"),
);
if (rawCotton) {
  console.log("\n=== RAW COTTON ROW ===");
  console.log({
    id: rawCotton.id,
    slot: rawCotton.slot,
    subject: rawCotton.subject,
    summary: (rawCotton.summary || "").slice(0, 800),
    po: rawCotton.po_numbers,
  });
}

const pay = buildPaymentScheduleReport(mapped);
console.log("\nFinance identity check OK", {
  buyer:
    Math.round(
      pay.buyerReceivedUsd + pay.buyerUpcomingUsd + pay.buyerOverdueUsd,
    ),
  lines: Math.round(
    pay.lines
      .filter((l) => l.side === "buyer")
      .reduce((a, l) => a + l.amountUsd, 0),
  ),
});
