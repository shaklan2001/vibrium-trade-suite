import type {
  BookingDetails,
  CommercialDocument,
  Deal,
  DealStage,
  DocumentType,
  Party,
  PaymentClock,
  QuoteMatrix,
  RequirementFields,
  SourceMessage,
  SourceMessageKind,
} from "@/types/trade";
import { EUR_TO_USD, GBP_TO_USD, USD_TO_INR } from "./currencyDisplay";
import { cleanPoNumbers, dealCodeFor, poNumbersIn } from "./dealReference";
import { documentSide, isNonCommercialFile, isTraderParty } from "./documentSide";
import { ingestFileOpenUrl } from "./ingestFiles";
import { isLocalChargesNarrative } from "./localCharges";

export type ProcessedDealRow = {
  id: string;
  po_numbers?: string[] | null;
  subject?: string | null;
  primary_stage?: string | null;
  slot?: string | null;
  agent_id?: string | null;
  status?: string | null;
  summary?: string | null;
  confidence?: number | null;
  date_start?: string | null;
  date_end?: string | null;
  message_count?: number | null;
  doc_count?: number | null;
  parties_json?: {
    buyers?: string[];
    buyer?: string[];
    factories?: string[];
    factory?: string[];
    traders?: string[];
    trader?: string[];
  } | null;
  error?: string | null;
  processed_at?: string | null;
  result_json?: Record<string, unknown> | null;
  cost_usd?: number | null;
  commercial_model?: string | null;
  /** Book set by hand on the Deal Board (deal_overrides); wins over every rule. */
  commercial_model_override?: string | null;
  /** Per-document PI / PO / invoice extracts (deal_documents, completed only). */
  documents_json?: DealDocumentRow[] | string | null;
  evidence_json?: EvidencePayload | null;
  document?: string | null;
  document_name?: string | null;
  document_url?: string | null;
  /** Party + mail header tokens for Deal Board search (no bodies). */
  search_text?: string | null;
  has_evidence?: boolean | null;
};

export type EvidenceMessage = {
  id?: string;
  subject?: string;
  from?: string;
  from_name?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  date?: string;
  body?: string;
  attachments?: { name?: string; url?: string; path?: string }[];
};

export type EvidencePayload = {
  commercial_model?: string;
  slot?: string;
  email_text?: string;
  document_name?: string;
  document_url?: string;
  messages?: EvidenceMessage[];
  message_count?: number;
  doc_count?: number;
};

const STAGE_MAP: Record<string, DealStage> = {
  requirement: "requirement",
  quoting: "quoting",
  artwork: "artwork",
  samples: "samples",
  pi_po: "pi_po",
  inspection: "production",
  booking: "booking",
  payment: "docs_payment",
  other: "requirement",
};

const SOURCE_KIND: Record<string, SourceMessageKind> = {
  requirement_extractor: "requirement",
  quote_normalizer: "quote",
  artwork_checklist_extractor: "artwork",
  sample_request_summarizer: "samples",
  pi_extractor: "pi",
  po_extractor: "po",
  inspection_photo_summarizer: "inspection",
  booking_extractor: "booking",
  payment_clock: "payment",
  commission_checklist: "commission",
  final_docs_pack_check: "booking",
};

const DOC_TYPE: Record<string, DocumentType> = {
  quote_normalizer: "quote",
  pi_extractor: "pi",
  po_extractor: "po",
  booking_extractor: "booking",
  payment_clock: "commercial_invoice",
  requirement_extractor: "rfq",
};

const PAYMENT_STATUS = new Set<PaymentClock["status"]>([
  "not_started",
  "pending",
  "due_soon",
  "overdue",
  "paid",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asResult(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asResult(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (Array.isArray(value)) {
    const first = value.find(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
    return asRecord(first);
  }
  return asRecord(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Same rates as currencyDisplay, so a deal's own currency can be shown back exactly. */
function toUsd(amount: number, currency?: string): number {
  const c = (currency || "").toUpperCase();
  if (!c || c === "USD" || c === "US$") return amount;
  if (c === "INR" || c === "RS" || c === "₹") return amount / USD_TO_INR;
  if (c === "EUR") return amount * EUR_TO_USD;
  if (c === "GBP") return amount * GBP_TO_USD;
  // Unknown currency — do not invent USD (caller should supply currency)
  return amount;
}

function normalizeMoneyCur(raw: string): string {
  let cur = String(raw || "USD").toUpperCase();
  if (cur === "$" || cur === "US$") cur = "USD";
  if (cur === "₹" || cur === "RS" || cur === "RS.") cur = "INR";
  return cur;
}

/**
 * Expand abbreviated thousand ranges: "USD 30–35,000" → 30000..35000
 * (not 30..35000).
 */
function expandAbbreviatedRange(a: number, aRaw: string, b: number): number {
  if (!(a > 0 && b > a) || aRaw.includes(",")) return a;
  if (a >= 1000 || b < 10_000) return a;
  const mag = Math.floor(Math.log10(b)) - Math.floor(Math.log10(a));
  if (mag < 2) return a;
  return a * Math.pow(10, mag);
}

/**
 * Extract commercial money from free text. Prefers amounts near
 * outstanding/invoice language; avoids first-token traps and agent
 * confusion like "USD 1,319,048 (in INR, but stated as USD 30–35,000)".
 */
function moneyFromText(
  text: string,
): { amountUsd: number; currency: string } | undefined {
  if (!text?.trim()) return undefined;

  // Prefer explicit USD/INR ranges (take midpoint of additionally-required band)
  const range = text.match(
    /\b(?:USD|US\$|\$)\s*([\d,]+)\s*[–—-]\s*([\d,]+)/i,
  );
  if (range && /additional|required|another|extra|about|approx/i.test(text)) {
    let a = Number(range[1].replace(/,/g, ""));
    const b = Number(range[2].replace(/,/g, ""));
    if (Number.isFinite(a) && Number.isFinite(b)) {
      a = expandAbbreviatedRange(a, range[1], b);
      const mid = (a + b) / 2;
      return { amountUsd: mid, currency: "USD" };
    }
  }

  const hits: { amount: number; currency: string; index: number; score: number }[] =
    [];
  const push = (curRaw: string, amtRaw: string, index: number) => {
    const amount = Number(String(amtRaw).replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const currency = normalizeMoneyCur(curRaw);
    const window = text.slice(Math.max(0, index - 48), index + 64);
    let score = 0;
    if (/\b(outstanding|pending|invoice|receivable|due)\b/i.test(window))
      score += 6;
    if (/\b(total\s+referenced|balance|owes?)\b/i.test(window)) score += 4;
    if (/\b(additionally\s+required|extra|another)\b/i.test(window)) score += 5;
    if (/\bin\s+INR\b/i.test(window) && currency === "USD") score -= 8;
    if (amount >= 1_000_000) score -= 2; // large round figures often aggregates
    hits.push({ amount, currency, index, score });
  };

  // ₹ and $ are not word characters, so a leading \b never matches "₹16,176".
  const re1 =
    /(?<![\w])(USD|INR|EUR|GBP|\$|₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/gi;
  const re2 = /\b([\d,]+(?:\.\d+)?)\s*(USD|INR|EUR|GBP|Rs\.?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text))) push(m[1], m[2], m.index);
  while ((m = re2.exec(text))) push(m[2], m[1], m.index);

  if (!hits.length) return undefined;
  hits.sort((a, b) => b.score - a.score || a.amount - b.amount);
  const best = hits[0]!;
  // If top score is weak and a much smaller high-score alternative exists, prefer smaller
  const alt = hits.find(
    (h) => h.score >= best.score - 1 && h.amount < best.amount / 5,
  );
  const chosen = alt && best.amount >= 500_000 ? alt : best;
  return {
    amountUsd: toUsd(chosen.amount, chosen.currency),
    currency: chosen.currency,
  };
}

const REMITTANCE_RE =
  /\b(payment\s+received|funds\s+received|remittance\s+confirmed|tt\s+received|paid\s+in\s+full|amount\s+credited|complete\s+payment|fully\s+settled|receipt\s+confirmed)\b/i;

/** Payment advice attached is not confirmation the exporter received the money. */
function adviceWithoutReceipt(summary: string): boolean {
  return (
    /\bpayment\s+advice\b/i.test(summary) && !REMITTANCE_RE.test(summary)
  );
}

function looseDateToIso(raw: string): string | undefined {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!dmy) return undefined;
  const day = dmy[1].padStart(2, "0");
  const month = dmy[2].padStart(2, "0");
  let year = dmy[3];
  if (year.length === 2) year = Number(year) > 50 ? `19${year}` : `20${year}`;
  const monthNum = Number(month);
  const dayNum = Number(day);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return undefined;
  return `${year}-${month}-${day}`;
}

/** Invoice / "dated 17.05.2024" anchor. Ignores a later advice timestamp. */
function extractDatedIso(summary: string): string | undefined {
  const labeled = summary.match(
    /(?:invoice\s+date|dated|due(?:\s+date)?)\s*[^\d]{0,16}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
  );
  if (labeled) {
    const iso = looseDateToIso(labeled[1]);
    if (iso) return iso;
  }
  return summary.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
}

const GLOBAL_PRAISE_RE = /global\s*praise/i;

function textIsGlobalPraise(value: unknown): boolean {
  if (typeof value === "string") return GLOBAL_PRAISE_RE.test(value);
  if (Array.isArray(value)) return value.some(textIsGlobalPraise);
  return false;
}

/**
 * Britannia → Waldos (Mexico) exports ship on Global Praise paper, even when
 * the thread itself never names Global Praise (PO 4329707).
 */
const BRITANNIA_RE = /britt?ann?ia|britindia\.com/i;
const WALDOS_LANE_RE = /waldos|grupo\s*vizion|grupovizion|lazaro\s*cardenas|mexico/i;

/** Global Praise named anywhere in the deal's headers, subjects, parties or summary. */
function textNamesTrader(text: string): boolean {
  if (GLOBAL_PRAISE_RE.test(text) || /globalpraise/i.test(text)) return true;
  return BRITANNIA_RE.test(text) && WALDOS_LANE_RE.test(text);
}

function partyIsGlobalPraise(
  row: ProcessedDealRow,
  result: Record<string, unknown>,
): boolean {
  const json = row.parties_json || {};
  const headerText = [
    row.subject || "",
    row.summary || "",
    str(result.summary) || "",
    buildDealSearchText(row),
  ].join(" ");
  return (
    textNamesTrader(headerText) ||
    textIsGlobalPraise(result.factory) ||
    textIsGlobalPraise(result.shipper) ||
    textIsGlobalPraise(result.buyer) ||
    textIsGlobalPraise(result.consignee) ||
    textIsGlobalPraise(result.buyerCompany) ||
    textIsGlobalPraise(json.buyers) ||
    textIsGlobalPraise(json.buyer) ||
    textIsGlobalPraise(json.factories) ||
    textIsGlobalPraise(json.factory) ||
    textIsGlobalPraise(json.traders) ||
    textIsGlobalPraise(json.trader)
  );
}

type StatedSplit = { advance: number; balance: number; blDeferred: boolean };

/**
 * Percents actually written on the order. "100% TT 30 days from B/L" is one
 * payment, not the 30/70 visibility default.
 */
function statedBuyerSplit(deal: Deal): StatedSplit | null {
  const text = [
    deal.po?.paymentTerms,
    deal.pi?.paymentTerms,
    deal.payment?.summary,
    deal.po?.summary,
  ]
    .filter(Boolean)
    .join("\n");
  if (!text.trim()) return null;
  if (!/\b(payment|t\/?t|advance|balance|b\/?l|bill of lading)\b/i.test(text)) {
    return null;
  }
  const slash = text.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  let advance: number | null = null;
  let balance: number | null = null;
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    if (a + b === 100 && a > 0 && b > 0) {
      advance = a;
      balance = b;
    }
  }
  if (advance == null) {
    const percents = [...text.matchAll(/(\d{1,3})\s*%/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n > 0 && n <= 100);
    if (percents.length >= 2 && percents[0]! + percents[1]! === 100) {
      advance = percents[0]!;
      balance = percents[1]!;
    } else if (percents.includes(100) && percents.every((n) => n === 100)) {
      advance = 0;
      balance = 100;
    } else if (percents.length === 1 && percents[0]! < 100) {
      advance = percents[0]!;
      balance = 100 - percents[0]!;
    }
  }
  if (advance == null || balance == null) return null;
  const blDeferred =
    /\b(\d{1,3})\s*days\b[\s\S]{0,40}\b(?:b\/?l|bill of lading)\b/i.test(text) ||
    /\b(?:from|after|upon|against)\b[\s\S]{0,40}\b(?:b\/?l|bill of lading|documents?)\b/i.test(
      text,
    );
  return { advance, balance, blDeferred };
}

/** Deal Board id for a processed_deals row id (po:…, topic:…). */
export function slugId(id: string) {
  const slug = id
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 100);
  return `mb-${slug || "deal"}`;
}

function dealCode(
  row: ProcessedDealRow,
  result: Record<string, unknown>,
  poNumbers: string[],
): string {
  return dealCodeFor({
    id: row.id,
    poNumbers,
    subject: row.subject,
    bookingNumber: str(result.bookingNumber),
  });
}

function parties(
  row: ProcessedDealRow,
  result: Record<string, unknown>,
  model: string,
): Party[] {
  const json = row.parties_json || {};
  const buyers = json.buyers || json.buyer || [];
  const factories = json.factories || json.factory || [];
  const traders = json.traders || json.trader || [];
  const out: Party[] = [
    {
      role: model === "trader_principal" ? "trader" : "agency",
      name: model === "trader_principal" ? "Global Praise" : "SNSPL",
      company:
        model === "trader_principal"
          ? "Global Praise Limited"
          : "Savvy Net Sourcing",
    },
  ];
  // Global Praise is the trader in the middle, never the buyer or the factory
  // (its PI to Shetler names it as "factory"; its PO to Anupama as "buyer").
  const firstParty = (...names: (string | undefined)[]) =>
    names.find((n) => n && !isTraderParty(n));
  const buyerName = firstParty(
    str(result.buyerCompany),
    str(result.buyer),
    str(result.consignee),
    ...buyers,
  );
  if (buyerName) out.push({ role: "buyer", name: buyerName, company: buyerName });
  const factoryName = firstParty(
    str(result.factory),
    str(result.factoryName),
    str(result.shipper),
    ...factories,
  );
  if (factoryName)
    out.push({ role: "factory", name: factoryName, company: factoryName });
  for (const t of traders) {
    if (t && !out.some((p) => p.name === t)) {
      out.push({ role: "trader", name: t, company: t });
    }
  }
  return out;
}

function evidenceFrom(row: ProcessedDealRow): EvidencePayload {
  const raw = row.evidence_json;
  if (raw && typeof raw === "object") return raw as EvidencePayload;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as EvidencePayload;
    } catch {
      return {};
    }
  }
  return {};
}

/** Party + mail header tokens for Deal Board / copilot search. */
export function buildDealSearchText(
  row: ProcessedDealRow,
  evidence?: EvidencePayload,
): string {
  if (row.search_text && String(row.search_text).trim()) {
    return String(row.search_text).slice(0, 12_000);
  }
  const ev = evidence || evidenceFrom(row);
  const parts: string[] = [
    row.subject || "",
    row.summary || "",
    JSON.stringify(row.parties_json || {}),
    JSON.stringify(row.po_numbers || []),
  ];
  for (const m of ev.messages || []) {
    parts.push(
      m.from || "",
      m.from_name || "",
      joinAddrs(m.to) || "",
      joinAddrs(m.cc) || "",
      joinAddrs(m.bcc) || "",
      m.subject || "",
    );
  }
  return parts.filter(Boolean).join(" ").slice(0, 12_000);
}

function joinAddrs(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).join(", ");
    return joined || undefined;
  }
  return String(value);
}

function resolveAttachmentUrl(
  a: { name?: string; url?: string; path?: string },
  primaryUrl?: string,
  primaryName?: string,
): string | undefined {
  // Prefer digest → /api/ingest-files (fresh sign). Stored presigns expire ~7d.
  const viaDigest = ingestFileOpenUrl({
    path: a.path,
    name: a.name,
    url: a.url,
  });
  if (viaDigest) return viaDigest;
  if (a.url) return a.url;
  const isPrimary = Boolean(primaryName) && a.name === primaryName;
  if (isPrimary && primaryUrl) {
    return ingestFileOpenUrl({ name: primaryName, url: primaryUrl }) || primaryUrl;
  }
  return undefined;
}

function buildSources(
  row: ProcessedDealRow,
  result: Record<string, unknown>,
  summary: string,
  slot: string,
  kind: SourceMessageKind,
  fullEvidence = false,
): SourceMessage[] {
  const evidence = evidenceFrom(row);
  const messages = evidence.messages || [];
  const extractedBy = slot || undefined;
  const extractedSummary = summary.slice(0, 280);
  const bodyLimit = fullEvidence ? 50_000 : 1_200;
  const primaryUrl = evidence.document_url || row.document_url || undefined;
  const primaryName = evidence.document_name || row.document_name || row.document || undefined;

  if (messages.length > 0) {
    return messages.map((m, i) => {
      const body = (m.body || "").trim();
      const preview =
        !fullEvidence && body.length > bodyLimit
          ? `${body.slice(0, bodyLimit)}\n\n[truncated — open View source after evidence load for full mail]`
          : body;
      return {
        id: `${row.id}-msg-${m.id || i}`,
        kind: i === 0 ? kind : "other",
        subject: m.subject || row.subject || undefined,
        from: m.from_name
          ? `${m.from_name} <${m.from || ""}>`
          : m.from || undefined,
        to: joinAddrs(m.to),
        cc: joinAddrs(m.cc),
        bcc: joinAddrs(m.bcc),
        receivedAt: m.date || row.date_end || row.processed_at || undefined,
        body: preview || summary,
        label: m.subject || `Message ${i + 1}`,
        attachments: (m.attachments || [])
          .filter((a) => a?.name)
          .map((a) => {
            const isPrimary =
              Boolean(primaryName) && a.name === primaryName;
            return {
              name: a.name!,
              url: resolveAttachmentUrl(a, primaryUrl, primaryName),
              samplePath: a.path || undefined,
              extractedBy: isPrimary ? extractedBy : undefined,
              extractedSummary: isPrimary ? extractedSummary : undefined,
            };
          }),
        extractedBy: i === 0 ? extractedBy : undefined,
        extractedSummary: i === 0 ? extractedSummary : undefined,
      };
    });
  }

  const emailText = (evidence.email_text || "").trim();
  const body =
    emailText ||
    (str(result.summary) ? `Agent summary:\n${summary}` : summary);
  const attachments =
    primaryName || primaryUrl
      ? [
          {
            name: primaryName || "attachment",
            url:
              primaryUrl ||
              ingestFileOpenUrl({ name: primaryName, url: primaryUrl }),
            extractedBy,
            extractedSummary,
          },
        ]
      : undefined;

  return [
    {
      id: `${row.id}-src`,
      kind,
      subject: row.subject || undefined,
      receivedAt: row.date_end || row.processed_at || undefined,
      body: body.slice(0, fullEvidence ? 50_000 : 16_000),
      label: row.subject || "Mailbox thread",
      attachments,
      extractedBy,
      extractedSummary,
    },
  ];
}

function buildTimelineFromSources(
  row: ProcessedDealRow,
  sources: SourceMessage[],
  summary: string,
  updated: string,
): Deal["timeline"] {
  if (sources.length === 0) {
    return [
      {
        id: `${row.id}-tl`,
        at: updated,
        channel: "email",
        title:
          row.status === "completed" ? "Mailbox extracted" : "Mailbox ingest",
        detail: summary.slice(0, 280),
      },
    ];
  }
  const created = sources
    .map((s) => ({
      id: `${s.id}-tl`,
      at: s.receivedAt || updated,
      channel: "email" as const,
      title: s.subject || s.label || "Mailbox message",
      detail: [
        s.from ? `From ${s.from}` : null,
        s.cc ? `Cc ${s.cc}` : null,
        (s.body || "").replace(/\s+/g, " ").slice(0, 160) || null,
      ]
        .filter(Boolean)
        .join(" · "),
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // Cap very long threads for the timeline UI
  if (created.length <= 40) return created;
  const head = created.slice(0, 12);
  const mid = created.slice(
    Math.floor(created.length / 2) - 4,
    Math.floor(created.length / 2) + 4,
  );
  const tail = created.slice(-16);
  const seen = new Set<string>();
  return [...head, ...mid, ...tail].filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

function commercialFrom(
  result: Record<string, unknown>,
  docType: "pi" | "po",
  executionId?: string,
): CommercialDocument {
  const summaryCur = moneyFromText(str(result.summary) || "")?.currency;
  const currency = str(result.currency) || summaryCur || "USD";
  const total = num(result.totalAmount);
  const lines = Array.isArray(result.lines)
    ? result.lines.map((line) => {
        const item = asRecord(line);
        return {
          description: str(item.description),
          qty: num(item.qty),
          unitPrice: num(item.unitPrice),
          amount: num(item.amount),
          itemCode: str(item.itemCode),
          cbm: num(item.cbm),
          packing: str(item.packing),
        };
      })
    : [];
  return {
    docType,
    docNumber: str(result.docNumber),
    shipper: str(result.shipper),
    consignee: str(result.consignee),
    buyer: str(result.buyer),
    factory: str(result.factory),
    incoterm: str(result.incoterm),
    paymentTerms: str(result.paymentTerms),
    pol: str(result.pol),
    pod: str(result.pod),
    currency,
    totalAmount: total != null ? toUsd(total, currency) : undefined,
    totalCbm: num(result.totalCbm),
    readyDate: str(result.readyDate),
    lines,
    summary: str(result.summary),
    confidence: num(result.confidence),
    executionId,
  };
}

export type DealDocumentRow = {
  name?: string | null;
  sha256?: string | null;
  sent_at?: string | null;
  slot?: string | null;
  result?: unknown;
};

const INVOICE_NAME_RE = /\b(commercial\s+invoice|comm\.?\s*inv|tax\s+invoice|invoice|inv)\b/i;
const PROFORMA_NAME_RE = /\b(pro\s*-?\s*forma|performa|pi)\b/i;
const REVISION_NAME_RE = /\b(revised|revision|rev\.?\s*\d*|final|amended|updated)\b/i;

function isInvoiceDoc(doc: CommercialDocument) {
  const name = doc.fileName || "";
  return INVOICE_NAME_RE.test(name) && !PROFORMA_NAME_RE.test(name);
}

function sentAtFor(name: string | undefined, evidence: EvidencePayload) {
  if (!name) return undefined;
  const hit = (evidence.messages || []).find((m) =>
    (m.attachments || []).some((a) => a.name === name),
  );
  return hit?.date;
}

function parseDocRows(value: unknown): DealDocumentRow[] {
  if (typeof value === "string") {
    try {
      return parseDocRows(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as DealDocumentRow[]) : [];
}

/** Newest first; on the same send time a "revised" / "final" file wins. */
function newerFirst(a: CommercialDocument, b: CommercialDocument) {
  const ta = Date.parse(a.sentAt || "") || 0;
  const tb = Date.parse(b.sentAt || "") || 0;
  if (ta !== tb) return tb - ta;
  return Number(REVISION_NAME_RE.test(b.fileName || "")) - Number(REVISION_NAME_RE.test(a.fileName || ""));
}

type SideTotal = { usd: number; doc: CommercialDocument; count: number };

/**
 * Total for one side. Commercial invoices are what was billed, so they win over
 * PIs / POs when present. Documents with the same number are versions of one
 * document (PI 013 and its revision; Shetler's PO and GP's PI for the same
 * order): only the newest counts. Different numbers are different orders and add up.
 */
function sideTotal(docs: CommercialDocument[], side: "buyer" | "factory"): SideTotal | undefined {
  const priced = docs.filter(
    (d) =>
      d.side === side &&
      (d.totalAmount || 0) > 0 &&
      !isNonCommercialFile(d.fileName),
  );
  if (!priced.length) return undefined;
  const invoices = priced.filter(isInvoiceDoc);
  const pool = invoices.length ? invoices : priced;
  const seen = new Set<string>();
  const counted: CommercialDocument[] = [];
  for (const d of pool) {
    const key = (d.docNumber || d.fileName || `${counted.length}`).replace(/\s+/g, "").toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    counted.push(d);
  }
  const usd = counted.reduce((n, d) => n + (d.totalAmount || 0), 0);
  const currencies = new Set(counted.map((d) => (d.currency || "USD").toUpperCase()));
  const newest = counted[0]!;
  const doc: CommercialDocument = {
    ...newest,
    totalAmount: usd,
    currency: currencies.size === 1 ? [...currencies][0] : "USD",
    summary:
      counted.length > 1
        ? `${counted.length} ${side} documents: ${counted.map((d) => d.fileName || d.docNumber).join(", ")}`
        : newest.summary,
  };
  return { usd, doc, count: counted.length };
}

/**
 * Put every extracted PI / PO / invoice on the deal: the main extract plus the
 * per-document extracts in documents_json. deal.po becomes the buyer side and
 * deal.pi the factory side, whatever the files are called.
 */
function applyCommercialDocs(
  deal: Deal,
  row: ProcessedDealRow,
  result: Record<string, unknown>,
  slot: string,
  executionId: string | undefined,
  evidence: EvidencePayload,
): { buyerTotalUsd?: number; factoryTotalUsd?: number; freightOnly: boolean } {
  const docs: CommercialDocument[] = [];
  const primaryName = evidence.document_name || row.document_name || undefined;
  if (slot === "pi_extractor" || slot === "po_extractor") {
    docs.push({
      ...commercialFrom(result, slot === "po_extractor" ? "po" : "pi", executionId),
      fileName: primaryName,
      sentAt: sentAtFor(primaryName, evidence) || row.date_end || undefined,
    });
  }
  for (const d of parseDocRows(row.documents_json)) {
    const res = asResult(d.result);
    if (!Object.keys(res).length) continue;
    const fileName = d.name || undefined;
    const extract: CommercialDocument = {
      ...commercialFrom(res, d.slot === "po_extractor" ? "po" : "pi"),
      fileName,
      sentAt: d.sent_at || sentAtFor(fileName, evidence) || undefined,
    };
    const same = docs.findIndex((x) => x.fileName && x.fileName === fileName);
    if (same >= 0) docs[same] = extract; // a per-document re-read replaces the main extract
    else docs.push(extract);
  }
  if (!docs.length) return { freightOnly: false };

  for (const d of docs) d.side = documentSide(d);
  docs.sort(newerFirst);
  deal.commercialDocs = docs;

  const buyer = sideTotal(docs, "buyer");
  const factory = sideTotal(docs, "factory");
  if (buyer) deal.po = buyer.doc;
  if (factory) deal.pi = factory.doc;
  const freight = docs.find((d) => d.side === "freight");
  if (freight) deal.freightDoc = freight;
  return {
    buyerTotalUsd: buyer?.usd,
    factoryTotalUsd: factory?.usd,
    freightOnly: !buyer && !factory && Boolean(freight),
  };
}

export function mapProcessedDeal(
  row: ProcessedDealRow,
  opts?: { fullEvidence?: boolean },
): Deal | null {
  if (!row.id) return null;
  const result = asResult(row.result_json);
  const slot = row.slot || "";
  const stage = STAGE_MAP[row.primary_stage || ""] || "requirement";
  const created = row.date_start || row.processed_at || new Date().toISOString();
  const updated = row.date_end || row.processed_at || created;
  const summary =
    str(row.summary) || str(result.summary) || row.subject || "Mailbox deal";
  const executionId = row.agent_id || undefined;
  const kind = SOURCE_KIND[slot] || "other";
  const currencyFromResult = str(result.currency);
  const moneyHit = moneyFromText(summary);
  const summaryHasUsd = /(?:\bUSD\b|US\$|(?<![\w])\$)\s*[\d,]/i.test(summary);
  const summaryHasInr = /(?:\bINR\b|₹|\bRs\.?)\s*[\d,]/i.test(summary);
  // Agent often omits result.currency while summary says "Origin charges INR …"
  const currencyHint =
    currencyFromResult ||
    moneyHit?.currency ||
    (summaryHasInr && !summaryHasUsd ? "INR" : undefined);
  let extractedAmount =
    num(result.amountUsd) ??
    (num(result.totalAmount) != null
      ? toUsd(num(result.totalAmount)!, currencyHint)
      : undefined) ??
    moneyHit?.amountUsd;
  let settlementCurrency =
    (currencyFromResult || moneyHit?.currency || currencyHint || "").toUpperCase() ||
    undefined;
  // amountUsd is often a private FX conversion of a rupee invoice
  // (Henlo ₹16,176 stored as $194). Keep the rupee figure at the display FX.
  if (summaryHasInr && !summaryHasUsd && moneyHit?.currency === "INR") {
    extractedAmount = moneyHit.amountUsd;
    settlementCurrency = "INR";
  }
  const storedModel =
    row.commercial_model === "trader_principal" ||
    (row.commercial_model !== "agency_commission" &&
      str(result.commercialModel) === "trader_principal")
      ? "trader_principal"
      : "agency_commission";
  const gpOverride =
    storedModel !== "trader_principal" && partyIsGlobalPraise(row, result);
  const pinnedModel =
    row.commercial_model_override === "trader_principal" ||
    row.commercial_model_override === "agency_commission"
      ? row.commercial_model_override
      : undefined;
  const commercialModel = pinnedModel || (gpOverride ? "trader_principal" : storedModel);
  /** Local freight / origin-charges extracts are not trade order value. */
  let localChargesOnly = isLocalChargesNarrative(summary);

  const evidence = evidenceFrom(row);
  // Stored PO first, then every PO written in the thread's subjects / summary
  // ("PO # G 2625017, G 2625076, G 2625077, G 2525089" is four orders).
  const poNumbers = cleanPoNumbers([
    ...(row.po_numbers || []),
    ...poNumbersIn(`${row.subject || ""} ${buildDealSearchText(row, evidence)}`),
  ]);
  const sources = buildSources(
    row,
    result,
    summary,
    slot,
    kind,
    Boolean(opts?.fullEvidence),
  );
  const betterTitle =
    str(result.summary)?.slice(0, 140) ||
    (row.subject || row.id).slice(0, 140);

  const deal: Deal = {
    id: slugId(row.id),
    code: dealCode(row, result, poNumbers),
    title: betterTitle,
    stage,
    createdAt: created,
    updatedAt: updated,
    mailboxIngest: true,
    mailboxSourceId: row.id,
    mailboxPoNumbers: poNumbers,
    mailboxSlot: slot || undefined,
    searchText: buildDealSearchText(row, evidence),
    commercialModel,
    commercialModelPinned: Boolean(pinnedModel),
    agentResult: Object.keys(result).length ? result : undefined,
    parties: parties(row, result, commercialModel),
    documents:
      evidence.document_name ||
      row.document_name ||
      row.document ||
      (row.doc_count || 0) > 0
        ? [
            {
              id: `${row.id}-doc`,
              name:
                evidence.document_name ||
                row.document_name ||
                row.document ||
                `${slot || "mailbox"} attachment`,
              type: DOC_TYPE[slot] || "other",
              uploadedAt: updated,
              url:
                evidence.document_url ||
                row.document_url ||
                ingestFileOpenUrl({
                  name:
                    evidence.document_name ||
                    row.document_name ||
                    row.document,
                  url: evidence.document_url || row.document_url,
                }),
              extractedBy: slot || undefined,
              extractedSummary: summary.slice(0, 220),
            },
          ]
        : [],
    sources,
    timeline: buildTimelineFromSources(row, sources, summary, updated),
    outreach: [],
  };

  if (slot === "requirement_extractor" || stage === "requirement") {
    const req: RequirementFields = {
      productCategory: str(result.productCategory),
      materials: str(result.materials),
      targetFactoryCost: num(result.targetFactoryCost),
      currency: str(result.currency),
      destination: str(result.destination),
      buyerCompany: str(result.buyerCompany),
      buyerContacts: Array.isArray(result.buyerContacts)
        ? result.buyerContacts.filter((x): x is string => typeof x === "string")
        : undefined,
      urgency: str(result.urgency),
      currentSourcingNotes: str(result.currentSourcingNotes),
      packingRequirements: str(result.packingRequirements),
      complianceNotes: str(result.complianceNotes),
      openQuestions: Array.isArray(result.openQuestions)
        ? result.openQuestions.filter((x): x is string => typeof x === "string")
        : undefined,
      nextActions: Array.isArray(result.nextActions)
        ? result.nextActions.filter((x): x is string => typeof x === "string")
        : undefined,
      subject: str(result.subject) || row.subject || undefined,
      summary,
      confidence: num(result.confidence) ?? row.confidence ?? undefined,
    };
    deal.requirement = req;
  }

  if (slot === "quote_normalizer") {
    const quote: QuoteMatrix = {
      factoryName: str(result.factoryName),
      currency: str(result.currency),
      quoteDate: str(result.quoteDate),
      incoterm: str(result.incoterm),
      paymentTerms: str(result.paymentTerms),
      leadTimeDays: num(result.leadTimeDays),
      notes: str(result.notes) || summary,
      confidence: num(result.confidence),
      skus: Array.isArray(result.skus)
        ? result.skus.map((sku) => {
            const item = asRecord(sku);
            return {
              itemCode: str(item.itemCode),
              description: str(item.description),
              moq: num(item.moq),
              unitPrice: num(item.unitPrice),
              currency: str(item.currency) || str(result.currency),
              packingNotes: str(item.packingNotes),
              selected: true,
            };
          })
        : [],
      executionId,
    };
    deal.quote = quote;
  }

  // Every PI / PO / invoice on the deal, sorted into buyer, factory and freight.
  const commercial = applyCommercialDocs(deal, row, result, slot, executionId, evidence);
  if (commercial.freightOnly) localChargesOnly = true;
  if (commercial.buyerTotalUsd != null || commercial.factoryTotalUsd != null) {
    extractedAmount = commercial.buyerTotalUsd ?? commercial.factoryTotalUsd;
    const cur = deal.po?.currency || deal.pi?.currency;
    if (cur) settlementCurrency = cur.toUpperCase();
  }

  if (slot === "booking_extractor") {
    const booking: BookingDetails = {
      bookingNumber: str(result.bookingNumber),
      carrier: str(result.carrier),
      vessel: str(result.vessel),
      voyage: str(result.voyage),
      pol: str(result.pol),
      pod: str(result.pod),
      etd: str(result.etd),
      eta: str(result.eta),
      equipment: str(result.equipment),
      cutOffs: str(result.cutOffs),
      summary,
      confidence: num(result.confidence),
      executionId,
    };
    const etd = booking.etd ? Date.parse(booking.etd) : NaN;
    const eta = booking.eta ? Date.parse(booking.eta) : NaN;
    const now = Date.now();
    if (!Number.isNaN(etd) && etd < now && !Number.isNaN(eta) && eta > now) {
      booking.shipmentStatus = "in_waters";
    } else if (!Number.isNaN(etd) && etd >= now) {
      booking.shipmentStatus = "about_to_sail";
    } else if (!Number.isNaN(eta) && eta <= now) {
      booking.shipmentStatus = "arrived";
    }
    deal.booking = booking;
  }

  if (slot === "final_docs_pack_check") {
    const asStringList = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((x): x is string => typeof x === "string")
        : [];
    deal.docsPack = {
      required: asStringList(result.required),
      present: asStringList(result.present),
      missing: asStringList(result.missing),
      complete: Boolean(result.complete),
      summary,
      confidence: num(result.confidence),
      executionId,
    };
    // Surface logistics fields on booking when present
    if (
      str(result.vessel) ||
      str(result.pol) ||
      str(result.pod) ||
      str(result.container)
    ) {
      deal.booking = {
        ...(deal.booking || {}),
        vessel: str(result.vessel),
        pol: str(result.pol),
        pod: str(result.pod),
        etd: str(result.etd),
        eta: str(result.eta),
        equipment: str(result.container),
        summary,
        confidence: num(result.confidence),
        executionId,
      };
    }
  }

  if (slot === "payment_clock") {
    const rawStatus = str(result.status)?.toLowerCase() || "pending";
    let status = PAYMENT_STATUS.has(rawStatus as PaymentClock["status"])
      ? (rawStatus as PaymentClock["status"])
      : "pending";
    // Outstanding / unpaid language → overdue when not paid
    if (
      status !== "paid" &&
      /\b(outstanding|pending\s+payment|payment\s+confirmation\s+is\s+pending|awaits?\s+payment|not\s+yet\s+paid)\b/i.test(
        summary,
      )
    ) {
      status = "overdue";
    }
    // Invoice date in summary as due anchor when agent omitted dueDate.
    // Dotted Indian dates (17.05.2024) are the invoice, not the later advice day.
    const invoiceDate =
      looseDateToIso(str(result.dueDate) || "") || extractDatedIso(summary);
    // A payment advice is not receipt. Henlo TPD/2024-25/04 stayed outstanding.
    if (adviceWithoutReceipt(summary)) {
      const dueMs = invoiceDate ? Date.parse(`${invoiceDate}T12:00:00Z`) : NaN;
      status =
        !Number.isNaN(dueMs) && dueMs > Date.now() ? "pending" : "overdue";
    }
    deal.payment = {
      blSharedDate: str(result.blSharedDate),
      dueDate: invoiceDate,
      daysRemaining: num(result.daysRemaining),
      status,
      amountUsd: extractedAmount,
      currency: settlementCurrency || "USD",
      summary,
      confidence: num(result.confidence),
      executionId,
    };
  }

  if (extractedAmount && extractedAmount > 0 && !localChargesOnly) {
    const paid = deal.payment?.status === "paid";
    deal.economics = {
      commercialValueUsd: extractedAmount,
      agencyCommissionUsd: extractedAmount * 0.05,
      cycleDaysTypical: 60,
      cycleDaysElapsed: Math.max(
        1,
        Math.floor((Date.now() - Date.parse(created)) / 86400000),
      ),
      commercialCashAtRiskUsd: deal.payment?.status === "overdue" ? extractedAmount : 0,
      agencyCashAtRiskUsd: 0,
      agencyInflowNext14dUsd: paid ? 0 : extractedAmount * 0.05,
      riskRewardRatio: 1,
      affordability: "comfortable",
      liquidityNote: summary.slice(0, 160),
      sources: [],
      summary,
    };
    deal.paymentSchedule = inferSchedule(deal, extractedAmount, paid);
    const deployed =
      paid || deal.stage === "docs_payment" || deal.stage === "booking"
        ? extractedAmount
        : Math.round(extractedAmount * 0.3);
    deal.cashExposure = {
      pipelineCommitmentUsd: extractedAmount,
      cashDeployedUsd: deployed,
      cashStillRequiredUsd: Math.max(0, extractedAmount - deployed),
      receivableExpectedUsd: paid ? 0 : extractedAmount,
      receivableDueDate: deal.payment?.dueDate,
      receivableStatus: paid
        ? "collected"
        : deal.payment?.status === "overdue"
          ? "overdue"
          : "expected",
      blockedAt:
        deal.stage === "booking"
          ? "transit"
          : deal.stage === "docs_payment"
            ? paid
              ? "none"
              : "buyer"
            : "vendor",
      sources: [],
    };
  } else if (localChargesOnly && extractedAmount && extractedAmount > 0) {
    // Keep ops visibility of freight/GST extracts without treating them as
    // trade order value (avoids phantom buyer overdue / commission).
    deal.economics = {
      commercialValueUsd: 0,
      agencyCommissionUsd: 0,
      cycleDaysTypical: 60,
      cycleDaysElapsed: Math.max(
        1,
        Math.floor((Date.now() - Date.parse(created)) / 86400000),
      ),
      commercialCashAtRiskUsd: 0,
      agencyCashAtRiskUsd: 0,
      agencyInflowNext14dUsd: 0,
      riskRewardRatio: 1,
      affordability: "comfortable",
      liquidityNote: `Local charges only (not trade commercial) · ${summary.slice(0, 120)}`,
      sources: [],
      summary,
    };
  }

  return deal;
}

/**
 * Keep sub-cent precision: amounts are stored in USD and shown back in the
 * document's currency, and whole-dollar rounding turned ₹38,764.11 into ₹38,784.
 * Display rounds.
 */
function cents(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

function isoDay(value?: string, fallback?: string) {
  const raw = value || fallback || new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function inferSchedule(
  deal: Deal,
  amount: number,
  paid: boolean,
): Deal["paymentSchedule"] {
  const model = deal.commercialModel || "agency_commission";
  // A Global Praise deal with only factory-side documents has no buyer amount
  // yet: don't present what GP owes the factory as what the buyer owes GP.
  const buyerAmount: number | undefined =
    deal.po?.totalAmount ||
    (model === "trader_principal" && deal.pi?.totalAmount && !deal.payment ? undefined : amount);
  // Only a factory PI gives a factory amount. No estimate from the buyer value:
  // an 88% guess showed up on the boards as a real factory bill (PO G 2625134).
  const factoryAmount = deal.pi?.totalAmount;
  const currency =
    deal.payment?.currency ||
    deal.po?.currency ||
    deal.pi?.currency ||
    "USD";

  const due = isoDay(
    deal.payment?.dueDate,
    deal.booking?.etd || deal.updatedAt,
  );
  const remittanceConfirmed =
    (paid ||
      REMITTANCE_RE.test(
        deal.payment?.summary || deal.economics?.summary || "",
      )) &&
    !adviceWithoutReceipt(deal.payment?.summary || "");
  const openStatus = (
    dueDate: string,
  ): "upcoming" | "due" | "overdue" => {
    const dueMs = Date.parse(`${dueDate}T12:00:00`);
    if (Number.isNaN(dueMs)) {
      return deal.payment?.status === "overdue" ? "overdue" : "upcoming";
    }
    const days = Math.round((Date.now() - dueMs) / 86400000);
    if (days > 0 || deal.payment?.status === "overdue") return "overdue";
    if (days === 0 || deal.payment?.status === "due_soon") return "due";
    return "upcoming";
  };

  const summary = deal.payment?.summary || deal.economics?.summary || "";
  const outstandingOnly =
    deal.mailboxSlot === "payment_clock" ||
    (!deal.po?.totalAmount &&
      /\b(outstanding|pending\s+payment|awaits?\s+payment)\b/i.test(summary));

  // Single outstanding invoice line — do not invent fake 30/70 splits.
  if (outstandingOnly) {
    const status: "received" | "upcoming" | "due" | "overdue" =
      remittanceConfirmed ? "received" : openStatus(due);
    return {
      buyerTerms:
        deal.po?.paymentTerms ||
        "Outstanding invoice from payment mailbox thread",
      factoryTerms:
        deal.pi?.paymentTerms ||
        "Factory payable not extracted on this payment thread",
      currency,
      orderValueUsd: buyerAmount,
      checkpoints: [
        {
          id: `${deal.id}-out`,
          side: "buyer",
          label: "Outstanding invoice",
          percent: 100,
          amountUsd: Math.round((buyerAmount ?? amount) * 100) / 100,
          dueDate: due,
          status,
          receivedAt: status === "received" ? due : undefined,
          checkpoint: "Payment clock / invoice",
          confirmationSourceId: (deal.sources || []).find((s) =>
            ["payment", "commission"].includes(s.kind),
          )?.id,
          sourceIds: (deal.sources || [])
            .filter((s) => ["payment", "commission", "po"].includes(s.kind))
            .map((s) => s.id)
            .slice(0, 4),
          termsExcerpt: summary.slice(0, 180),
        },
      ],
    };
  }

  const stated = statedBuyerSplit(deal);
  const advancePct = stated?.advance ?? 30;
  const balancePct = stated?.balance ?? 70;
  const blKnown = Boolean(deal.payment?.blSharedDate || deal.booking?.etd);
  // "100% TT 30 days from B/L" is not due until a B/L date exists.
  const blDeferred = Boolean(stated?.blDeferred && !blKnown);
  const buyerTerms =
    deal.po?.paymentTerms ||
    (buyerAmount != null ? deal.pi?.paymentTerms : undefined) ||
    (buyerAmount == null
      ? "Buyer terms not read yet"
      : stated
        ? "Payment terms stated on the order"
        : "30% on PO acknowledgement · 70% T/T against B/L (inferred default)");
  const factoryTerms = deal.pi?.paymentTerms
    ? deal.pi.paymentTerms
    : factoryAmount != null
      ? "30% advance on PI · 70% against shipping docs (inferred default)"
      : "Factory PI not extracted yet — no factory amount on this deal";

  // Advance due: prefer explicit payment due / ETD — never createdAt (that
  // made every historic advance look years overdue).
  const advanceDue = isoDay(
    deal.payment?.dueDate,
    deal.booking?.etd || deal.updatedAt,
  );
  const balanceDue = due;

  const buyerAdvanceStatus: "received" | "upcoming" | "due" | "overdue" =
    remittanceConfirmed
      ? "received"
      : blDeferred
        ? "upcoming"
        : openStatus(advanceDue);
  const buyerBalanceStatus: "received" | "upcoming" | "due" | "overdue" =
    remittanceConfirmed
      ? "received"
      : blDeferred
        ? "upcoming"
        : openStatus(balanceDue);

  const buyerAdvance = cents(((buyerAmount ?? 0) * advancePct) / 100);
  const buyerBalance = Math.max(0, cents((buyerAmount ?? 0) - buyerAdvance));
  const buyerDue = (when: string | undefined) =>
    blDeferred ? undefined : when;

  const checkpoints: NonNullable<Deal["paymentSchedule"]>["checkpoints"] = [];
  if (buyerAmount != null && advancePct > 0) {
    checkpoints.push({
      id: `${deal.id}-b1`,
      side: "buyer",
      label: `Buyer advance ${advancePct}%`,
      percent: advancePct,
      amountUsd: buyerAdvance,
      dueDate: buyerDue(advanceDue),
      status: buyerAdvanceStatus,
      receivedAt: buyerAdvanceStatus === "received" ? advanceDue : undefined,
      checkpoint: "PO acknowledgement",
      confirmationSourceId: (deal.sources || []).find((s) =>
        ["po", "payment"].includes(s.kind),
      )?.id,
      sourceIds: (deal.sources || [])
        .filter((s) => ["po", "payment"].includes(s.kind))
        .map((s) => s.id)
        .slice(0, 4),
      termsExcerpt: buyerTerms.slice(0, 180),
    });
  }
  if (buyerAmount != null) checkpoints.push({
    id: `${deal.id}-b2`,
    side: "buyer",
    label:
      advancePct === 0 && balancePct === 100
        ? "Buyer payment 100%"
        : `Buyer balance ${balancePct}%`,
    percent: balancePct,
    amountUsd: buyerBalance,
    dueDate: buyerDue(balanceDue),
    status: buyerBalanceStatus,
    receivedAt: buyerBalanceStatus === "received" ? balanceDue : undefined,
    checkpoint: blDeferred
      ? /\bb\/?l\b|bill of lading/i.test(buyerTerms)
        ? "Awaiting B/L"
        : "Per stated terms"
      : "BL copy / payment clock",
    confirmationSourceId: (deal.sources || []).find((s) =>
      ["payment", "booking"].includes(s.kind),
    )?.id,
    sourceIds: (deal.sources || [])
      .filter((s) => ["payment", "booking"].includes(s.kind))
      .map((s) => s.id)
      .slice(0, 4),
    termsExcerpt: buyerTerms.slice(0, 180),
  });

  // Factory legs only when we have PI amount (or trader principal estimate).
  // Never mark factory paid just because buyer remittance confirmed (agency).
  if (factoryAmount != null && factoryAmount > 0) {
    const factoryAdvance = cents(factoryAmount * 0.3);
    const factoryBalance = Math.max(
      0,
      cents(factoryAmount - factoryAdvance),
    );
    const factoryPaid =
      model === "trader_principal" && remittanceConfirmed
        ? false // still require explicit factory pay evidence
        : false;
    const factoryAdvanceStatus: "received" | "upcoming" | "due" | "overdue" =
      factoryPaid ? "received" : openStatus(advanceDue);
    const factoryBalanceStatus: "received" | "upcoming" | "due" | "overdue" =
      factoryPaid ? "received" : openStatus(balanceDue);
    checkpoints.unshift(
      {
        id: `${deal.id}-f1`,
        side: "factory",
        label: "Factory advance 30%",
        percent: 30,
        amountUsd: factoryAdvance,
        dueDate: advanceDue,
        status: factoryAdvanceStatus,
        receivedAt:
          factoryAdvanceStatus === "received" ? advanceDue : undefined,
        checkpoint: "PI locked",
        confirmationSourceId: (deal.sources || []).find((s) =>
          ["pi", "payment"].includes(s.kind),
        )?.id,
        sourceIds: (deal.sources || [])
          .filter((s) => ["pi", "payment"].includes(s.kind))
          .map((s) => s.id)
          .slice(0, 4),
      },
      {
        id: `${deal.id}-f2`,
        side: "factory",
        label: "Factory balance 70%",
        percent: 70,
        amountUsd: factoryBalance,
        dueDate: balanceDue,
        status: factoryBalanceStatus,
        receivedAt:
          factoryBalanceStatus === "received" ? balanceDue : undefined,
        checkpoint: "Shipping docs / BL",
        confirmationSourceId: (deal.sources || []).find((s) =>
          ["payment", "booking"].includes(s.kind),
        )?.id,
        sourceIds: (deal.sources || [])
          .filter((s) => ["payment", "booking"].includes(s.kind))
          .map((s) => s.id)
          .slice(0, 4),
      },
    );
  }

  return {
    buyerTerms,
    factoryTerms,
    currency,
    orderValueUsd: buyerAmount,
    checkpoints,
  };
}
