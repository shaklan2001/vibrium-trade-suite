/**
 * Stage labels for live mail. Subjects are the ones the 8-criteria sheet
 * filed under the wrong stage (shipping as "other"/"pi_po", payment as "pi_po").
 *   npx tsx scripts/test-classify.ts
 */
import assert from "node:assert/strict";
import { preferredStage, stageForSlot } from "../src/lib/mail/agentStage";
import { stageOf } from "../src/lib/mail/classify";

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function expectStage(subject: string, stage: string, body = "") {
  assert.equal(stageOf(subject, body), stage, subject);
}

test("air waybill mail is booking, not other", () => {
  expectStage(
    "RE: NEW AIR SHIPMENT // DEL to LHR // SAFIA203919 // BUFFALO// awb no: 61563956734",
    "booking",
  );
});

test("surrender letter is booking even without a port name", () => {
  expectStage("REQ SURRENDER LETTER-HL-12345", "booking");
});

test("booking reference and BL number are booking, not other", () => {
  expectStage(
    "RE: WEOF26101499 / Bkg ref : 54679629 / BL : HLCUBO12610CDCN8 // AGRO FOOD",
    "booking",
  );
});

test("FCR with a PO number stays booking", () => {
  expectStage("INVOICE , PACKING LIST & FCR OF PO # 9032 , 9033 , 9035", "booking");
});

test("SOB confirmation with a PO number stays booking", () => {
  expectStage(
    "RE: SOB CONFIRMATION DO-49071045//LOVING PETS//PO:14945 // INV# SWK/26-27/114",
    "booking",
  );
});

test("stuffing date with a PO number stays booking", () => {
  expectStage(
    "FINAL INVOICE AND PACKING LSIT//LOVING PETS// 1X*40'FCL//PO:14881 //23rd october stuffing",
    "booking",
  );
});

test("a plain PO subject stays pi_po", () => {
  expectStage("RE: PO 8435 SAHIL INTERNATIONAL", "pi_po");
});

test("advice of debit is payment, not other", () => {
  expectStage("FW: ADVICE OF DEBIT - BANK CONFIDENTIAL", "payment");
});

test("arrange-payment shipment documents are payment, not pi_po", () => {
  expectStage(
    "FINAL SHIPMENT DOCUMENTS FOR PO# 14837// LOVING PETS",
    "payment",
    "Please arrange payment against the attached invoice.",
  );
});

test("misspelled payment request with a PO number is payment", () => {
  expectStage(
    "REQUEST FOR ARRAMGE PAYEMNT  AIR SHIPMENTS//INV# SWK/26-27/091// PO# G 2625101",
    "payment",
  );
});

test("a quote request without shipping terms stays a requirement", () => {
  expectStage("Please quote bamboo bowls, 5000 pcs", "requirement");
});

test("a confident booking worker overrides a PO keyword stage", () => {
  assert.equal(stageForSlot("booking_extractor"), "booking");
  assert.equal(
    preferredStage("pi_po", { slot: "booking_extractor", confidence: 0.8 }),
    "booking",
  );
});

test("a low-confidence worker does not override the keyword stage", () => {
  assert.equal(
    preferredStage("pi_po", { slot: "payment_clock", confidence: 0.4 }),
    "pi_po",
  );
});

test("a missing confidence keeps the keyword stage", () => {
  assert.equal(preferredStage("payment", { slot: "booking_extractor", confidence: null }), "payment");
});

console.log(`\n${passed} passed`);
