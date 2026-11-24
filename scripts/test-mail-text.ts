/**
 * Quoted history is stripped, and a short forward keeps the original.
 * Approval warnings close when the deal moves to the next step.
 *   npx tsx scripts/test-mail-text.ts
 */
import assert from "node:assert/strict";
import { freshText } from "../src/lib/mail/inbox";
import { mailSignals, type SignalMessage } from "../src/lib/mail/mailSignals";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("outlook from/sent block is stripped", () => {
  const body = "Please confirm the booking.\n\nFrom: Factory <a@factory.com>\nSent: Monday, 10 Nov 2026\nSubject: PO\n\nOld thread";
  assert.equal(freshText(body), "Please confirm the booking.");
});

test("a short forward keeps the original message", () => {
  const body = "FYI\n\n-----Original Message-----\nPlease pay invoice 040.";
  assert.match(freshText(body, "FW: invoice 040"), /Please pay invoice 040/);
});

test("gmail wrote line is stripped", () => {
  const body = "Noted, we will ship Friday.\n\nOn 12 Nov 2026, Buyer <b@buyer.com> wrote:\n> earlier ask";
  assert.equal(freshText(body), "Noted, we will ship Friday.");
});

function msg(patch: Partial<SignalMessage> & Pick<SignalMessage, "id" | "date" | "body">): SignalMessage {
  return {
    from: "buyer@example.com",
    fromName: "Buyer",
    internal: false,
    subject: "PO 14946",
    ...patch,
  };
}

test("approval stays open until someone approves", () => {
  const rows = mailSignals([
    msg({ id: "1", date: "2026-11-01T00:00:00.000Z", body: "Please approve the revised artwork." }),
  ]);
  assert.ok(rows.some((r) => r.kind === "approval_pending"));
});

test("a later booking confirmation closes the approval warning", () => {
  const rows = mailSignals([
    msg({ id: "1", date: "2026-11-01T00:00:00.000Z", body: "Please approve the revised artwork." }),
    msg({
      id: "2",
      date: "2026-11-02T00:00:00.000Z",
      from: "ops@snspl.in",
      fromName: "Ops",
      internal: true,
      body: "Booking confirmed with the line. Proceed with production.",
    }),
  ]);
  assert.equal(rows.some((r) => r.kind === "approval_pending"), false);
});

console.log(`\n${passed} passed`);
