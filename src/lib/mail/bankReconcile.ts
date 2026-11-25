/**
 * Reconcile bank lines (uploaded statements and HSBC credit / debit advices) with deals.
 *
 *   matched      the line was tied to a payment email at upload; that email is already in the ledger
 *   po_found     a PO was found (in the line or through a commission invoice); confirm to record it
 *   unmatched    nothing in the book names this payer; someone picks the deal
 *   recorded     someone confirmed the deal: the payment is on the PO ledger, a team note is
 *                added and the team is notified (the same path as Copilot's off-mail updates)
 *   ignored      not a deal payment (a refund, an own-account transfer…)
 *
 * Recording reuses applyDealUpdate with channel "bank", so Undo in the Off-mail updates feed
 * or here takes the payment back and puts the line back to "needs a deal". Server only.
 */
import { createHash } from "node:crypto";
import { applyDealUpdate, dealsByReferences, DealUpdateError, searchDealsForUpdate, undoDealUpdate } from "@/lib/trade/copilot/dealUpdates";
import type { DealUpdateDealRef, DealUpdateRecord } from "@/lib/trade/dealUpdate";
import type { PaymentSide } from "./payments";
import type { BankLineRecord, BankReconciliation } from "./statementJobs";
import { adviceFields } from "./statementJobs";
import { getMailStore, mailStoreConfigured, type MailRecord } from "./store";

export type BankLineStatus = "matched" | "po_found" | "unmatched" | "recorded" | "ignored";

export type BankLineView = BankLineRecord & {
  id: string;
  status: BankLineStatus;
  /** Deals this line probably belongs to (for po_found / unmatched). */
  suggestions: DealUpdateDealRef[];
};

const SIDES = new Set<PaymentSide>(["buyer", "factory", "freight", "commission", "other"]);
const LINE_ID = /^[a-f0-9]{24}$/;

/** Confirming the same line twice records it once: the update id comes from the line id. */
const updateIdOf = (lineId: string) => {
  const h = createHash("sha1").update(`bank-line:${lineId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

function statusOf(d: BankLineRecord): BankLineStatus {
  if (d.reconciled?.status === "recorded") return "recorded";
  if (d.reconciled?.status === "ignored") return "ignored";
  if (d.emailId) return "matched";
  if (d.pos?.length) return "po_found";
  return "unmatched";
}

function viewOf(r: MailRecord): BankLineView {
  const d = r.data as unknown as BankLineRecord;
  // Lines stored before advices kept their payer / gross: read them from the particulars.
  const fields = d.party === undefined ? adviceFields(d.particulars || "") : { party: d.party ?? null, gross: d.gross ?? null, charges: d.charges ?? null };
  return { ...d, ...fields, pos: d.pos || [], id: r.id, status: statusOf(d), suggestions: [] };
}

/** Company-form, trade and place words that name nobody in particular ("Comercial", "Worldwide", "Mexico"). */
const GENERIC = new Set(
  "sa de cv rl srl sas ltd limited llc inc corp corporation co company pvt private plc gmbh bv ag spa sl the and of comercial commercial comercializadora trading traders trade international internacional worldwide global group industries industrial enterprises exports export imports import overseas services logistics holdings mexico mexicana usa america india indian china hong kong uk bank na".split(" "),
);

/** What to search the book with: the PO when one was found, else the payer's distinctive name words. */
function searchTextOf(v: BankLineView): string {
  if (v.pos.length) return `PO ${v.pos[0]}`;
  return (v.party || "")
    .toLowerCase()
    .split(/[^a-z0-9&'-]+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w))
    .join(" ");
}

/**
 * Order / invoice numbers in the payment details: "/URI/8937 8939 8952", "PO21399, 21503",
 * "INV GP/25-26/047,048,055" and "GP 25 26 070A 074A" (→ GP2526047…, GP2526070A…). The bank's
 * own reference, the amounts and the ROC / account numbers are left out.
 */
export function referenceNumbersOf(particulars: string): string[] {
  const details = particulars
    .replace(/\s(?:REF|GROSS|LESS COSTS)\s.*$/, "")
    .replace(/\/ROC\/[^/\s]*(?:\s+[^/\s]+)*/g, " ")
    .replace(/\bFROM\s.+?\sVIA\s/, " ");
  const out = new Set<string>();
  for (const m of details.matchAll(/\bGP\s*\/?\s*(\d{2})\s*[-/ ]\s*(\d{2})\s*\/?\s*((?:\d{3}[A-Z]?)(?:\s*[, ]\s*\d{3}[A-Z]?)*)/gi)) {
    for (const n of m[3]!.split(/[\s,]+/)) if (/^\d{3}[A-Z]?$/i.test(n)) out.add(`GP${m[1]}${m[2]}${n.toUpperCase()}`);
  }
  for (const m of details.replace(/\bGP\s*\/?\s*\d{2}\s*[-/ ]\s*\d{2}[^A-Z]*/gi, " ").matchAll(/(?<![\d.,])(\d{4,8})(?![\d.,]\d)/g)) out.add(m[1]!);
  return [...out];
}

export async function listBankLines(opts: { limit?: number; suggest?: boolean } = {}): Promise<BankLineView[]> {
  if (!mailStoreConfigured()) return [];
  const rows = await getMailStore().listRecords({ kind: "bank_line", limit: 5000 });
  // duplicateOf: a second copy of a payment stored before ids were reference-based; never shown.
  const views = rows
    .filter((r) => !r.data.duplicateOf)
    .map(viewOf).sort((a, b) => b.date.localeCompare(a.date)).slice(0, opts.limit ?? 200);
  if (opts.suggest !== false) {
    const open = views.filter((v) => v.status === "po_found" || v.status === "unmatched").slice(0, 40);
    await Promise.all(
      open.map(async (v) => {
        // Deals that carry an order / invoice number from the payment details come first.
        const byRef = await dealsByReferences([...v.pos, ...referenceNumbersOf(v.particulars || "")]).catch(() => []);
        const q = searchTextOf(v);
        const byText = q ? await searchDealsForUpdate(q).catch(() => []) : [];
        const seen = new Set<string>();
        v.suggestions = [...byRef.map((x) => x.deal), ...byText].filter((d) => !seen.has(d.id) && seen.add(d.id)).slice(0, 4);
        if (v.status === "unmatched" && byRef.length) {
          v.status = "po_found";
          v.pos = byRef[0]!.hits;
        }
      }),
    );
  }
  return views;
}

async function loadLine(id: string): Promise<MailRecord> {
  if (!LINE_ID.test(id)) throw new DealUpdateError("Unknown bank line.", 404);
  if (!mailStoreConfigured()) throw new DealUpdateError("No database is connected.", 503);
  const hit = (await getMailStore().listRecords({ kind: "bank_line", limit: 5000 })).find((r) => r.id === id);
  if (!hit) throw new DealUpdateError("That bank line was not found. Upload the statement again.", 404);
  return hit;
}

/** The stored record of a view (without the fields the view adds). */
function storedOf(v: BankLineView): BankLineRecord {
  const d: Partial<BankLineView> = { ...v };
  delete d.id;
  delete d.status;
  delete d.suggestions;
  return d as BankLineRecord;
}

async function saveLine(r: MailRecord, data: BankLineRecord, dealKey: string | null) {
  await getMailStore().upsertRecords([{ kind: "bank_line", id: r.id, dealKey, data: data as unknown as Record<string, unknown>, createdAt: r.createdAt }]);
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Record a bank line on a deal (after the person confirmed it in the app): a payment on the PO,
 * a team note and a notification; the line is marked recorded.
 */
export async function reconcileBankLine(body: Record<string, unknown>): Promise<{ line: BankLineView; update: DealUpdateRecord }> {
  const id = clean(body.id, 40);
  const rec = await loadLine(id);
  const line = viewOf(rec);
  if (line.status === "recorded") throw new DealUpdateError(`Already recorded on ${line.reconciled?.dealCode || "a deal"}.`, 409);
  if (line.status === "matched") throw new DealUpdateError("This line already matches a payment email, which is on the ledger.", 409);
  const dealId = clean(body.dealId, 400);
  if (!dealId) throw new DealUpdateError("Pick the deal this payment is for.");
  const po = clean(body.po, 60) || null;
  const credit = line.amountInr > 0;
  const side = SIDES.has(body.side as PaymentSide) ? (body.side as PaymentSide) : credit ? "buyer" : "factory";
  // The payer's invoice is for the gross amount; bank charges come off after it left them.
  const basis = body.basis === "net" ? "net" : "gross";
  const amount = basis === "gross" && line.gross ? line.gross : Math.abs(line.amountInr);
  const author = clean(body.author, 80) || "team";
  const extra = clean(body.note, 500);
  const currency = line.currency || "INR";
  const facts = [
    line.party ? `${credit ? "From" : "To"} ${line.party}` : "",
    line.reference ? `bank ref ${line.reference}` : "",
    line.gross && line.charges ? `${currency} ${Math.abs(line.amountInr).toLocaleString("en-US", { minimumFractionDigits: 2 })} reached the account after ${line.charges.currency} ${line.charges.amount.toFixed(2)} bank charges` : "",
    extra,
  ].filter(Boolean);

  const update = await applyDealUpdate(
    {
      id: updateIdOf(rec.id),
      type: "payment",
      dealId,
      po,
      channel: "bank",
      note: facts.join(". "),
      author,
      payment: {
        kind: credit ? "payment_received" : "payment_sent",
        side,
        amount: Math.round(amount * 100) / 100,
        currency,
        date: line.date,
        reference: line.reference,
      },
      sourceText: line.particulars,
    },
    { bankLineId: rec.id },
  );

  const reconciled: BankReconciliation = {
    status: "recorded",
    dealKey: update.dealKey,
    dealId: update.dealId,
    dealCode: update.dealCode,
    href: update.href,
    po,
    side,
    amount: update.payment?.amount ?? amount,
    by: author,
    at: new Date().toISOString(),
  };
  const data: BankLineRecord = { ...storedOf(line), pos: po ? [po] : line.pos, poHow: po ? "manual" : line.poHow, reconciled, updateId: update.id };
  await saveLine(rec, data, update.dealKey);
  return { line: { ...data, id: rec.id, status: "recorded", suggestions: [] }, update };
}

/** Not a deal payment: keep the line, out of the "needs a deal" list. */
export async function ignoreBankLine(id: string, by: string): Promise<BankLineView> {
  const rec = await loadLine(id);
  const line = viewOf(rec);
  if (line.status === "recorded") throw new DealUpdateError("Undo the recorded payment first.", 409);
  const data: BankLineRecord = {
    ...storedOf(line),
    reconciled: { status: "ignored", dealKey: null, dealId: null, dealCode: null, href: null, po: null, side: null, amount: null, by: clean(by, 80) || "team", at: new Date().toISOString() },
  };
  await saveLine(rec, data, null);
  return { ...data, id: rec.id, status: "ignored", suggestions: [] };
}

/** Undo: a recorded line's payment is taken back (via the deal update); an ignored line is reopened. */
export async function reopenBankLine(id: string, by: string): Promise<BankLineView> {
  const rec = await loadLine(id);
  const line = viewOf(rec);
  if (line.status === "recorded" && line.updateId) {
    await undoDealUpdate(line.updateId, clean(by, 80) || "team");
  } else if (line.status === "ignored") {
      await saveLine(rec, { ...storedOf(line), reconciled: null }, null);
  }
  const [fresh] = (await getMailStore().listRecords({ kind: "bank_line", limit: 5000 })).filter((r) => r.id === id);
  return viewOf(fresh || rec);
}
