/**
 * Bank statement parser (uploaded PDF text, Excel / CSV rows, Finacle HTML).
 *   npx tsx scripts/test-statement-parse.ts
 */
import assert from "node:assert/strict";
import { classifyBankLine } from "../src/lib/mail/bankStatement";
import { parseLooseDate, parseStatement } from "../src/lib/mail/statementParse";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

test("dates: the usual bank layouts, and a year taken from the statement", () => {
  assert.equal(parseLooseDate("03 Nov 2026"), "2026-11-03");
  assert.equal(parseLooseDate("03-Nov-26"), "2026-11-03");
  assert.equal(parseLooseDate("3/11/2026"), "2026-11-03");
  assert.equal(parseLooseDate("03.11.2026"), "2026-11-03");
  assert.equal(parseLooseDate("2026-11-03"), "2026-11-03");
  assert.equal(parseLooseDate("Nov 3 2026"), "2026-11-03");
  assert.equal(parseLooseDate("03 Nov", 2026), "2026-11-03");
  assert.equal(parseLooseDate("03 Nov"), null);
  assert.equal(parseLooseDate("31 Feb 2026"), null);
});

const PDF_RUNNING_BALANCE = `
HSBC  Account Statement
Account Number 112-325789-001   Currency: USD
Statement period 01 Nov 2026 to 18 Nov 2026
Date  Transaction details  Amount  Balance
03 Nov  BALANCE BROUGHT FORWARD   50,000.00
05 Nov  INWARD REMITTANCE  SWIFT REF ABCD12345678
        FROM H U T INTERNACIONAL SA DE CV   12,500.00   62,500.00
09 Nov  SALARY NOV  STAFF   8,000.00   54,500.00
12 Nov  PAYMENT TO NIRMAL POLY PLAST PVT LTD INV 122   4,200.50   50,299.50
18 Nov  SERVICE CHARGE   25.00   50,274.50
Page 1 of 1
`;

test("PDF text with a running balance: direction comes from the balance, wrapped narration is joined", () => {
  const p = parseStatement({ text: PDF_RUNNING_BALANCE });
  assert.equal(p.method, "text");
  assert.equal(p.currency, "USD");
  assert.equal(p.account, "…9001");
  assert.equal(p.lines.length, 4);
  const [a, b, c, d] = p.lines;
  assert.equal(a!.credit, 12500);
  assert.equal(a!.kind, "inward_remittance");
  assert.ok(a!.particulars.includes("INTERNACIONAL"));
  assert.equal(a!.reference, "ABCD12345678");
  assert.equal(b!.debit, 8000);
  assert.equal(c!.debit, 4200.5);
  assert.equal(d!.kind, "charges");
  assert.equal(a!.date, "2026-11-05");
});

test("PDF text, newest first, with CR / DR marks", () => {
  const t = `Statement 2026\nCurrency INR\n18 Nov 2026 NEFT CR ACME TRADING 1,50,000.00 CR\n02 Nov 2026 CHEQUE PAID 12,000.00 DR\n`;
  const p = parseStatement({ text: t });
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[0]!.date, "2026-11-02");
  assert.equal(p.lines[0]!.debit, 12000);
  assert.equal(p.lines[1]!.credit, 150000);
});

test("Excel / CSV: the header row names the columns (debit, credit, balance)", () => {
  const t = [
    "Account Statement | | | | |",
    "Txn Date | Value Date | Narration | Withdrawals | Deposits | Balance",
    "05/11/2026 | 05/11/2026 | GRS/H U T INTERNACIONAL/REMIT 0364GRSK26036652 |  | 1,338,169.49 | 2,000,000.00",
    "06/11/2026 | 06/11/2026 | TRF/SALARY NOV | 45,000.00 |  | 1,955,000.00",
  ].join("\n");
  const p = parseStatement({ text: t });
  assert.equal(p.method, "table");
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[0]!.credit, 1338169.49);
  assert.equal(p.lines[0]!.kind, "inward_remittance");
  assert.equal(p.lines[0]!.reference, "0364GRSK26036652");
  assert.equal(p.lines[1]!.debit, 45000);
  assert.equal(p.lines[1]!.kind, "payroll");
});

test("Excel / CSV: one Amount column with a Dr/Cr column", () => {
  const t = ["Date | Description | Amount | Dr/Cr | Balance", "01-Nov-2026 | TT IN BUYER LLC | 5,000.00 | CR | 9,000.00", "02-Nov-2026 | FREIGHT PAYMENT | 1,000.00 | DR | 8,000.00"].join("\n");
  const p = parseStatement({ text: t });
  assert.equal(p.lines[0]!.credit, 5000);
  assert.equal(p.lines[1]!.debit, 1000);
});

test("a line whose amount or direction cannot be placed is counted, not guessed", () => {
  const t = "Statement 2026\n05 Nov  MYSTERY ITEM 77.00\n06 Nov  INWARD REMITTANCE 10.00 110.00\n";
  const p = parseStatement({ text: t });
  assert.equal(p.lines.length, 1);
  assert.equal(p.skipped, 1);
});

test("Finacle HTML is still read by the existing parser", () => {
  const html = `<table><tr><td>Account Number</td></tr><tr><td>1234</td><td>06-Nov-2026</td><td>06-Nov-2026</td><td></td><td>GRS/H U T/REMIT 0364GRSK26036652</td><td>0.00</td><td>296873.00</td><td>1000000.00</td><td>x</td></tr></table>`;
  const p = parseStatement({ html, text: "" });
  assert.equal(p.method, "finacle_html");
  assert.equal(p.lines[0]!.credit, 296873);
});

test("the opening balance lets the first line be placed when the wording does not say", () => {
  const t = "Statement 2026\nCurrency USD\n03 Nov  BALANCE BROUGHT FORWARD   50,000.00\n09 Nov  SALARY NOV  STAFF   8,000.00   42,000.00\n12 Nov  EMI AUTO LOAN   1,200.50   40,799.50\n";
  const p = parseStatement({ text: t });
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[0]!.debit, 8000);
  assert.equal(p.lines[1]!.debit, 1200.5);
  assert.equal(p.skipped, 0);
});

// HSBC credit advice as pdf.js flattens it: two columns become "Label: Label:" with the values below,
// and page 2 repeats the values without labels.
const CREDIT_ADVICE = `
--- page 1
Page: 1
Date: 8 October 2026
ACME TRADING LIMITED
HONG KONG
Dear Customer
Credit Advice
Transaction reference: HK108106ABCDEFGH
We've credited your account with a telegraphic transfer / interbank fund transfer. Please see the details below:
Transaction date: 8 Oct 2026
Payment amount: USD10,970.00 Local charges: HKD65.00
Amount credited: USD10,961.70 Total charges: USD8.30
Credited account: 112-325048-838 (FCY)
Payer bank: Payment details :
HSBC BANK USA NA
NEW YORK
/URI/GP 25 26 070A 074A///ROC/GP 2
5 26 070A 074A
By order of : Bank to bank information:
BUYER IMPORTS SA DE CV
Beneficiary:
ACME TRADING LIMITED
Notes: The amount credited is subject to final settlement. If there are any additional charges, we will debit such
charges to your account and advise you regarding the same.
--- page 2
HK108106ABCDEFGH
USD10,970.00 HKD65.00
USD10,961.70 USD8.30
112-325048-838 (FCY)
Page: 2
Date: 8 October 2026
`;

test("HSBC credit advice PDF: one inward remittance with its reference, payer and payment details", () => {
  const p = parseStatement({ text: CREDIT_ADVICE });
  assert.equal(p.method, "advice");
  assert.equal(p.lines.length, 1);
  const l = p.lines[0]!;
  assert.equal(l.date, "2026-10-08");
  assert.equal(l.credit, 10961.7);
  assert.equal(l.debit, 0);
  assert.equal(l.currency, "USD");
  assert.equal(l.account, "…8838");
  assert.equal(l.kind, "inward_remittance");
  assert.equal(l.reference, "HK108106ABCDEFGH");
  assert.ok(l.particulars.includes("FROM BUYER IMPORTS SA DE CV"));
  assert.ok(l.particulars.includes("/ROC/GP 25 26 070A 074A"), l.particulars);
  assert.ok(l.particulars.includes("GROSS USD 10,970.00"));
});

test("two advices in one file are two lines; a debit advice is a payment out", () => {
  const debit = `Debit Advice\nTransaction reference: HK109001ZYXWVUTS\nTransaction date: 09/10/2026\nAmount debited: USD4,200.50\nDebited account: 112-325048-838\nBeneficiary:\nNIRMAL POLY PLAST PVT LTD\nNotes: x\n`;
  const p = parseStatement({ text: CREDIT_ADVICE + debit });
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[1]!.debit, 4200.5);
  assert.equal(p.lines[1]!.date, "2026-10-09");
  assert.equal(p.lines[1]!.kind, "trade_debit");
  assert.ok(p.lines[1]!.particulars.includes("TO NIRMAL POLY PLAST"));
});

test("an AI-read credit advice that mentions charges is still an inward remittance", () => {
  assert.equal(classifyBankLine("Credit advice: By order of BUYER IMPORTS SA DE CV via HSBC BANK USA NA. Amount credited after charges.", 0, 10961.7), "inward_remittance");
  assert.equal(classifyBankLine("SERVICE CHARGES OCT", 25, 0), "charges");
});

console.log(`\n${passed} passed`);
