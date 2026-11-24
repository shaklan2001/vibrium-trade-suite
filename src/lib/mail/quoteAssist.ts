/**
 * Quote requests: what is being asked for, and whether it is specific enough to price.
 * Used by the reply drafter (a generic request gets a clarifying question) and the Inbox
 * quote panel (specific items get vendors and last prices from the book).
 * Pure.
 */
import type { InboxMessage } from "./inboxTypes";

const QUOTE_ASK =
  /\b(quote|quotation|quoting|price list|pricelist|best price|rates?|pricing|costing|catalogue|catalog|moq|offer|fob price|send (?:us )?(?:your )?prices?)\b/i;
const NOT_A_REQUEST = /\b(invoice|payment|remittance|bl draft|booking|shipped|sailing|container)\b/i;
const ITEM_CODE = /\b[A-Z]{1,5}[-_ ]?\d{3,}[A-Z]?\b/g;
const QTY = /\b\d[\d,]*\s*(?:pcs|pieces|units|sets|nos|ctns|cartons|dozens?|doz|kg|mt|meters?|metres?|yards?)\b/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.{4,120})$/gm;
const GENERIC_ONLY = /\b(product details?|your products?|full range|all products|details and pricing|pricing details|catalog(?:ue)?|price list)\b/i;

export type QuoteRequestItem = { text: string; code: string | null; qty: string | null };

/** Items named in a quote request: bullet lines, item codes, quantities. */
export function quoteRequestItems(body: string): QuoteRequestItem[] {
  const text = (body || "").replace(/\r/g, "");
  const items = new Map<string, QuoteRequestItem>();
  for (const m of text.matchAll(BULLET)) {
    const line = m[1]!.trim();
    const code = (line.match(ITEM_CODE) || [])[0] || null;
    const qty = QTY.exec(line)?.[0] || null;
    items.set(line.toLowerCase(), { text: line, code, qty });
  }
  for (const m of text.matchAll(ITEM_CODE)) {
    const code = m[0]!;
    if (![...items.values()].some((i) => i.code === code)) items.set(code.toLowerCase(), { text: code, code, qty: null });
  }
  return [...items.values()].slice(0, 8);
}

/** The newest mail asks for prices or a quote. */
export function isQuoteRequest(m: Pick<InboxMessage, "subject" | "body" | "internal">): boolean {
  if (m.internal) return false;
  const text = `${m.subject}\n${m.body}`.slice(0, 2500);
  if (!QUOTE_ASK.test(text)) return false;
  return !(NOT_A_REQUEST.test(m.subject) && !QUOTE_ASK.test(m.subject));
}

/**
 * A quote request that names no product to price ("please send product details and pricing"):
 * the reply should ask which items, quantities, target price and destination.
 */
export function isGenericQuoteRequest(m: Pick<InboxMessage, "subject" | "body" | "internal" | "attachments">): boolean {
  if (!isQuoteRequest(m)) return false;
  if (quoteRequestItems(m.body).length) return false;
  if (QTY.test(m.body) || (m.attachments || []).some((a) => /\.(xlsx?|csv|pdf)$/i.test(a))) return false;
  return GENERIC_ONLY.test(`${m.subject}\n${m.body}`) || m.body.trim().split(/\s+/).length < 60;
}
