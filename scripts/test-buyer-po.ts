/**
 * Buyer order value stays on the PO when a later invoice is also on the deal.
 *   npx tsx scripts/test-buyer-po.ts
 */
import assert from "node:assert/strict";
import { buyerOrderDocument } from "../src/lib/trade/processedDealMapper";
import type { CommercialDocument } from "../src/types/trade";

function doc(patch: Partial<CommercialDocument> & Pick<CommercialDocument, "docType" | "fileName">): CommercialDocument {
  return { lines: [], totalAmount: 0, side: "buyer", ...patch };
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("a buyer PO keeps its amount when a newer invoice is present", () => {
  const chosen = buyerOrderDocument([
    doc({ docType: "pi", fileName: "INV-040.pdf", totalAmount: 4100, sentAt: "2026-11-20" }),
    doc({ docType: "po", fileName: "PO-14946.pdf", totalAmount: 3900, sentAt: "2026-10-01" }),
  ]);
  assert.equal(chosen?.totalAmount, 3900);
  assert.equal(chosen?.docType, "po");
});

test("two buyer POs add up", () => {
  const chosen = buyerOrderDocument([
    doc({ docType: "po", fileName: "PO-1.pdf", docNumber: "1", totalAmount: 100 }),
    doc({ docType: "po", fileName: "PO-2.pdf", docNumber: "2", totalAmount: 40 }),
  ]);
  assert.equal(chosen?.totalAmount, 140);
});

test("no buyer PO means the caller keeps the invoice total", () => {
  assert.equal(
    buyerOrderDocument([doc({ docType: "pi", fileName: "INV.pdf", totalAmount: 50 })]),
    undefined,
  );
});

console.log(`\n${passed} passed`);
