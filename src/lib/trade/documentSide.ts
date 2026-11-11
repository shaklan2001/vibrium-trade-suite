/**
 * Which side of the deal a commercial document (PI / PO / invoice) belongs to.
 *
 * The PI/PO extractors already return who issued the document (shipper /
 * factory) and who it is addressed to (consignee / buyer). On Global Praise
 * deals that decides the side, whatever the document is called:
 *   Global Praise → Shetler   (PI 047, $86,970)      buyer side: what the buyer owes
 *   Anupama → Global Praise   (PO G 2625063, $44,423) factory side: what GP owes the factory
 *   Protec → Global Praise    (PI 2651WQ, $47,228)   factory side
 *   Info Capital & Logistics → Global Praise (₹38,764 forwarding PI) freight charges
 * Without Global Praise / SNSPL on the document (agency deals), a PO is the
 * buyer's order and a PI is the factory's.
 */

export type DocSide = "buyer" | "factory" | "freight";

export type SideInput = {
  docType?: string;
  shipper?: string;
  consignee?: string;
  buyer?: string;
  factory?: string;
  summary?: string;
};

const TRADER_RE = /global\s*praise|globalpraise|savvy\s*net|\bsnspl\b/i;
const FORWARDER_RE =
  /\b(logistic[as]?|freight|shipping|cargo|forwarders?|forwarding|aduanal|maritime|carriers?)\b/i;
const FREIGHT_SUMMARY_RE =
  /\b(forwarding|handling|freight|origin|local|destination)\s+(charges?|pi|invoice|bill)\b|forwarding\s*\/\s*handling/i;

/** File names of PIs, POs and invoices: the documents that carry order value. */
export const COMMERCIAL_FILE_RE =
  /\b(p\.?\s?o|purchase\s*order|pro\s*-?\s*forma|performa|pi|invoice|inv|comm\.?\s*inv|order)\b|\bpo\s*#|\bpi[-_ ]?\d/i;
/** Packing lists, payment copies, B/Ls… never carry the order value. */
export const NOT_COMMERCIAL_FILE_RE =
  /\b(packing\s+list|pkl|pl|tt\s+copy|payment\s+request|fcr|hbl|obl|bl|vgm|coa|certificate|bank\s+detail|artwork|label|sticker)\b/i;
const STRONG_COMMERCIAL_RE =
  /\b(invoice|inv|pro\s*-?\s*forma|performa|pi|p\.?\s?o|purchase\s*order)\b|\bpo\s*#|\bpi[-_ ]?\d/i;

/**
 * A packing list / payment copy / B/L, unless the name also says invoice, PI or
 * PO ("INV & PL 047.xlsx" is an invoice with its packing list).
 */
export function isNonCommercialFile(name?: string | null): boolean {
  const n = name || "";
  return NOT_COMMERCIAL_FILE_RE.test(n) && !STRONG_COMMERCIAL_RE.test(n);
}

/** A PI, PO or invoice worth reading for amounts. */
export function isCommercialFile(name?: string | null): boolean {
  const n = name || "";
  return COMMERCIAL_FILE_RE.test(n) && !isNonCommercialFile(n);
}

/** A purchase order (read with the PO extractor); everything else uses the PI extractor. */
export const PO_FILE_RE = /\b(p\.?\s?o|purchase\s*order)\b|\bpo\s*#/i;

export function isTraderParty(name?: string | null): boolean {
  return Boolean(name && TRADER_RE.test(name));
}

export function documentSide(doc: SideInput): DocSide {
  const issuer = doc.shipper || doc.factory || "";
  const recipient = doc.consignee || doc.buyer || "";

  if (
    (issuer && FORWARDER_RE.test(issuer) && !TRADER_RE.test(issuer)) ||
    FREIGHT_SUMMARY_RE.test(doc.summary || "")
  ) {
    return "freight";
  }
  const issuerTrader = isTraderParty(issuer);
  const recipientTrader = isTraderParty(recipient) || isTraderParty(doc.buyer);
  if (recipientTrader && !issuerTrader) return "factory";
  if (issuerTrader && !recipientTrader) return "buyer";
  return String(doc.docType || "").toLowerCase() === "po" ? "buyer" : "factory";
}
