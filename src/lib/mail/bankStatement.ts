/**
 * Bank statements (ICICI / Finacle e-statements mailed as HTML) → transactions, and the
 * three-way match: statement line ↔ payment email ↔ PO.
 *
 *   statement line → payment email: the bank reference on the line (e.g. inward remittance
 *                    0364GRSK26036652) appears in a payment email / its advice attachment;
 *                    otherwise same amount (±1%) and currency within 10 days.
 *   statement line → PO:            through the matched email's POs, or a PO / invoice number
 *                    written in the line itself.
 * Client-safe and pure.
 */
import { normPo, type PaymentEntry } from "./payments";

export type BankLineKind =
  | "inward_remittance"
  | "trade_credit"
  | "trade_debit"
  | "commission"
  | "payroll"
  | "loan_emi"
  | "tax"
  | "card"
  | "charges"
  | "other";

export type BankLine = {
  account: string;
  date: string;
  valueDate: string | null;
  cheque: string | null;
  particulars: string;
  debit: number;
  credit: number;
  balance: number | null;
  kind: BankLineKind;
  /** Bank reference for remittances (GRS/…), UTR or transfer id when present. */
  reference: string | null;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function isoDay(s: string) {
  const a = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (a) return `${a[3]}-${MONTHS[a[2]!.toLowerCase()]}-${a[1]!.padStart(2, "0")}`;
  const b = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s.trim());
  if (b) return `${b[3]}-${b[2]!.padStart(2, "0")}-${b[1]!.padStart(2, "0")}`;
  return null;
}

const amount = (s: string) => {
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function decode(s: string) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Payroll / loans / tax / cards / bank charges stay out of trade matching (and out of reports). */
export function classifyBankLine(p: string, debit: number, credit: number): BankLineKind {
  const t = p.toUpperCase();
  if (/^GRS\//.test(t) && credit > 0) return "inward_remittance";
  if (/SLAB [CS]GST|CHARGES|CHGS|COMMISSION CHG|GST ON/.test(t)) return "charges";
  if (/COMISSION|COMMISSION/.test(t) && credit > 0) return "commission";
  if (/AUTO LOAN|EMI\b|LOAN/.test(t)) return "loan_emi";
  if (/DTAX|GST PAYMENT|TDS|INCOME TAX|CBDT|GIB\//.test(t)) return "tax";
  if (/\bVISA\b|PAVC|CREDIT CARD|CC PAYMENT/.test(t)) return "card";
  if (/SALARY|^TRF\/[A-Z .]+\/ICI$/.test(t)) return "payroll";
  if (credit > 0) return "trade_credit";
  if (debit > 0) return "trade_debit";
  return "other";
}

function referenceOf(p: string) {
  const grs = /\b(\d{4}GRS[A-Z]\d{8})\b/i.exec(p);
  if (grs) return grs[1]!.toUpperCase();
  const inft = /\/(?:INFT|NEFT|RTGS|IMPS)\/([A-Z0-9]{8,})/i.exec(p);
  if (inft) return inft[1]!.toUpperCase();
  return null;
}

/** Finacle HTML e-statement (Account Number | Tran Date | Value Date | Cheque No | Particulars | Dr | Cr | Balance | Branch). */
export function parseFinacleStatement(html: string): BankLine[] {
  const out: BankLine[] = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(decode);
    if (cells.length < 8 || /^account number$/i.test(cells[0]!)) continue;
    const [account, tran, value, cheque, particulars, dr, cr, bal] = cells as [string, string, string, string, string, string, string, string];
    const date = isoDay(tran);
    if (!date || /^B\/F$/i.test(particulars)) continue;
    const debit = amount(dr);
    const credit = amount(cr);
    out.push({
      account,
      date,
      valueDate: isoDay(value),
      cheque: cheque || null,
      particulars,
      debit,
      credit,
      balance: bal ? amount(bal) : null,
      kind: classifyBankLine(particulars, debit, credit),
      reference: referenceOf(particulars),
    });
  }
  return out;
}

/** A bank's account-statement mail (kept even though it is not a deal mail). */
export function isBankStatementMail(from: string | null | undefined, subject: string | null | undefined) {
  const f = (from || "").toLowerCase();
  const s = subject || "";
  const bank = /(\.bank\.in|icicibank|hdfcbank|axisbank|sbi\.co\.in|kotak|yesbank|indusind|citi|hsbc|bank)/.test(f);
  return bank && (/(stmt|statement)/.test(f) || /\b(account statement|e-?statement|statement of account)\b/i.test(s));
}

export const TRADE_KINDS = new Set<BankLineKind>(["inward_remittance", "trade_credit", "trade_debit", "commission"]);

const NAME_STOP = new Set(["pvt", "private", "ltd", "limited", "llc", "inc", "co", "corp", "corporation", "the", "and", "india", "sa", "de", "cv", "s", "a"]);
const nameTokens = (s: string) => (s.toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !NAME_STOP.has(w));

/**
 * Is this line with a trade party? Remittances and commission are; other credits / debits only
 * when the counterparty matches a buyer, factory or forwarder in the book (staff transfers,
 * UPI receipts and vendors outside the book are not trade lines).
 */
export function isTradeLine(line: BankLine, partyNames: string[]) {
  if (line.kind === "inward_remittance" || line.kind === "commission") return true;
  if (line.kind !== "trade_credit" && line.kind !== "trade_debit") return false;
  const words = new Set(nameTokens(line.particulars));
  return partyNames.some((n) => {
    const t = nameTokens(n);
    return t.length > 0 && t.filter((w) => words.has(w)).length >= Math.min(2, t.length);
  });
}

export type BankMatch = {
  line: BankLine;
  email: { id: string; subject: string; how: "reference" | "amount_date"; kind: string | null } | null;
  pos: string[];
  poHow: "email" | "line" | null;
};

const DAY = 86_400_000;

/**
 * Match trade statement lines to payment emails and POs. `refText` gives, per payment email,
 * the text to search for the bank reference (subject + attachment names + summary).
 */
export function matchStatement(
  lines: BankLine[],
  entries: PaymentEntry[],
  refText: (e: PaymentEntry) => string,
  partyNames: string[],
): BankMatch[] {
  const money = entries.filter((e) => e.status === "done" && e.kind && e.kind !== "other");
  return lines
    .filter((l) => isTradeLine(l, partyNames))
    .map((line) => {
      const amt = line.credit || line.debit;
      let email: BankMatch["email"] = null;
      if (line.reference) {
        const hit = money.find((e) => refText(e).toUpperCase().includes(line.reference!));
        if (hit) email = { id: hit.id, subject: hit.subject, how: "reference", kind: hit.kind };
      }
      if (!email) {
        const t = Date.parse(line.date);
        const hit = money.find(
          (e) =>
            e.amount != null &&
            (!e.currency || e.currency === "INR") &&
            Math.abs(e.amount - amt) <= Math.max(1, amt * 0.01) &&
            Math.abs(Date.parse(e.valueDate || e.mailDate) - t) <= 10 * DAY,
        );
        if (hit) email = { id: hit.id, subject: hit.subject, how: "amount_date", kind: hit.kind };
      }
      let pos: string[] = [];
      let poHow: BankMatch["poHow"] = null;
      const matched = email ? money.find((e) => e.id === email!.id) : undefined;
      if (matched) {
        pos = [...new Set(matched.allocations.map((a) => a.po).filter((p): p is string => Boolean(p)).map(normPo))];
        if (pos.length) poHow = "email";
      }
      if (!pos.length) {
        const inLine = [...line.particulars.matchAll(/\bPO[#\s:-]*([A-Z]?\s?\d{4,})/gi)].map((m) => normPo(m[1]!));
        if (inLine.length) {
          pos = [...new Set(inLine)];
          poHow = "line";
        }
      }
      return { line, email, pos, poHow };
    });
}
