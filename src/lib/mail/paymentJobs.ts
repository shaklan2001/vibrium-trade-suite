/**
 * Runs the Payment Reader over payment emails (server-only).
 *
 *   sync ingest → paymentRowFor() queues a pending row with the mail text and the best attachment
 *   processPayments() → starts readers for pending rows and finishes running ones
 *
 * Rows live in mail_payments (store.ts); scripts/backfill-payments.ts queues existing mail.
 */
import { presign } from "./attachmentUrl";
import { freshText } from "./inbox";
import { isPaymentCandidate, parsePaymentResult, paymentReaderInput, pickPaymentAttachment, type PaymentEntry } from "./payments";
import type { MailStore } from "./store";
import type { StoredAttachment, StoredMailMessage } from "./types";
import { executionResult, getExecution, startExecution, TERMINAL } from "./workers";

export type PaymentRow = PaymentEntry & {
  /** What the reader is given: the mail text and the attachment to read (S3 key). */
  input: { email_text: string; s3_key: string | null } | null;
};

const READ_TIMEOUT_MS = 15 * 60_000;

export function paymentReaderId() {
  return process.env.VIBRIUM_PAYMENT_READER_AGENT_ID?.trim() || "";
}

function attachmentsOf(m: Pick<StoredMailMessage, "attachments_json">): StoredAttachment[] {
  const raw = m.attachments_json as unknown;
  if (Array.isArray(raw)) return raw as StoredAttachment[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as StoredAttachment[];
    } catch {
      return [];
    }
  }
  return [];
}

/** A pending ledger row for a stored mail, or null when it is not a payment candidate. */
export function paymentRowFor(
  m: Pick<
    StoredMailMessage,
    "connection_id" | "provider_message_id" | "internet_message_id" | "deal_key" | "subject" | "from_email" | "from_name" | "to_text" | "cc_text" | "sent_at" | "body_text" | "attachments_json" | "status"
  >,
  mailbox: string,
): PaymentRow | null {
  if (m.status === "noise" || m.status === "error" || !m.sent_at) return null;
  const atts = attachmentsOf(m);
  const body = freshText(m.body_text || "");
  const subject = m.subject || "";
  if (!isPaymentCandidate(subject, body, atts.map((a) => a.name))) return null;
  const doc = pickPaymentAttachment(atts);
  const from = m.from_name ? `${m.from_name} <${m.from_email || ""}>` : m.from_email || "";
  const date = new Date(m.sent_at).toISOString();
  const text = paymentReaderInput({ subject, from, to: m.to_text || "", cc: m.cc_text || "", date, body }, null).email_text as string;
  return {
    id: m.internet_message_id || m.provider_message_id,
    dealKey: m.deal_key,
    connectionId: m.connection_id,
    mailbox,
    subject,
    from,
    to: m.to_text || "",
    cc: m.cc_text || "",
    mailDate: date,
    attachment: doc?.name || null,
    status: "pending",
    executionId: null,
    kind: null,
    side: null,
    payer: null,
    payee: null,
    amount: null,
    currency: null,
    valueDate: null,
    reference: null,
    allocations: [],
    summary: null,
    confidence: null,
    error: null,
    updatedAt: new Date().toISOString(),
    input: { email_text: text, s3_key: doc?.s3_key || null },
  };
}

/** Start the reader for a pending row. */
export async function startPaymentRead(row: PaymentRow): Promise<PaymentRow> {
  const agentId = paymentReaderId();
  if (!agentId) throw new Error("VIBRIUM_PAYMENT_READER_AGENT_ID is not set");
  if (!row.input) return { ...row, status: "failed", error: "no input", updatedAt: new Date().toISOString() };
  const url = row.input.s3_key ? await presign(row.input.s3_key).catch(() => null) : null;
  const input: Record<string, unknown> = { email_text: row.input.email_text };
  if (url) input.document_url = url;
  const executionId = await startExecution(agentId, input);
  return { ...row, status: "running", executionId, error: null, updatedAt: new Date().toISOString() };
}

/** Finish a running row; null while the reader is still working. */
export async function finishPaymentRead(row: PaymentRow): Promise<PaymentRow | null> {
  if (!row.executionId) return { ...row, status: "failed", error: "lost execution", updatedAt: new Date().toISOString() };
  const ex = await getExecution(row.executionId);
  const status = ex.status || "unknown";
  if (!TERMINAL.has(status)) {
    if (Date.now() - Date.parse(row.updatedAt) < READ_TIMEOUT_MS) return null;
    return { ...row, status: "failed", error: "reader timed out", updatedAt: new Date().toISOString() };
  }
  if (status !== "completed") {
    const error = JSON.stringify(ex.error || ex.message || status).slice(0, 500);
    // Scanned PDFs go to a vision model this account may not have, and legacy Office files are
    // rejected: read the email text alone instead (queued again without the attachment).
    if (row.input?.s3_key && /not available for this account|legacy Office|document_url/i.test(error)) {
      return {
        ...row,
        status: "pending",
        executionId: null,
        input: { ...row.input, s3_key: null },
        error: `attachment ${row.attachment} could not be read; reading the email text only`,
        updatedAt: new Date().toISOString(),
      };
    }
    return { ...row, status: "failed", error, updatedAt: new Date().toISOString() };
  }
  const p = parsePaymentResult(executionResult(ex));
  return {
    ...row,
    ...p,
    status: p.kind === "other" ? "not_payment" : "done",
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

/** One round: finish running reads, then start up to `limit` pending ones. */
export async function processPayments(store: MailStore, opts: { deadline: number; limit?: number }) {
  const out = { finished: 0, started: 0, failed: 0, dealKeys: [] as string[] };
  if (!paymentReaderId()) return out;
  for (const row of await store.listPayments({ status: "running", limit: 50 })) {
    if (Date.now() > opts.deadline) return out;
    try {
      const done = await finishPaymentRead(row);
      if (done) {
        await store.upsertPayments([done]);
        out.finished += 1;
        if (done.dealKey) out.dealKeys.push(done.dealKey);
      }
    } catch (err) {
      out.failed += 1;
      console.warn("[payments] finish failed", row.id, err);
    }
  }
  for (const row of await store.listPayments({ status: "pending", limit: opts.limit ?? 10 })) {
    if (Date.now() > opts.deadline) break;
    try {
      await store.upsertPayments([await startPaymentRead(row)]);
      out.started += 1;
    } catch (err) {
      out.failed += 1;
      await store.upsertPayments([{ ...row, status: "failed", error: String(err).slice(0, 500), updatedAt: new Date().toISOString() }]);
    }
  }
  return out;
}
