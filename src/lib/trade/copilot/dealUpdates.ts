/**
 * Off-mail deal updates told to Copilot (server-only).
 *
 *   proposeDealUpdate()  message → proposal (deal resolved from the book; nothing saved)
 *   applyDealUpdate()    the confirmed proposal → saved:
 *                          payment  → a ledger row in mail_payments (status done, id offmail:<id>),
 *                                     so the deal room, Finance and Copilot count it like a payment email
 *                          always   → a team note on the deal (Copilot, reply drafts, next action read it)
 *                          always   → a deal_update record (Command Center "Off-mail updates" feed)
 *                          payment  → a notification for the person who owns the deal
 *   undoDealUpdate()     voids all of the above (ledger row → not_payment, note hidden, feed shows undone)
 */
import { randomUUID } from "node:crypto";
import { addDealNote, notifyPayment } from "@/lib/mail/dealRecords";
import type { PaymentRow } from "@/lib/mail/paymentJobs";
import { BANK_ADVICE_SUBJECT as BANK_SUBJECT, OFF_MAIL_CONNECTION } from "@/lib/mail/payments";
import { getMailStore, mailStoreConfigured, type MailRecord } from "@/lib/mail/store";
import type { CommercialModelFilter } from "@/lib/trade/commercialModel";
import { findDealByRef } from "@/lib/trade/dealLink";
import {
  CHANNEL_LABEL,
  describeUpdate,
  detectDealUpdate,
  type DealUpdateChannel,
  type DealUpdateDealRef,
  type DealUpdateInput,
  type DealUpdatePayment,
  type DealUpdateProposal,
  type DealUpdateRecord,
} from "@/lib/trade/dealUpdate";
import type { Deal } from "@/types/trade";
import { getCopilotBook, type CopilotBook } from "./book";
import { dealHref } from "./context";
import { invalidatePaymentLedger } from "./paymentsContext";
import { parseCopilotQuery } from "./query";
import { dealPos, retrieveForQuery } from "./retrieve";

const KINDS = new Set(["payment_received", "payment_sent", "payment_request"]);
const SIDES = new Set(["buyer", "factory", "freight", "commission", "other"]);
const CHANNELS = new Set<DealUpdateChannel>(["whatsapp", "phone", "meeting", "bank", "other"]);
const ID_RE = /^[a-f0-9-]{36}$/;

export function dealKeyOf(d: Deal): string {
  return d.mailboxSourceId || d.id;
}

function refOf(d: Deal): DealUpdateDealRef {
  return {
    id: d.id,
    key: dealKeyOf(d),
    code: d.code,
    title: d.title.slice(0, 90),
    href: dealHref(d),
    pos: dealPos(d).slice(0, 8),
    currency: d.po?.currency || d.pi?.currency || null,
  };
}

function byRecency(a: Deal, b: Deal) {
  return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
}

/** Deals whose search text holds the most of the given words (party names, products). */
function dealsByWords(book: CopilotBook, text: string, scope: Deal[]): Deal[] {
  const words = [...new Set(text.toLowerCase().split(/[^a-z0-9@._&'-]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w)))].slice(0, 6);
  if (!words.length) return [];
  const scored = scope
    .map((d) => {
      const hay = book.index.get(d.id) || "";
      return { d, score: words.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored
    .filter((x) => x.score === best)
    .map((x) => x.d)
    .sort(byRecency)
    .slice(0, 6);
}

/** Which deal does the update belong to? Named PO / code first, then the deal on screen or in the last answer, then names. */
export function resolveDeals(
  book: CopilotBook,
  dealText: string,
  ctx: { focusDealId?: string; activeDealIds?: string[]; bookFilter?: CommercialModelFilter },
): { deals: Deal[]; hint: string | null } {
  const q = parseCopilotQuery(dealText);
  const named = q.poNumbers.length + q.dealCodes.length + q.bookingNumbers.length + q.containerNumbers.length;
  if (named) {
    const r = retrieveForQuery(book, { ...q, terms: [], intent: "deal" }, { bookFilter: ctx.bookFilter });
    if (r.mode === "deal" && r.deals.length === 1) return { deals: r.deals, hint: null };
    if (r.mode === "deal" && r.deals.length) {
      // Several deals carry that PO (split shipments, re-filed threads): the other words may settle it.
      const narrowed = dealsByWords(book, dealText.replace(/\b[A-Z]{0,2}\d{4,10}[A-Z]{0,2}\b/gi, " "), r.deals);
      if (narrowed.length === 1) return { deals: narrowed, hint: null };
      const pool = narrowed.length ? narrowed : r.deals;
      const ref = q.poNumbers[0] ? `PO ${q.poNumbers[0]}` : q.dealCodes[0] || "That reference";
      return { deals: pool.slice(0, 6), hint: `${ref} matches ${r.deals.length} deals in the book. Pick the right one.` };
    }
    const near = r.suggestions.slice(0, 5);
    return { deals: near, hint: `${r.notFound.join(", ") || "That reference"} is not in the book.${near.length ? " Closest matches below." : ""}` };
  }
  const focus = ctx.focusDealId ? book.byId.get(ctx.focusDealId) || findDealByRef(book.deals, ctx.focusDealId) : undefined;
  if (focus) return { deals: [focus], hint: null };
  const active = (ctx.activeDealIds || []).map((id) => book.byId.get(id)).filter((d): d is Deal => Boolean(d));
  const byWords = dealsByWords(book, dealText, book.deals);
  if (byWords.length) return { deals: byWords, hint: byWords.length > 1 ? "More than one deal matches. Pick the right one." : null };
  if (active.length) return { deals: active.slice(0, 6), hint: active.length > 1 ? "Pick the deal this is for." : null };
  return { deals: [], hint: "Say which deal: a PO number, deal code or the buyer / factory name." };
}

export async function proposeDealUpdate(
  message: string,
  ctx: { focusDealId?: string; activeDealIds?: string[]; bookFilter?: CommercialModelFilter },
): Promise<DealUpdateProposal | null> {
  const parsed = detectDealUpdate(message);
  if (!parsed) return null;
  const book = await getCopilotBook();
  const { deals, hint } = resolveDeals(book, parsed.dealText, ctx);
  const candidates = deals.map(refOf);
  const deal = candidates.length === 1 ? candidates[0]! : null;
  const mentioned = parseCopilotQuery(parsed.dealText).poNumbers.map((p) => p.toUpperCase());
  const po = deal ? deal.pos.find((p) => mentioned.some((m) => p.startsWith(m))) || deal.pos[0] || null : null;
  const payment = parsed.payment && deal && !parsed.payment.currency ? { ...parsed.payment, currency: deal.currency || "USD" } : parsed.payment;
  return { ...parsed, payment, id: randomUUID(), deal, candidates, po, dealHint: deal ? null : hint };
}

/** Deals for the card's "change deal" box. */
export async function searchDealsForUpdate(text: string): Promise<DealUpdateDealRef[]> {
  const book = await getCopilotBook();
  const q = parseCopilotQuery(text);
  if (q.poNumbers.length || q.dealCodes.length) {
    const r = retrieveForQuery(book, { ...q, terms: [], intent: "deal" }, {});
    if (r.deals.length) return r.deals.slice(0, 8).map(refOf);
    if (r.suggestions.length) return r.suggestions.slice(0, 8).map(refOf);
  }
  return dealsByWords(book, text, book.deals).slice(0, 8).map(refOf);
}

/**
 * Deals whose POs / document numbers carry any of these references (normalised, e.g. "8937",
 * "GP2526055"), most hits first. For bank advices whose payment details list order or invoice numbers.
 */
export async function dealsByReferences(refs: string[]): Promise<{ deal: DealUpdateDealRef; hits: string[] }[]> {
  const want = new Set(refs.map((r) => r.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((r) => r.length >= 4));
  if (!want.size) return [];
  const book = await getCopilotBook();
  return book.deals
    .map((d) => ({ d, hits: dealPos(d).filter((p) => want.has(p)) }))
    .filter((x) => x.hits.length)
    .sort((a, b) => b.hits.length - a.hits.length || byRecency(a.d, b.d))
    .slice(0, 6)
    .map((x) => ({ deal: refOf(x.d), hits: x.hits }));
}

/* ------------------------------------------------------------------ save */

export class DealUpdateError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Validate what the card sent back. Throws DealUpdateError with a message for the person. */
export function validateUpdateInput(body: Record<string, unknown>): DealUpdateInput {
  const id = clean(body.id, 64);
  if (!ID_RE.test(id)) throw new DealUpdateError("This update has expired. Ask Copilot again.");
  const type = body.type === "payment" ? "payment" : body.type === "note" ? "note" : null;
  if (!type) throw new DealUpdateError("Unknown update type.");
  const dealId = clean(body.dealId, 400);
  if (!dealId) throw new DealUpdateError("Pick the deal this update is for.");
  const channel = CHANNELS.has(body.channel as DealUpdateChannel) ? (body.channel as DealUpdateChannel) : "other";
  const note = clean(body.note, 2000);
  const author = clean(body.author, 80) || "team";
  const po = clean(body.po, 60) || null;
  let payment: DealUpdatePayment | null = null;
  if (type === "payment") {
    const p = (body.payment || {}) as Record<string, unknown>;
    const amount = typeof p.amount === "number" ? p.amount : Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e10) throw new DealUpdateError("Enter the amount.");
    const currency = clean(p.currency, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new DealUpdateError("Pick the currency.");
    const date = clean(p.date, 10);
    const t = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(t)) throw new DealUpdateError("Enter the payment date.");
    if (t > Date.now() + 2 * 86_400_000) throw new DealUpdateError("The payment date is in the future.");
    if (!KINDS.has(String(p.kind))) throw new DealUpdateError("Pick what happened: received, sent or requested.");
    payment = {
      kind: p.kind as DealUpdatePayment["kind"],
      side: (SIDES.has(String(p.side)) ? p.side : "buyer") as DealUpdatePayment["side"],
      amount: Math.round(amount * 100) / 100,
      currency,
      date,
      reference: clean(p.reference, 60) || null,
    };
    if (!po) throw new DealUpdateError("Pick the PO this payment is for.");
  } else if (!note) {
    throw new DealUpdateError("Write what happened.");
  }
  return { id, type, dealId, po, channel, note, author, payment, sourceText: clean(body.sourceText, 2000) };
}

function recordOf(r: MailRecord): DealUpdateRecord {
  const d = r.data as Partial<DealUpdateRecord>;
  return {
    id: r.id,
    type: d.type === "payment" ? "payment" : "note",
    dealId: String(d.dealId || ""),
    dealKey: r.dealKey || "",
    dealCode: String(d.dealCode || ""),
    dealTitle: String(d.dealTitle || ""),
    href: String(d.href || ""),
    po: d.po || null,
    channel: CHANNELS.has(d.channel as DealUpdateChannel) ? (d.channel as DealUpdateChannel) : "other",
    author: String(d.author || "team"),
    note: String(d.note || ""),
    summary: String(d.summary || ""),
    payment: (d.payment as DealUpdatePayment) || null,
    createdAt: r.createdAt,
    voidedAt: typeof d.voidedAt === "string" ? d.voidedAt : null,
    voidedBy: typeof d.voidedBy === "string" ? d.voidedBy : null,
  };
}

const paymentId = (id: string) => `offmail:${id}`;

/** `link.bankLineId`: the bank statement line this payment came from (set by bank reconciliation, never by the client). */
export async function applyDealUpdate(input: DealUpdateInput, link: { bankLineId?: string } = {}): Promise<DealUpdateRecord> {
  if (!mailStoreConfigured()) throw new DealUpdateError("No database is connected, so updates can't be saved.", 503);
  const store = getMailStore();
  const book = await getCopilotBook();
  const deal = book.byId.get(input.dealId) || findDealByRef(book.deals, input.dealId);
  if (!deal) throw new DealUpdateError("That deal is no longer in the book. Refresh and try again.", 404);
  const ref = refOf(deal);
  if (input.payment && input.po && !ref.pos.includes(input.po.toUpperCase())) {
    throw new DealUpdateError(`PO ${input.po} is not on ${deal.code}.`);
  }

  // Confirming twice (double click, retry) saves once.
  const [existing] = (await store.listRecords({ kind: "deal_update", dealKey: ref.key, limit: 200 })).filter((r) => r.id === input.id);
  if (existing) return recordOf(existing);

  const summary = describeUpdate(input);
  const now = new Date().toISOString();

  if (input.payment) {
    const p = input.payment;
    const row: PaymentRow = {
      id: paymentId(input.id),
      dealKey: ref.key,
      connectionId: OFF_MAIL_CONNECTION,
      mailbox: input.channel === "bank" ? "Bank advice" : "Copilot",
      subject: `${input.channel === "bank" ? BANK_SUBJECT : "Off-mail update"} · ${summary}`,
      from: input.author,
      to: "",
      cc: "",
      mailDate: `${p.date}T12:00:00.000Z`,
      attachment: null,
      status: "done",
      executionId: null,
      kind: p.kind,
      side: p.side,
      payer: null,
      payee: null,
      amount: p.amount,
      currency: p.currency,
      valueDate: p.date,
      reference: p.reference,
      allocations: [{ po: input.po, invoice: null, amount: p.amount }],
      summary: input.note || summary,
      confidence: 1,
      error: null,
      updatedAt: now,
      input: null,
    };
    await store.upsertPayments([row]);
    invalidatePaymentLedger();
  }

  const noteText = input.type === "payment" && input.note && input.note !== summary ? `${summary}. ${input.note}` : input.type === "payment" ? summary : `${input.note}${input.channel !== "other" ? ` (via ${input.channel === "phone" ? "phone call" : CHANNEL_LABEL[input.channel]})` : ""}`;
  const note = await addDealNote(store, { dealKey: ref.key, author: input.author, text: `${input.channel === "bank" ? "[Bank]" : "[Off-mail]"} ${noteText}` });

  const data = {
    type: input.type,
    dealId: deal.id,
    dealCode: deal.code,
    dealTitle: ref.title,
    href: ref.href,
    po: input.po,
    channel: input.channel,
    author: input.author,
    note: input.note,
    summary,
    payment: input.payment,
    sourceText: input.sourceText,
    noteId: note.id,
    paymentId: input.payment ? paymentId(input.id) : null,
    voidedAt: null,
    voidedBy: null,
    bankLineId: link.bankLineId ?? null,
  };
  await store.upsertRecords([{ kind: "deal_update", id: input.id, dealKey: ref.key, owner: null, data, createdAt: now }]);

  if (input.payment) {
    await notifyPayment(store, {
      entryId: paymentId(input.id),
      dealKey: ref.key,
      kind: input.payment.kind,
      amount: input.payment.amount,
      currency: input.payment.currency,
      summary:
        input.channel === "bank"
          ? `${input.author} matched a bank advice to this deal: ${input.note || summary}`
          : `${input.author} logged this from ${input.channel === "other" ? "outside email" : input.channel}: ${input.note || summary}`,
      href: ref.href,
    }).catch(() => false);
  }
  return recordOf({ kind: "deal_update", id: input.id, dealKey: ref.key, owner: null, data, createdAt: now, updatedAt: now });
}

export async function listDealUpdates(opts: { dealKey?: string; limit?: number } = {}): Promise<DealUpdateRecord[]> {
  if (!mailStoreConfigured()) return [];
  const limit = opts.limit ?? 20;
  const rows = await getMailStore().listRecords({ kind: "deal_update", dealKey: opts.dealKey, limit: limit + 20 });
  // Hidden = removed from the feed (e.g. a test entry); records are never deleted.
  return rows.filter((r) => !r.data.hidden).slice(0, limit).map(recordOf);
}

/** Take an update back: the payment stops counting, the note is hidden, the feed shows it as undone. */
export async function undoDealUpdate(id: string, by: string): Promise<DealUpdateRecord> {
  if (!ID_RE.test(id)) throw new DealUpdateError("Unknown update.", 404);
  if (!mailStoreConfigured()) throw new DealUpdateError("No database is connected.", 503);
  const store = getMailStore();
  const hit = (await store.listRecords({ kind: "deal_update", limit: 1000 })).find((r) => r.id === id);
  if (!hit) throw new DealUpdateError("That update was not found.", 404);
  const rec = recordOf(hit);
  if (rec.voidedAt) return rec;
  const now = new Date().toISOString();
  const pid = typeof hit.data.paymentId === "string" ? hit.data.paymentId : null;
  if (pid) {
    const [row] = await store.listPayments({ ids: [pid], limit: 1 });
    if (row) {
      await store.upsertPayments([{ ...row, status: "not_payment", error: `Undone by ${by} on ${now.slice(0, 10)}`, updatedAt: now }]);
      invalidatePaymentLedger();
    }
  }
  const noteId = typeof hit.data.noteId === "string" ? hit.data.noteId : null;
  if (noteId) {
    const [n] = (await store.listRecords({ kind: "deal_note", dealKey: hit.dealKey || undefined, limit: 500 })).filter((r) => r.id === noteId);
    if (n) await store.upsertRecords([{ kind: "deal_note", id: n.id, dealKey: n.dealKey, owner: n.owner, data: { ...n.data, voidedAt: now }, createdAt: n.createdAt }]);
  }
  const data = { ...hit.data, voidedAt: now, voidedBy: by.slice(0, 80) || "team" };
  await store.upsertRecords([{ kind: "deal_update", id, dealKey: hit.dealKey, owner: null, data, createdAt: hit.createdAt }]);
  // A payment that came from a bank line: the line goes back to "needs a deal".
  const bankLineId = typeof hit.data.bankLineId === "string" ? hit.data.bankLineId : null;
  if (bankLineId) {
    const line = (await store.listRecords({ kind: "bank_line", limit: 5000 })).find((r) => r.id === bankLineId);
    if (line && line.data.updateId === id) {
      const rest = { ...line.data };
      delete rest.reconciled;
      delete rest.updateId;
      const pos = Array.isArray(rest.pos) && rest.poHow === "manual" ? [] : rest.pos;
      await store.upsertRecords([{ kind: "bank_line", id: line.id, dealKey: null, data: { ...rest, pos, poHow: rest.poHow === "manual" ? null : rest.poHow }, createdAt: line.createdAt }]);
    }
  }
  return recordOf({ ...hit, data });
}
