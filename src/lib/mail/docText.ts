/**
 * Attachment → plain text (Phase 1 of the document layer: no AI, no per-page cost).
 *
 *   PDF with a text layer   unpdf (pdf.js)          scanned PDFs come back "empty" → OCR is Phase 2
 *   XLS / XLSX / CSV        SheetJS                 every sheet as rows of " | "-joined cells
 *   DOCX                    mammoth
 *   DOC (Word 97)           word-extractor
 *   HTML / TXT              tags stripped           bank statements, remittance advices
 *
 * Plus a document type from the file name and first page, so callers know what they are looking at.
 * Server only.
 */
import mammoth from "mammoth";
import { extractText as pdfText, getDocumentProxy } from "unpdf";
import WordExtractor from "word-extractor";
import * as XLSX from "xlsx";

export type DocType =
  | "purchase_order"
  | "proforma_invoice"
  | "commercial_invoice"
  | "packing_list"
  | "bill_of_lading"
  | "booking_confirmation"
  | "payment_advice"
  | "bank_statement"
  | "quotation"
  | "certificate"
  | "inspection_report"
  | "shipping_bill"
  | "artwork"
  | "other";

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  purchase_order: "Purchase order",
  proforma_invoice: "Proforma invoice",
  commercial_invoice: "Invoice",
  packing_list: "Packing list",
  bill_of_lading: "Bill of lading / waybill",
  booking_confirmation: "Booking confirmation",
  payment_advice: "Payment advice / TT copy",
  bank_statement: "Bank statement",
  quotation: "Quotation / AS sheet",
  certificate: "Certificate",
  inspection_report: "Inspection report",
  shipping_bill: "Shipping bill",
  artwork: "Artwork",
  other: "Document",
};

export type DocText = {
  v: 1;
  name: string;
  ext: string;
  method: "pdf" | "sheet" | "docx" | "doc" | "html" | "text" | "ocr" | "none";
  /** ok = text found; empty = no text layer (scanned / image) → OCR; unsupported = format we skip. */
  status: "ok" | "empty" | "unsupported" | "failed";
  pages: number | null;
  text: string;
  truncated: boolean;
  docType: DocType;
  error: string | null;
  extractedAt: string;
  /** OCR only: average page confidence (0–100) and the engine that read it. */
  confidence?: number;
  engine?: "tesseract" | "textract";
};

export const MAX_TEXT_CHARS = 40_000;

/**
 * Text from a PDF with a broken font map comes out as letter soup ("PILLLIPAEBGGJAPILLLIP"):
 * many very long letter-only tokens. Treat it like a scan (no usable text → OCR).
 */
export function looksGarbled(text: string) {
  const words = text.match(/[A-Za-z]{4,}/g) || [];
  if (words.length < 20) return false;
  return words.filter((w) => w.length >= 15).length / words.length > 0.2;
}
const MAX_SHEET_ROWS = 400;

export function extOf(name: string) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? `.${m[1]!.toLowerCase()}` : "";
}

const tidy = (s: string) =>
  s
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(tr|p|div|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function sheetsToText(buf: Buffer) {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, dense: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 12)) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false, defval: "" });
    const lines = rows
      .map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()))
      .filter((r) => r.some(Boolean))
      .slice(0, MAX_SHEET_ROWS)
      .map((r) => {
        // Drop trailing empty cells so wide, sparse sheets stay readable.
        let end = r.length;
        while (end > 0 && !r[end - 1]) end--;
        return r.slice(0, end).join(" | ");
      });
    if (lines.length) parts.push(`## Sheet: ${name}\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

/** Legacy .xls → .xlsx, so the PO / PI extractor (which reads modern formats only) can open it. */
export function xlsToXlsx(buf: Buffer): Buffer {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const TYPE_RULES: [DocType, RegExp][] = [
  ["bank_statement", /\b(account statement|statement of account|bank statement|e-?statement)\b|\bfinacle\b/i],
  ["payment_advice", /\b(remittance|swift|mt ?103|tt copy|t\/t copy|debit advice|credit advice|payment advice|birc|inward remittance|utr)\b/i],
  ["packing_list", /\b(packing list|packing-list|\bp\/?l\b)/i],
  ["purchase_order", /\b(purchase order|p\.?\s?o\.?\s?(no|number|#)|\bprd po\b|po#)/i],
  ["proforma_invoice", /\b(pro\s*-?\s*forma|performa)\b|\bpi[\s#:-]*\d/i],
  ["commercial_invoice", /\b(commercial invoice|tax invoice|invoice)\b|\binv[\s.#-]*\d/i],
  ["bill_of_lading", /\b(bill of lading|b\/l|hbl|mbl|obl|sea waybill|airway bill|awb|hawb|mawb|surrender)\b/i],
  ["booking_confirmation", /\b(booking confirmation|booking update|bkg conf|\bbkg\b|booking)\b/i],
  ["shipping_bill", /\bshipping bill\b|\bleo\b/i],
  ["certificate", /\b(certificate|coo|fumigation|phyto|health cert|radiation)\b/i],
  ["inspection_report", /\b(inspection|qc report|aql|audit report)\b/i],
  ["quotation", /\b(quotation|quote|as sheet|price list|costing|offer sheet)\b/i],
  ["artwork", /\b(artwork|dieline|die-line|label design|print file)\b/i],
];

/** The document's own title near the top ("COMMERCIAL INVOICE", "PURCHASE ORDER") is the strongest signal. */
const TITLE_RULES: [DocType, RegExp][] = [
  ["bank_statement", /\b(account statement|statement of account)\b/i],
  ["payment_advice", /\b(remittance advice|payment advice|debit advice|credit advice|inward remittance)\b/i],
  ["proforma_invoice", /\bpro\s*-?\s*forma invoice\b|\bperforma invoice\b/i],
  ["commercial_invoice", /\b(commercial invoice|tax invoice|export invoice)\b/i],
  ["packing_list", /\bpacking list\b/i],
  ["purchase_order", /\bpurchase order\b/i],
  ["bill_of_lading", /\b(bill of lading|sea waybill|air waybill)\b/i],
  ["booking_confirmation", /\bbooking (confirmation|update|amendment)\b/i],
  ["shipping_bill", /\bshipping bill\b/i],
  ["inspection_report", /\binspection (report|certificate)\b/i],
  ["certificate", /\bcertificate of origin\b|\bfumigation certificate\b|\bhealth certificate\b/i],
];

/**
 * Document type: the title on the document first, then the file name (an invoice named
 * "INV.SWK122 LP PO#14946" is an invoice that quotes a PO), then the rest of the first page.
 */
export function classifyDocument(name: string, text: string): DocType {
  const head = text.slice(0, 800);
  for (const [type, re] of TITLE_RULES) if (re.test(head)) return type;
  if (/\b(inv|invoice)\b|\binv[\s.#-]*\d/i.test(name) && !/pro\s*-?\s*forma|performa/i.test(name)) return "commercial_invoice";
  for (const [type, re] of TYPE_RULES) if (re.test(name)) return type;
  for (const [type, re] of TYPE_RULES) if (re.test(text.slice(0, 1500))) return type;
  return "other";
}

const SUPPORTED = new Set([".pdf", ".xls", ".xlsx", ".xlsm", ".csv", ".docx", ".doc", ".html", ".htm", ".txt"]);

export function isTextExtractable(name: string) {
  return SUPPORTED.has(extOf(name));
}

/** Extract text from one attachment. Never throws: failures come back as status "failed". */
export async function extractDocText(buf: Buffer, name: string): Promise<DocText> {
  const ext = extOf(name);
  const base = { v: 1 as const, name, ext, pages: null as number | null, truncated: false, error: null as string | null, extractedAt: new Date().toISOString() };
  const done = (method: DocText["method"], raw: string, pages: number | null = null): DocText => {
    const text = tidy(raw);
    const cut = text.length > MAX_TEXT_CHARS;
    // A PDF with almost no text per page is a scan or a picture.
    const empty =
      method === "pdf" ? text.replace(/\s/g, "").length < Math.max(40, (pages || 1) * 25) || looksGarbled(text) : !text;
    return {
      ...base,
      method,
      pages,
      text: cut ? text.slice(0, MAX_TEXT_CHARS) : text,
      truncated: cut,
      status: empty ? "empty" : "ok",
      docType: classifyDocument(name, text),
    };
  };
  try {
    switch (ext) {
      case ".pdf": {
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        const { totalPages, text } = await pdfText(pdf, { mergePages: false });
        const pages = (text as string[]).map((t, i) => `--- page ${i + 1}\n${t}`);
        return done("pdf", pages.join("\n"), totalPages);
      }
      case ".xls":
      case ".xlsx":
      case ".xlsm":
      case ".csv":
        return done("sheet", sheetsToText(buf));
      case ".docx":
        return done("docx", (await mammoth.extractRawText({ buffer: buf })).value);
      case ".doc": {
        const doc = await new WordExtractor().extract(buf);
        return done("doc", [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()].filter(Boolean).join("\n\n"));
      }
      case ".html":
      case ".htm":
        return done("html", htmlToText(buf.toString("utf8")));
      case ".txt":
        return done("text", buf.toString("utf8"));
      default:
        return { ...base, method: "none", status: "unsupported", text: "", docType: classifyDocument(name, "") };
    }
  } catch (err) {
    return {
      ...base,
      method: "none",
      status: "failed",
      text: "",
      docType: classifyDocument(name, ""),
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    };
  }
}
