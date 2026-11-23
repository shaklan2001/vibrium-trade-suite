/**
 * Debit-advice photos are queued as text for the Payment Reader, not as a vision document.
 *   npx tsx scripts/test-payment-image.ts
 */
import assert from "node:assert/strict";
import { wantsPaymentImageOcr } from "../src/lib/mail/ocr";
import { emailWithAdviceImage, paymentRowFor } from "../src/lib/mail/paymentJobs";
import { paymentInlineImage } from "../src/lib/mail/payments";
import type { StoredMailMessage } from "../src/lib/mail/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const advice = {
  name: "image001.png",
  sha256: "abc123",
  size: 80_000,
  content_type: "image/png",
  ext: ".png",
  inline: true,
  s3_key: "trade/pst-ingest/abc123/image001.png",
};

test("a large inline advice image is kept; a logo is not", () => {
  assert.equal(paymentInlineImage([advice])?.sha256, "abc123");
  assert.equal(paymentInlineImage([{ ...advice, size: 2_000 }]), null);
  assert.equal(wantsPaymentImageOcr(advice), true);
  assert.equal(wantsPaymentImageOcr({ ...advice, inline: false }), false);
});

test("an advice-of-debit mail queues OCR text instead of a document url", () => {
  const mail = {
    connection_id: "c1",
    provider_message_id: "m1",
    internet_message_id: "<advice@bank>",
    deal_key: "po:14946",
    subject: "FW: ADVICE OF DEBIT - BANK CONFIDENTIAL",
    from_email: "accounts@lovingpetsproducts.com",
    from_name: "Accounts",
    to_text: "pay@snspl.in",
    cc_text: "",
    sent_at: "2026-11-01T00:00:00.000Z",
    body_text: "Please find the debit advice.",
    attachments_json: [advice],
    status: "ingested",
  } as StoredMailMessage;
  const row = paymentRowFor(mail, "pay@snspl.in");
  assert.ok(row);
  assert.equal(row!.input?.s3_key, null);
  assert.equal(row!.input?.ocr_sha256, "abc123");
  assert.equal(row!.attachment, "image001.png");
});

test("OCR text is appended once", () => {
  const once = emailWithAdviceImage("Subject: advice", "USD 14360.43");
  assert.match(once, /USD 14360\.43/);
  assert.equal(emailWithAdviceImage(once, "USD 14360.43"), once);
});

console.log(`\n${passed} passed`);
