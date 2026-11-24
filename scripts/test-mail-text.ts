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

test("quoted history: indented, glued, Date/To headers and forwards are cut; the new message stays", () => {
  const yahoo = "Dear Mam, thanks for the new PO.\nTanuj\n\n    On Monday, September 14, 2026 at 03:20:22 PM GMT+5:30, kalpana@snspl.in <kalpana@snspl.in> wrote:  \n\nDear Tanuj Ji, old text";
  assert.equal(freshText(yahoo, "Re: PO"), "Dear Mam, thanks for the new PO.\nTanuj");
  const glued = "Hope you understand now.\n\nBest regards,\nKalpana\n\nBUFFALO JFP GROUP LTDFrom: Narsi Rajput <narsi@icl-india.com> \nSent: 17 September 2026 11:01\nTo: nimisha@snspl.in\nold";
  assert.ok(!/From:/.test(freshText(glued, "RE: shipment")));
  const fromTo = "Kindly confirm once received.\n\nFrom:  <swinder@snspl.in>\nTo: radha@snspl.in\nCc: x\nold thread";
  assert.equal(freshText(fromTo, "Re: Cost"), "Kindly confirm once received.");
  const route = "Rates below.\nFrom: Delhi\nTo: Moradabad\nUSD 3.75/KG";
  assert.ok(freshText(route, "Rates").includes("Moradabad"));
  const fw = "FYI\n\nFrom: Buyer <b@x.com>\nSent: 1 Nov 2026\nTo: us@snspl.in\nSubject: PO 0031\n\nPlease find PO 0031 attached, 500 pcs.\n\nFrom: Us <us@snspl.in>\nSent: 30 Oct 2026\nTo: b@x.com\nolder history";
  const kept = freshText(fw, "Fwd: Purchase Order PO-0031");
  assert.ok(kept.includes("Please find PO 0031 attached") && !kept.includes("older history"));
});

console.log(`\n${passed} passed`);
