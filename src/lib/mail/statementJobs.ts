/**
 * Bank statements in the product: statement mails kept at sync (isBankStatementMail) are parsed,
 * the lines that belong to trade are matched to payment emails, POs and SNSPL's commission
 * invoices, and saved as mail_records kind `bank_line`, so the payment ledger can show
 * "confirmed in bank".
 *
 * Only trade lines are stored (remittances, commission, and credits/debits with a buyer, factory or
 * forwarder in the book). Salary, loan, tax, card and personal lines are counted and dropped,
 * never stored. Server only; every step fails soft.
 */
import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getCopilotBook } from "@/lib/trade/copilot/book";
import { buildInvoiceRegister, commissionInvoices } from "@/lib/trade/invoiceRegister";
import { isBankStatementMail, matchStatement, parseFinacleStatement, type BankLine } from "./bankStatement";
import { attachmentBucket } from "./parse";
import type { MailStore } from "./store";
import type { StoredAttachment } from "./types";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
let s3: S3Client | null = null;
const client = () => (s3 ||= new S3Client({ region: REGION }));

export type BankLineRecord = {
  date: string;
  kind: string;
  amountInr: number;
  reference: string | null;
  /** Clipped counterparty text, trade lines only. */
  particulars: string;
  emailId: string | null;
  emailHow: string | null;
  pos: string[];
  poHow: string | null;
  invoiceNo: string | null;
};

const lineId = (l: BankLine) => createHash("sha1").update(`${l.account}|${l.date}|${l.debit}|${l.credit}|${l.particulars}`).digest("hex").slice(0, 24);

async function readStatement(a: StoredAttachment): Promise<string | null> {
  if (!a.s3_key) return null;
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: attachmentBucket(), Key: a.s3_key }));
    return Buffer.from(await res.Body!.transformToByteArray()).toString("utf8");
  } catch {
    return null;
  }
}

/** Parse new statements, keep and match their trade lines. Returns counts only. */
export async function processStatements(store: MailStore, opts: { deadline: number }) {
  const out = { statements: 0, tradeLines: 0, stored: 0, dropped: 0 };
  const recent = await store.recentMessages({ limit: 600 });
  const statements = recent.filter((m) => isBankStatementMail(m.from_email, m.subject) && (m.attachments_json || []).some((a) => a.s3_key));
  if (!statements.length) return out;
  const known = new Set((await store.listRecords({ kind: "bank_line", limit: 5000 })).map((r) => r.id));
  const book = await getCopilotBook();
  const partyNames = [
    ...new Set(
      book.deals
        .flatMap((d) => [...d.parties.filter((p) => p.role !== "agency").map((p) => p.company || p.name), d.po?.buyer, d.po?.factory, d.pi?.factory, d.pi?.buyer])
        .filter((n): n is string => Boolean(n && n.length > 3)),
    ),
  ];
  const entries = await store.listPayments({ limit: 5000 });
  const inputOf = new Map(entries.map((e) => [e.id, e.input?.email_text || ""]));
  const refText = (e: { id: string; subject: string; attachment: string | null; reference: string | null; summary: string | null }) =>
    `${e.subject} ${e.attachment || ""} ${e.reference || ""} ${e.summary || ""} ${inputOf.get(e.id) || ""}`;
  const invoices = commissionInvoices(buildInvoiceRegister(book.deals)).map((e) => ({
    invoiceNo: e.invoiceNo,
    pos: e.pos,
    amount: e.amount,
    currency: e.currency,
    buyer: e.buyer,
    date: e.date,
  }));
  for (const mail of statements) {
    if (Date.now() > opts.deadline) break;
    for (const att of (mail.attachments_json || []).filter((a) => a.s3_key && /\.html?$/i.test(a.name))) {
      const html = await readStatement(att);
      if (!html) continue;
      const lines = parseFinacleStatement(html);
      if (!lines.length) continue;
      out.statements += 1;
      const fresh = lines.filter((l) => !known.has(lineId(l)));
      const matches = matchStatement(fresh, entries, refText, partyNames, invoices);
      out.tradeLines += matches.length;
      out.dropped += fresh.length - matches.length;
      const rows = matches.map((m) => {
        const data: BankLineRecord = {
          date: m.line.date,
          kind: m.line.kind,
          amountInr: m.line.credit || -m.line.debit,
          reference: m.line.reference ?? null,
          particulars: m.line.particulars.slice(0, 120),
          emailId: m.email?.id ?? null,
          emailHow: m.email?.how ?? null,
          pos: m.pos,
          poHow: m.poHow,
          invoiceNo: m.invoice?.invoiceNo ?? null,
        };
        known.add(lineId(m.line));
        return { kind: "bank_line" as const, id: lineId(m.line), dealKey: null, data: data as unknown as Record<string, unknown>, createdAt: new Date(`${m.line.date}T00:00:00Z`).toISOString() };
      });
      if (rows.length) await store.upsertRecords(rows);
      out.stored += rows.length;
    }
  }
  return out;
}
