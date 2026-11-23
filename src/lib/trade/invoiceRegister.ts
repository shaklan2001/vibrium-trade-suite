/**
 * Invoice → PO register, built from the book (no table needed).
 *
 * Payment emails often name only an invoice number ("GP/25-26/040"). This register says which
 * PO(s) that invoice belongs to, using three sources:
 *   a. the extracted PI / PO / invoice documents on a deal (docNumber + the deal's POs),
 *   b. email subjects that carry both ("INVOICE NO. SWK/26-27/122 … PO# 14946"),
 *   c. commission invoices SNSPL issued, which cover the POs on their lines.
 * Client-safe and pure.
 */
import { normPo } from "@/lib/mail/payments";
import type { Deal } from "@/types/trade";
import { normInvoiceNo } from "./normalize";

export type RegisterEntry = {
  invoiceNo: string;
  norm: string;
  pos: string[];
  amount: number | null;
  currency: string | null;
  issuer: string | null;
  buyer: string | null;
  date: string | null;
  kind: "goods" | "commission";
  dealId: string;
  source: "document" | "subject";
};

export type InvoiceRegister = Map<string, RegisterEntry>;

const INVOICE_IN_SUBJECT = /\binv(?:oice)?[\s.:#-]*(?:no\.?|number)?[\s.:#-]*([A-Z0-9][A-Z0-9/\-_.]{3,})/i;
const PO_IN_TEXT = /\bP\.?O\.?[\s#:.-]*(?:no\.?)?[\s#:.-]*([A-Z]?\s?\d{4,}[A-Z]?)/gi;
const COMMISSION_ISSUER = /\b(snspl|savvy net|commission)\b/i;

export function posIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PO_IN_TEXT)) out.add(normPo(m[1]!));
  return [...out].filter((p) => p.length >= 3);
}

function dealPos(deal: Deal): string[] {
  const set = new Set<string>((deal.mailboxPoNumbers || []).map(normPo));
  if (deal.po?.docNumber) set.add(normPo(deal.po.docNumber));
  return [...set].filter((p) => p.length >= 3);
}

function add(reg: InvoiceRegister, entry: RegisterEntry) {
  if (entry.norm.length < 4 || !entry.pos.length) return;
  const prev = reg.get(entry.norm);
  if (!prev) {
    reg.set(entry.norm, entry);
    return;
  }
  // Same invoice seen twice: merge the POs, keep the figures from the document.
  const pos = [...new Set([...prev.pos, ...entry.pos])];
  const better = prev.source === "document" ? prev : entry;
  reg.set(entry.norm, { ...better, pos });
}

export function buildInvoiceRegister(deals: Deal[]): InvoiceRegister {
  const reg: InvoiceRegister = new Map();
  for (const deal of deals) {
    const own = dealPos(deal);
    const docs = [...(deal.commercialDocs || []), ...(deal.po ? [deal.po] : []), ...(deal.pi ? [deal.pi] : [])];
    for (const doc of docs) {
      const no = doc.docNumber || "";
      const fromName = /inv(?:oice)?[\s._-]*([A-Z0-9/\-]{3,})/i.exec(doc.fileName || "")?.[1] || "";
      const isInvoice = /inv/i.test(doc.fileName || "") || doc.docType === "pi";
      if (!isInvoice) continue;
      const issuer = doc.shipper || doc.factory || null;
      const commission = COMMISSION_ISSUER.test(`${issuer || ""} ${doc.fileName || ""} ${no}`);
      const linePos = posIn((doc.lines || []).map((l) => l.description || "").join(" "));
      const pos = [...new Set([...(commission ? [] : own), ...linePos])];
      for (const key of [no, fromName]) {
        if (!key) continue;
        add(reg, {
          invoiceNo: key,
          norm: normInvoiceNo(key),
          pos,
          amount: doc.totalAmount ?? null,
          currency: doc.currency ?? null,
          issuer,
          buyer: doc.buyer || doc.consignee || null,
          date: doc.sentAt?.slice(0, 10) ?? null,
          kind: commission ? "commission" : "goods",
          dealId: deal.id,
          source: "document",
        });
      }
    }
    for (const src of deal.sources || []) {
      const subject = src.subject || "";
      const inv = INVOICE_IN_SUBJECT.exec(subject)?.[1];
      if (!inv) continue;
      const pos = posIn(subject).filter((p) => normInvoiceNo(inv) !== normInvoiceNo(p));
      add(reg, {
        invoiceNo: inv,
        norm: normInvoiceNo(inv),
        pos: pos.length ? pos : own.length === 1 ? own : [],
        amount: null,
        currency: null,
        issuer: null,
        buyer: null,
        date: src.receivedAt?.slice(0, 10) ?? null,
        kind: "goods",
        dealId: deal.id,
        source: "subject",
      });
    }
  }
  return reg;
}

/** POs for an invoice number, or [] when the register does not know it. */
export function posForInvoice(reg: InvoiceRegister, invoice: string | null | undefined): string[] {
  if (!invoice) return [];
  return reg.get(normInvoiceNo(invoice))?.pos || [];
}

/** Commission invoices, for matching bank remittances (see matchStatement). */
export function commissionInvoices(reg: InvoiceRegister): RegisterEntry[] {
  return [...reg.values()].filter((e) => e.kind === "commission");
}
