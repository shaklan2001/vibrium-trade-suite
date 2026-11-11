/**
 * Early-warning rules. Clock is fixed at noon IST on 2026-11-11.
 *   npx tsx scripts/smoke-early-warnings.ts
 */
import assert from "node:assert/strict";
import { collectEarlyWarnings } from "../src/lib/trade/earlyWarnings";
import type { Deal } from "../src/types/trade";

const NOW = Date.parse("2026-11-11T06:30:00.000Z");

function day(offset: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(NOW + offset * 86400000));
}

function deal(patch: Partial<Deal> & Pick<Deal, "id">): Deal {
  return {
    code: patch.id,
    title: patch.id,
    stage: "docs_payment",
    createdAt: day(-30),
    updatedAt: day(-1),
    parties: [],
    documents: [],
    sources: [],
    timeline: [],
    outreach: [],
    commercialModel: "agency_commission",
    ...patch,
  };
}

function kinds(rows: { dealId: string | null; kind: string }[], id: string) {
  return rows.filter((r) => r.dealId === id).map((r) => r.kind);
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const book = [
  deal({
    id: "overdue",
    po: { totalAmount: 1000, currency: "USD" },
    payment: { status: "overdue", dueDate: day(-10), currency: "USD" },
  }),
  deal({
    id: "freight",
    payment: { status: "overdue", dueDate: day(-3), currency: "USD" },
    economics: {
      commercialValueUsd: 0,
      agencyCommissionUsd: 0,
      cycleDaysTypical: 60,
      cycleDaysElapsed: 1,
      commercialCashAtRiskUsd: 0,
      agencyCashAtRiskUsd: 0,
      agencyInflowNext14dUsd: 0,
      riskRewardRatio: 1,
      affordability: "comfortable",
      liquidityNote: "Local charges only",
      sources: [],
    },
  }),
  deal({
    id: "due-soon",
    po: { totalAmount: 500, currency: "USD" },
    payment: { status: "pending", dueDate: day(3), currency: "USD" },
  }),
  deal({
    id: "due-later",
    po: { totalAmount: 500, currency: "USD" },
    payment: { status: "pending", dueDate: day(30), currency: "USD" },
  }),
  deal({
    id: "late-ship",
    po: { totalAmount: 800, currency: "USD" },
    payment: { status: "pending", currency: "USD" },
    booking: { eta: day(-5), shipmentStatus: "arrived" },
  }),
  deal({
    id: "old-arrived",
    po: { totalAmount: 800, currency: "USD" },
    payment: { status: "paid", currency: "USD" },
    booking: { eta: day(-400), shipmentStatus: "arrived" },
  }),
  deal({
    id: "agency-gap",
    po: { totalAmount: 1100, currency: "USD" },
    pi: { totalAmount: 1000, currency: "USD" },
    sources: [{ id: "m", kind: "po", body: "", receivedAt: day(-10) }],
  }),
  deal({
    id: "trader-gap",
    commercialModel: "trader_principal",
    po: { totalAmount: 1200, currency: "USD" },
    pi: { totalAmount: 1000, currency: "USD" },
    sources: [{ id: "m", kind: "po", body: "", receivedAt: day(-10) }],
  }),
  deal({
    id: "old-gap",
    po: { totalAmount: 1100, currency: "USD" },
    pi: { totalAmount: 1000, currency: "USD" },
    sources: [{ id: "m", kind: "po", body: "", receivedAt: day(-200) }],
  }),
  deal({
    id: "cutoff-words",
    booking: { cutOffs: "please confirm", etd: day(5) },
  }),
  deal({
    id: "cutoff-tomorrow",
    booking: { cutOffs: "SI cut-off tomorrow", etd: day(5) },
    sources: [{ id: "m", kind: "booking", body: "", receivedAt: day(0) }],
  }),
  deal({
    id: "docs-soon",
    booking: { etd: day(3) },
    docsPack: { required: ["BL"], present: [], missing: ["BL"], complete: false },
  }),
  deal({
    id: "docs-far",
    booking: { etd: day(90) },
    docsPack: { required: ["BL"], present: [], missing: ["BL"], complete: false },
  }),
  deal({
    id: "stalled",
    stage: "requirement",
    timeline: [{ id: "t", at: day(-400), label: "old", summary: "first mail" }],
  }),
  deal({
    id: "both",
    po: { totalAmount: 900, currency: "USD" },
    payment: { status: "overdue", dueDate: day(-2), currency: "USD" },
    booking: { eta: day(-5) },
  }),
  deal({
    id: "factory-only",
    po: { totalAmount: 400, currency: "USD" },
    payment: { status: "paid", dueDate: day(-20), currency: "USD" },
    paymentSchedule: {
      checkpoints: [
        {
          id: "c",
          side: "factory",
          label: "balance",
          amountUsd: 400,
          dueDate: day(-20),
          status: "overdue",
        },
      ],
    },
  }),
];

const rows = collectEarlyWarnings(book, { failedExtracts: 4, now: NOW });

test("overdue buyer amount is purchase-order risk", () => {
  assert.deepEqual(kinds(rows, "overdue"), ["po_risk"]);
});

test("freight-only overdue has no payment row", () => {
  assert.deepEqual(kinds(rows, "freight"), []);
});

test("pending due in 3 days is action needed", () => {
  assert.deepEqual(kinds(rows, "due-soon"), ["action_needed"]);
});

test("pending due in 30 days is quiet", () => {
  assert.deepEqual(kinds(rows, "due-later"), []);
});

test("arrival 5 days ago and unpaid is delivery risk even if marked arrived", () => {
  assert.deepEqual(kinds(rows, "late-ship"), ["delivery_risk"]);
});

test("paid arrival 400 days ago is quiet", () => {
  assert.deepEqual(kinds(rows, "old-arrived"), []);
});

test("agency amount gap with recent mail warns; trader gap and old gap do not", () => {
  assert.ok(kinds(rows, "agency-gap").includes("po_risk"));
  assert.deepEqual(kinds(rows, "trader-gap"), []);
  assert.deepEqual(kinds(rows, "old-gap"), []);
});

test("cut-off without a date is quiet; tomorrow with a future sail warns", () => {
  assert.deepEqual(kinds(rows, "cutoff-words"), []);
  assert.deepEqual(kinds(rows, "cutoff-tomorrow"), ["action_needed"]);
});

test("missing docs near sailing warn; far sailing does not", () => {
  assert.deepEqual(kinds(rows, "docs-soon"), ["action_needed"]);
  assert.deepEqual(kinds(rows, "docs-far"), []);
});

test("first-email stall is not a warning", () => {
  assert.deepEqual(kinds(rows, "stalled"), []);
});

test("overdue plus a recent missed arrival is two rows", () => {
  assert.deepEqual(kinds(rows, "both").sort(), ["delivery_risk", "po_risk"]);
});

test("paid deal with only a factory checkpoint overdue is quiet", () => {
  assert.deepEqual(kinds(rows, "factory-only"), []);
});

test("failed extracts add one book row and do not drop deals", () => {
  const bookRow = rows.filter((r) => r.dealId === null);
  assert.equal(bookRow.length, 1);
  assert.equal(bookRow[0]?.href, "/mailbox");
  assert.ok(rows.some((r) => r.dealId === "overdue"));
  const none = collectEarlyWarnings(book, { failedExtracts: 0, now: NOW });
  assert.equal(none.filter((r) => r.dealId === null).length, 0);
});

test("failed-extract row stays ahead of deal rows", () => {
  assert.equal(rows[0]?.dealId, null);
});

console.log(`\n${passed} passed`);
