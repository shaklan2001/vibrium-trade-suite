/**
 * Pure logic added for the mail-intelligence plan: normalising, invoice register, learned roles,
 * greeting names, quote requests, product history, sailing dates, figure verification,
 * commission-invoice matching and next-action detection.
 *   npx tsx scripts/test-mail-intelligence.ts
 */
import assert from "node:assert/strict";
import { matchCommissionInvoice, type BankLine } from "../src/lib/mail/bankStatement";
import { greetName } from "../src/lib/mail/greetName";
import type { InboxMessage } from "../src/lib/mail/inboxTypes";
import { learnRoles } from "../src/lib/mail/learnedRoles";
import { carriesOut } from "../src/lib/mail/nextAction";
import { isGenericQuoteRequest, quoteRequestItems } from "../src/lib/mail/quoteAssist";
import { buildInvoiceRegister, posForInvoice } from "../src/lib/trade/invoiceRegister";
import { isValidContainer, normContainer, normDate, normInvoiceNo, sameNumber, vagueDateWindow } from "../src/lib/trade/normalize";
import { buildProductIndex, productHistoryLines, searchProducts } from "../src/lib/trade/productHistory";
import { dealSailing, sailDateIn, sailingLabel } from "../src/lib/trade/sailing";
import { baselinePo, checkPo, poSanity } from "../src/lib/trade/poCheck";
import { verifyExtract } from "../src/lib/trade/verifyExtract";
import type { Deal } from "../src/types/trade";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const deal = (over: Record<string, unknown>) => ({ id: "d1", code: "PO-1", sources: [], parties: [], ...over }) as unknown as Deal;
const msg = (over: Partial<InboxMessage>): InboxMessage => ({
  id: "m", from: "a@x.com", fromName: "", to: "", cc: "", date: null, subject: "", body: "", attachments: [], internal: false, ...over,
});

test("container numbers: spaces and dashes ignored, check digit validated", () => {
  assert.equal(normContainer("msku 123456-7"), "MSKU1234567");
  assert.equal(isValidContainer("CSQU3054383"), true);
  assert.equal(isValidContainer("CSQU3054384"), false);
});

test("numbers within rounding are the same; dates in mail formats normalise", () => {
  assert.equal(sameNumber(29.7, 29.705), true);
  assert.equal(sameNumber(100, 120), false);
  assert.equal(normDate("13/11/2026"), "2026-11-13");
  assert.equal(normDate("13 Nov 2026"), "2026-11-13");
  assert.equal(normDate("Nov 13, 2026"), "2026-11-13");
  assert.equal(normDate("31/02/2026"), null);
  assert.deepEqual(vagueDateWindow("end of December", 2026), { from: "2026-12-21", to: "2026-12-31" });
});

test("invoice numbers: the 25-2 typo and spacing give one key", () => {
  assert.equal(normInvoiceNo("GP/25-26/040"), normInvoiceNo("gp 25-26 040"));
  assert.equal(normInvoiceNo("GP/25-2/040"), normInvoiceNo("GP/25-26/040"));
});

test("invoice register: subject carries invoice and PO; payment can name the invoice only", () => {
  const reg = buildInvoiceRegister([
    deal({ mailboxPoNumbers: ["14946"], sources: [{ id: "s", kind: "other", subject: "INVOICE NO. SWK/26-27/122 for PO# 14946", body: "" }] }),
  ]);
  assert.deepEqual(posForInvoice(reg, "swk/26-27/122"), ["14946"]);
  assert.deepEqual(posForInvoice(reg, "NOPE/1"), []);
});

test("learned roles: need two deals and 70% agreement; known and public domains skipped", () => {
  const obs = (dealKey: string, from: string, files: string[]) => ({ dealKey, from, subject: "", files });
  const roles = learnRoles(
    [
      obs("d1", "a@newbuyer.com", ["PO 1234.pdf"]),
      obs("d2", "b@newbuyer.com", ["Purchase Order 9.pdf"]),
      obs("d1", "c@onedeal.com", ["PO 5.pdf"]),
      obs("d1", "x@gmail.com", ["PO 7.pdf"]),
      obs("d2", "x@gmail.com", ["PO 8.pdf"]),
      obs("d1", "f@newfactory.in", ["PI-22.pdf"]),
      obs("d3", "f@newfactory.in", ["Proforma Invoice.pdf"]),
      obs("d1", "k@known.com", ["PO 1.pdf"]),
      obs("d2", "k@known.com", ["PO 2.pdf"]),
    ],
    (e) => e.endsWith("known.com"),
  );
  assert.equal(roles["newbuyer.com"], "buyer");
  assert.equal(roles["newfactory.in"], "factory");
  assert.equal(roles["onedeal.com"], undefined);
  assert.equal(roles["gmail.com"], undefined);
  assert.equal(roles["known.com"], undefined);
});

test("greeting: company sender takes the name from our earlier greeting or their signature", () => {
  const ours = msg({ internal: true, to: "export2@swastik.com", body: "Dear Narsi ji,\nPlease confirm." });
  const theirs = msg({ from: "export2@swastik.com", fromName: "Swastik Impex", body: "Confirmed.\n\nRegards,\nRamesh Patel\nSwastik Impex" });
  assert.equal(greetName(theirs, [ours, theirs]), "Narsi");
  assert.equal(greetName(theirs, [theirs]), "Ramesh");
  assert.equal(greetName(msg({ from: "john@buyer.com", fromName: "John Smith" }), []), "John");
});

test("quote requests: specific items found, generic request detected", () => {
  const specific = msg({ subject: "Quote request", body: "Please quote:\n- CHW-1042 dog bowl 500 pcs\n- Cotton leash 1000 pcs" });
  assert.equal(quoteRequestItems(specific.body).length >= 2, true);
  assert.equal(isGenericQuoteRequest(specific), false);
  assert.equal(isGenericQuoteRequest(msg({ subject: "Pricing", body: "Please send product details and pricing." })), true);
});

test("product history: code and words found, vendors grouped with last prices and record", () => {
  const d = deal({
    id: "d9",
    code: "PO-9",
    pi: {
      docType: "pi", factory: "Cottonsmiths", currency: "USD", sentAt: "2026-08-01T00:00:00Z", docNumber: "PI-1",
      lines: [{ itemCode: "CHW-1042", description: "Cotton dog leash 120cm", unitPrice: 1.2, qty: 500 }],
    },
  });
  const index = buildProductIndex([d]);
  const found = searchProducts(index, "cotton dog leash");
  assert.equal(found.vendors[0]?.vendor, "Cottonsmiths");
  assert.equal(found.vendors[0]?.lastPrices[0]?.unitPrice, 1.2);
  assert.equal(searchProducts(index, "CHW-1042").hits.length, 1);
  assert.equal(searchProducts(index, "steel water bottle").hits.length, 0);
  assert.ok(productHistoryLines(found)[0]!.includes("Cottonsmiths"));
});

test("sailing: date read from a bill of lading or a mail; agreed vs actual", () => {
  assert.equal(sailDateIn("Shipped on board: 13/11/2026 at Nhava Sheva"), "2026-11-13");
  assert.equal(sailDateIn("The vessel sailed on 13 Nov 2026."), "2026-11-13");
  const d = deal({ po: { docType: "po", readyDate: "2026-11-20", lines: [] } });
  const s = dealSailing(d, [{ id: "bl1", text: "Shipped on board 13/11/2026", date: "2026-11-14", kind: "document" }]);
  assert.equal(s.actualSail, "2026-11-13");
  assert.equal(s.daysVsAgreed, -7);
  assert.equal(sailingLabel(s), "Agreed 20 Nov · sailed 13 Nov (7 days early)");
  assert.equal(dealSailing(deal({})).actualSail, null);
});

test("verify: figures found in the file pass, invented ones are listed", () => {
  const text = "Proforma Invoice PI-77\nTotal USD 12,450.00\nQty 960 pcs @ 12.97\nReady 20/11/2026";
  const v = verifyExtract({ docNumber: "PI-77", totalAmount: 12450, readyDate: "2026-11-20", lines: [{ qty: 960, unitPrice: 12.97 }, { qty: 961 }] }, text);
  assert.deepEqual(v.unverified, ["lines[1].qty"]);
  assert.equal(v.checked, 6);
});

test("commission invoice: remittance naming the buyer links to the PO", () => {
  const line = { date: "2026-11-10", kind: "inward_remittance", credit: 297000, debit: 0, particulars: "GRS/H U T INTERNACIONAL SA DE CV/REMIT", account: "1", reference: null } as unknown as BankLine;
  const hit = matchCommissionInvoice(line, [
    { invoiceNo: "SNSPL/T/26-27/09", pos: ["14360"], amount: 297000, currency: "INR", buyer: "H U T Internacional SA de CV", date: "2026-11-01" },
  ]);
  assert.equal(hit?.invoiceNo, "SNSPL/T/26-27/09");
  assert.equal(matchCommissionInvoice(line, [{ invoiceNo: "X", pos: ["1"], amount: 5, currency: "INR", buyer: "Other Buyer Ltd", date: "2026-11-01" }]), null);
});

test("next action: an outgoing mail that repeats the action's words closes it", () => {
  assert.equal(carriesOut("Send the BL draft to the buyer for approval", "Dear John, please find the BL draft attached for your approval."), true);
  assert.equal(carriesOut("Send the BL draft to the buyer for approval", "Thanks, noted."), false);
});

const poDoc = (o: Record<string, unknown>) => ({ docType: "po", side: "buyer", docNumber: "14946", buyer: "Acme Inc", currency: "USD", totalAmount: 1000, pod: "Houston", lines: [{ itemCode: "BB-101", description: "Bamboo bowl", qty: 100, unitPrice: 6, amount: 600 }, { itemCode: "BB-102", description: "Bamboo tray", qty: 50, unitPrice: 8, amount: 400 }], ...o }) as never;

test("PO check: first buyer PO is the baseline, even when a later one is stored first", () => {
  const deal = { commercialDocs: [poDoc({ sentAt: "2026-11-10", docNumber: "14946-R1" }), poDoc({ sentAt: "2026-11-01" })] } as unknown as Deal;
  assert.equal(baselinePo(deal)?.docNumber, "14946");
});

test("PO sanity: line math and total are checked", () => {
  assert.equal(poSanity(poDoc({ sentAt: "2026-11-01" })).filter((i) => i.severity === "high").length, 0);
  const bad = poSanity(poDoc({ totalAmount: 1500, lines: [{ itemCode: "A1", qty: 10, unitPrice: 5, amount: 80 }] }));
  assert.ok(bad.some((i) => i.field === "lines[0].amount"));
  assert.ok(bad.some((i) => i.field === "totalAmount"));
  assert.ok(poSanity(poDoc({ totalAmount: undefined })).some((i) => i.message === "PO total missing"));
});

test("PO check: a factory PI that matches the PO raises nothing high", () => {
  const pi = poDoc({ docType: "pi", side: "factory", docNumber: "PI-77 for PO 14946", factory: "Bamboo Works", buyer: "Acme Inc", totalAmount: 800, sentAt: "2026-11-03", lines: [{ itemCode: "BB-101", qty: 100, unitPrice: 4.8, amount: 480 }, { itemCode: "BB-102", qty: 50, unitPrice: 6.4, amount: 320 }] });
  const c = checkPo({ commercialDocs: [poDoc({ sentAt: "2026-11-01" }), pi] } as unknown as Deal);
  assert.equal(c.hasHigh, false);
});

test("PO check: wrong quantity, missing line, dearer factory and wrong destination are flagged", () => {
  const pi = poDoc({ docType: "pi", side: "factory", pod: "Rotterdam", totalAmount: 1200, sentAt: "2026-11-03", lines: [{ itemCode: "BB-101", qty: 120, unitPrice: 6.5, amount: 780 }] });
  const c = checkPo({ commercialDocs: [poDoc({ sentAt: "2026-11-01" }), pi] } as unknown as Deal);
  const fields = c.comparisons[0]!.issues.map((i) => i.field);
  assert.ok(fields.includes("lines[0].qty"));
  assert.ok(fields.includes("lines[0].unitPrice"));
  assert.ok(fields.includes("lines[1]"));
  assert.ok(fields.includes("totalAmount"));
  assert.ok(fields.includes("pod"));
  assert.equal(c.hasHigh, true);
});

test("PO check: a later buyer PO is a revision against the first, not a new baseline", () => {
  const r = poDoc({ sentAt: "2026-11-09", docNumber: "14946", lines: [{ itemCode: "BB-101", description: "Bamboo bowl", qty: 150, unitPrice: 6, amount: 900 }, { itemCode: "BB-102", description: "Bamboo tray", qty: 50, unitPrice: 8, amount: 400 }], totalAmount: 1300 });
  const c = checkPo({ commercialDocs: [poDoc({ sentAt: "2026-11-01" }), r] } as unknown as Deal);
  assert.equal(c.comparisons[0]!.kind, "revision");
  assert.ok(c.comparisons[0]!.issues.some((i) => i.field === "lines[0].qty"));
});

test("PO check: US$ and USD are the same currency; a missing total is a data gap, not a warning", () => {
  const pi = poDoc({ docType: "pi", side: "factory", currency: "US$", totalAmount: 800, sentAt: "2026-11-03", lines: [{ itemCode: "BB-101", qty: 100, unitPrice: 4.8, amount: 480 }, { itemCode: "BB-102", qty: 50, unitPrice: 6.4, amount: 320 }] });
  const c = checkPo({ commercialDocs: [poDoc({ sentAt: "2026-11-01" }), pi] } as unknown as Deal);
  assert.ok(!c.all.some((i) => i.field === "currency"));
  assert.ok(poSanity(poDoc({ totalAmount: undefined })).every((i) => i.field !== "totalAmount" || i.gap === true));
});

console.log(`\n${passed} passed`);
