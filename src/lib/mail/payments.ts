/**
 * Payment emails → ledger entries.
 *
 * Every mail that looks like a payment (received / paid / requested) is read once by the
 * Payment Reader worker (scripts/provision-payment-reader.mjs), together with its remittance
 * advice, TT copy, invoice or statement attachment. The result is one entry per mail:
 * kind, side, amount, date, bank reference and the POs / invoices it covers. Matching the
 * entries to orders happens in src/lib/trade/paymentLedger.ts. Client-safe (no I/O).
 */

export type PaymentKind = "payment_received" | "payment_sent" | "payment_request" | "other";
export type PaymentSide = "buyer" | "factory" | "freight" | "commission" | "other";

/** Ledger rows logged through Copilot from WhatsApp / calls (no email behind them). */
export const OFF_MAIL_CONNECTION = "offmail";
export const isOffMailEntry = (e: { id: string; connectionId?: string }) =>
  e.connectionId === OFF_MAIL_CONNECTION || e.id.startsWith("offmail:");

export type PaymentAllocation = { po: string | null; invoice: string | null; amount: number | null };

export type PaymentEntry = {
  /** Message id (internet Message-ID or sync ref) — one entry per payment email. */
  id: string;
  dealKey: string | null;
  connectionId: string;
  mailbox: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  mailDate: string;
  attachment: string | null;
  status: "pending" | "running" | "done" | "failed" | "not_payment";
  executionId: string | null;
  kind: PaymentKind | null;
  side: PaymentSide | null;
  payer: string | null;
  payee: string | null;
  amount: number | null;
  currency: string | null;
  valueDate: string | null;
  reference: string | null;
  allocations: PaymentAllocation[];
  summary: string | null;
  confidence: number | null;
  error: string | null;
  updatedAt: string;
};

const PAY_TEXT =
  /\b(payment|remittance|remitted|swift|mt ?103|tt copy|t\/t|wire transfer|credited|advice of (?:debit|credit)|debit (advice|note)|bank advice|utr|advance received|balance payment|proof of payment|payment advice|outstanding|dues?\b|statement of account|soa)\b/i;
const PAY_FILE = /(remit|advice|swift|mt103|\btt\b|payment|statement|ledger|\bdues?\b|soa|debit|receipt)/i;
const NOT_PAY = /\b(newsletter|unsubscribe|credit card|e-?statement|electricity bill|webinar)\b/i;

/** Cheap first pass: worth asking the Payment Reader about this mail? */
export function isPaymentCandidate(subject: string, text: string, attachments: string[]) {
  const head = `${subject} ${text.slice(0, 2500)}`;
  if (NOT_PAY.test(subject)) return false;
  return PAY_TEXT.test(head) || attachments.some((a) => PAY_FILE.test(a));
}

/** Formats the worker can read (legacy .xls / .doc are rejected by the document resolver). */
const DOC_EXT = /\.(pdf|xlsx|csv|docx|html?|jpe?g|png)$/i;

/** The attachment most likely to hold the payment details (advice / TT copy first, then invoices). */
export function pickPaymentAttachment<T extends { name: string; s3_key?: string; inline?: boolean }>(atts: T[]): T | null {
  const usable = atts.filter((a) => a.s3_key && !a.inline && DOC_EXT.test(a.name) && !/^image\d*\./i.test(a.name));
  const score = (n: string) =>
    /(remit|advice|swift|mt103|\btt\b|payment|receipt)/i.test(n) ? 3 : /(statement|ledger|dues?|soa)/i.test(n) ? 2 : /(inv|invoice|debit|bill)/i.test(n) ? 1 : 0;
  return usable.sort((a, b) => score(b.name) - score(a.name))[0] || null;
}

const PAYMENT_IMAGE_EXT = /\.(jpe?g|png|gif|tiff?|webp)$/i;
/** Logos and signatures are smaller than a photographed debit advice. */
export const PAYMENT_IMAGE_MIN_BYTES = 40 * 1024;

/** Inline image large enough to be a bank advice, already stored. */
export function paymentInlineImage<
  T extends { name: string; sha256?: string; s3_key?: string; inline?: boolean; size?: number; content_type?: string },
>(atts: T[]): T | null {
  return (
    atts.find(
      (a) =>
        Boolean(a.inline && a.s3_key && a.sha256) &&
        (a.size || 0) >= PAYMENT_IMAGE_MIN_BYTES &&
        (PAYMENT_IMAGE_EXT.test(a.name) || (a.content_type || "").startsWith("image/")),
    ) || null
  );
}

const KINDS = new Set<PaymentKind>(["payment_received", "payment_sent", "payment_request", "other"]);
const SIDES = new Set<PaymentSide>(["buyer", "factory", "freight", "commission", "other"]);

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, 200) : null);

/** Payment Reader output → the fields of an entry (defensive: the model may omit or mistype fields). */
export function parsePaymentResult(r: Record<string, unknown> | null) {
  const kind = KINDS.has(r?.kind as PaymentKind) ? (r!.kind as PaymentKind) : "other";
  const allocations: PaymentAllocation[] = (Array.isArray(r?.allocations) ? r!.allocations : [])
    .map((a) => {
      const x = (a || {}) as Record<string, unknown>;
      return { po: str(x.po_number), invoice: str(x.invoice_number), amount: num(x.amount) };
    })
    .filter((a) => a.po || a.invoice)
    .slice(0, 30);
  const date = str(r?.value_date);
  return {
    kind,
    side: SIDES.has(r?.side as PaymentSide) ? (r!.side as PaymentSide) : null,
    payer: str(r?.payer),
    payee: str(r?.payee),
    amount: num(r?.amount),
    currency: str(r?.currency)?.toUpperCase().slice(0, 6) || null,
    valueDate: date && !Number.isNaN(Date.parse(date)) ? date.slice(0, 10) : null,
    reference: str(r?.reference),
    allocations,
    summary: str(r?.summary),
    confidence: typeof r?.confidence === "number" ? r.confidence : null,
  };
}

/** Payment Reader input for one mail. */
export function paymentReaderInput(
  mail: { subject: string; from: string; to: string; cc: string; date: string; body: string },
  documentUrl: string | null,
) {
  const input: Record<string, unknown> = {
    email_text: [
      `From: ${mail.from}`,
      `To: ${mail.to}`,
      mail.cc ? `Cc: ${mail.cc}` : "",
      `Date: ${mail.date}`,
      `Subject: ${mail.subject}`,
      "",
      mail.body.slice(0, 8000),
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
  if (documentUrl) input.document_url = documentUrl;
  return input;
}

/** "PO# G 2625101" / "4510217618" / "P14990//SWASTIK" → comparable key. */
export function normPo(po: string) {
  return po
    .toUpperCase()
    .replace(/^(PO|P\.O\.)[#\s:.-]*/, "")
    .split("//")[0]!
    .replace(/\.0+$/, "") // Excel numbers: 4205192.0
    .replace(/[^A-Z0-9]/g, "");
}
