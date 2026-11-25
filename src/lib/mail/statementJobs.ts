/**
 * Bank statements in the product: statement mails kept at sync (isBankStatementMail) are parsed,
 * the lines that belong to trade are matched to payment emails, POs and SNSPL's commission
 * invoices, and saved as mail_records kind `bank_line`, so the payment ledger can show
 * "confirmed in bank".
 *
 * Only trade lines are stored (remittances, commission, and credits/debits with a buyer, factory or
 * forwarder in the book). Salary, loan, tax, card and personal lines are counted and dropped,
 * never stored. An uploaded file is kept in S3 with the other documents and linked from its lines. Server only; every step fails soft.
 */
import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getCopilotBook } from "@/lib/trade/copilot/book";
import { buildInvoiceRegister, commissionInvoices } from "@/lib/trade/invoiceRegister";
import { isBankStatementMail, matchStatement, parseFinacleStatement, type BankLine, type CommissionInvoice } from "./bankStatement";
import { attachmentBucket } from "./parse";
import type { MailRecord, MailStore } from "./store";
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
  /** Remitter (credit) or beneficiary (debit) named on a bank advice. */
  party?: string | null;
  /** What the payer sent before bank charges (advices); amountInr is what reached the account. */
  gross?: number | null;
  charges?: { currency: string; amount: number } | null;
  /** Set when someone matched the line to a deal (see src/lib/mail/bankReconcile.ts). */
  reconciled?: BankReconciliation | null;
  updateId?: string | null;
  /** The uploaded advice / statement in S3 ({prefix}/{sha256}/{name}, opened via /api/ingest-files). */
  file?: { name: string; sha256: string } | null;
};

export type BankReconciliation = {
  status: "recorded" | "ignored";
  dealKey: string | null;
  dealId: string | null;
  dealCode: string | null;
  href: string | null;
  po: string | null;
  side: string | null;
  amount: number | null;
  by: string;
  at: string;
};

const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : NaN);

/** Payer, gross and charges, as parseBankAdvice writes them into the particulars. */
export function adviceFields(particulars: string) {
  const party = /\b(?:FROM|TO) (.+?)(?= VIA | \/| REF |$)/.exec(particulars)?.[1]?.trim() || null;
  const g = /\bGROSS ([A-Z]{3}) ([\d,]+(?:\.\d+)?)/.exec(particulars);
  const c = /\bLESS COSTS ([A-Z]{3}) ([\d,]+(?:\.\d+)?)/.exec(particulars);
  return {
    party,
    gross: g && Number.isFinite(num(g[2])) ? num(g[2]) : null,
    charges: c && Number.isFinite(num(c[2])) ? { currency: c[1]!, amount: num(c[2]) } : null,
  };
}

/**
 * The same payment uploaded again must not be stored twice. A line with a bank reference (every
 * advice has one) is the same payment when reference, date and amount match, however its text was
 * read (OCR, a better parser); a line without one falls back to its full text.
 */
export function refKey(reference: string | null | undefined, date: string, amount: number): string | null {
  return reference ? `${reference.toUpperCase()}|${date}|${Math.round(Math.abs(amount) * 100)}` : null;
}
export const lineId = (l: BankLine) => {
  const k = refKey(l.reference, l.date, l.credit || l.debit);
  return createHash("sha1")
    .update(k ? `ref|${k}` : `${l.account}|${l.date}|${l.debit}|${l.credit}|${l.particulars}`)
    .digest("hex")
    .slice(0, 24);
};

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
  /** Stored lines by id, to fill in fields that older uploads did not keep. */
  stored: Map<string, MailRecord>;
  /** Stored lines by reference + date + amount (lines stored before ids were reference-based). */
  byRef: Map<string, string>;
  partyNames: string[];
  entries: Awaited<ReturnType<MailStore["listPayments"]>>;
  refText: (e: { id: string; subject: string; attachment: string | null; reference: string | null; summary: string | null }) => string;
  invoices: CommissionInvoice[];
};

/** What matching needs: lines already stored, party names, payment emails, commission invoices. */
export async function loadMatchContext(store: MailStore): Promise<MatchContext> {
  const storedRows = await store.listRecords({ kind: "bank_line", limit: 5000 });
  const known = new Set(storedRows.map((r) => r.id));
  const stored = new Map(storedRows.map((r) => [r.id, r]));
  const byRef = new Map<string, string>();
  for (const r of storedRows) {
    if (r.data.duplicateOf) continue;
    const k = refKey(r.data.reference as string | null, String(r.data.date), Number(r.data.amountInr) || 0);
    if (k && !byRef.has(k)) byRef.set(k, r.id);
  }
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
  return { known, stored, byRef, partyNames, entries, refText, invoices };
}

/** Match the trade lines of one statement and store them. Salary, loan, tax, card and personal lines are counted and dropped. */
export async function storeStatementLines(
  store: MailStore,
  lines: BankLine[],
  ctx: MatchContext,
  source: "mail" | "upload",
  file: { name: string; sha256: string } | null = null,
) {
  /** The stored line this one is (by id, or by reference + date + amount), if any. */
  const existing = (l: BankLine) => {
    const id = lineId(l);
    if (ctx.known.has(id)) return id;
    const k = refKey(l.reference, l.date, l.credit || l.debit);
    return (k && ctx.byRef.get(k)) || null;
  };
  const seen = lines.map(existing);
  const fresh = lines.filter((_, i) => !seen[i]);
  const matches = matchStatement(fresh, ctx.entries, ctx.refText, ctx.partyNames, ctx.invoices);
  const rows = matches.map((m) => {
    const data: BankLineRecord = {
      date: m.line.date,
      kind: m.line.kind,
      amountInr: m.line.credit || -m.line.debit,
      reference: m.line.reference ?? null,
      particulars: m.line.particulars.slice(0, 240),
      emailId: m.email?.id ?? null,
      emailHow: m.email?.how ?? null,
      pos: m.pos,
      poHow: m.poHow,
      invoiceNo: m.invoice?.invoiceNo ?? null,
      currency: m.line.currency || "INR",
      source,
      ...adviceFields(m.line.particulars),
      reconciled: null,
      updateId: null,
      file,
    };
    ctx.known.add(lineId(m.line));
    const k = refKey(m.line.reference, m.line.date, m.line.credit || m.line.debit);
    if (k) ctx.byRef.set(k, lineId(m.line));
    return { kind: "bank_line" as const, id: lineId(m.line), dealKey: null, data: data as unknown as Record<string, unknown>, createdAt: new Date(`${m.line.date}T00:00:00Z`).toISOString() };
  });
  // Uploaded again: a line stored before payer / gross / the file were kept gets them now (its match is untouched).
  const refreshed = lines.flatMap((l, i) => {
    const old = seen[i] ? ctx.stored.get(seen[i]!) : undefined;
    if (!old) return [];
    const needFields = old.data.gross == null;
    const needFile = Boolean(file && !old.data.file);
    if (!needFields && !needFile) return [];
    const f = needFields ? adviceFields(l.particulars) : null;
    const fields = f && (f.gross != null || f.party) ? { ...f, particulars: l.particulars.slice(0, 240) } : {};
    return [{ kind: "bank_line" as const, id: old.id, dealKey: old.dealKey, data: { ...old.data, ...fields, ...(needFile ? { file } : {}) }, createdAt: old.createdAt }];
  });
  if (rows.length || refreshed.length) await store.upsertRecords([...rows, ...refreshed]);
  return {
    /** Every line of this file that is a stored trade line (new or from an earlier upload). */
    ids: [...new Set(lines.map((l, i) => seen[i] || lineId(l)).filter((id) => ctx.known.has(id)))],
    lines: lines.length,
    alreadyStored: lines.length - fresh.length,
    tradeLines: matches.length,
    stored: rows.length,
    dropped: fresh.length - matches.length,
    matchedToEmail: matches.filter((m) => m.email).length,
    matchedToPo: matches.filter((m) => m.pos.length).length,
    trade: matches.map((m) => ({
      id: lineId(m.line),
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
