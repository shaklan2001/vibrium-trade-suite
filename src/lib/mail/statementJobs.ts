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
import { isBankStatementMail, matchStatement, parseFinacleStatement, type BankLine, type CommissionInvoice } from "./bankStatement";
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
  /** Account currency; amountInr holds the signed amount whatever the currency (kept for older rows). */
  currency?: string;
  /** "mail" = a statement mail attachment, "upload" = a file uploaded in the app. */
  source?: "mail" | "upload";
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

type MatchContext = {
  known: Set<string>;
  partyNames: string[];
  entries: Awaited<ReturnType<MailStore["listPayments"]>>;
  refText: (e: { id: string; subject: string; attachment: string | null; reference: string | null; summary: string | null }) => string;
  invoices: CommissionInvoice[];
};

/** What matching needs: lines already stored, party names, payment emails, commission invoices. */
export async function loadMatchContext(store: MailStore): Promise<MatchContext> {
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
  return { known, partyNames, entries, refText, invoices };
}

/** Match the trade lines of one statement and store them. Salary, loan, tax, card and personal lines are counted and dropped. */
export async function storeStatementLines(store: MailStore, lines: BankLine[], ctx: MatchContext, source: "mail" | "upload") {
  const fresh = lines.filter((l) => !ctx.known.has(lineId(l)));
  const matches = matchStatement(fresh, ctx.entries, ctx.refText, ctx.partyNames, ctx.invoices);
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
      currency: m.line.currency || "INR",
      source,
    };
    ctx.known.add(lineId(m.line));
    return { kind: "bank_line" as const, id: lineId(m.line), dealKey: null, data: data as unknown as Record<string, unknown>, createdAt: new Date(`${m.line.date}T00:00:00Z`).toISOString() };
  });
  if (rows.length) await store.upsertRecords(rows);
  return {
    lines: lines.length,
    alreadyStored: lines.length - fresh.length,
    tradeLines: matches.length,
    stored: rows.length,
    dropped: fresh.length - matches.length,
    matchedToEmail: matches.filter((m) => m.email).length,
    matchedToPo: matches.filter((m) => m.pos.length).length,
    trade: matches.map((m) => ({
      date: m.line.date,
      kind: m.line.kind,
      amount: m.line.credit || -m.line.debit,
      currency: m.line.currency || "INR",
      reference: m.line.reference ?? null,
      email: m.email ? { id: m.email.id, subject: m.email.subject, how: m.email.how } : null,
      pos: m.pos,
      poHow: m.poHow,
      invoiceNo: m.invoice?.invoiceNo ?? null,
    })),
  };
}

/** Parse new statements, keep and match their trade lines. Returns counts only. */
export async function processStatements(store: MailStore, opts: { deadline: number }) {
  const out = { statements: 0, tradeLines: 0, stored: 0, dropped: 0 };
  const recent = await store.recentMessages({ limit: 600 });
  const statements = recent.filter((m) => isBankStatementMail(m.from_email, m.subject) && (m.attachments_json || []).some((a) => a.s3_key));
  if (!statements.length) return out;
  const ctx = await loadMatchContext(store);
  for (const mail of statements) {
    if (Date.now() > opts.deadline) break;
    for (const att of (mail.attachments_json || []).filter((a) => a.s3_key && /\.html?$/i.test(a.name))) {
      const html = await readStatement(att);
      if (!html) continue;
      const lines = parseFinacleStatement(html);
      if (!lines.length) continue;
      out.statements += 1;
      const r = await storeStatementLines(store, lines, ctx, "mail");
      out.tradeLines += r.tradeLines;
      out.stored += r.stored;
      out.dropped += r.dropped;
    }
  }
  return out;
}
