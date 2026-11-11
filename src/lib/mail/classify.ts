/**
 * Deal classification for live mail — a TypeScript port of
 * scripts/pst-extract/cluster_threads.py + build_relevant_deals.py +
 * process_deals.py (choose_slot / pick_document). Keep the two in step:
 * PST backfills and connected inboxes must label deals the same way.
 */
import { extraDomains } from "./config";

const NOISE_DOMAINS = [
  "bsesdelhi.com",
  "vodafoneidea.com",
  "icicibank.com",
  "icici.bank.in",
  "hdfc",
  "tatapower",
  "airtel.com",
  "justdial.com",
  "hsbc.com",
  "lombard",
  "newsletter",
  "godaddy",
  "facebookmail.com",
  "linkedin.com",
  "mailchimp",
  "sendgrid.net",
  "subscribe.",
  "notification.",
  "no-reply",
  "noreply",
  "noresponse",
  "agoda.com",
  "airindia.com",
  "goindigo.in",
  "makemytrip.com",
  "booking.com",
  "expedia.",
  "irctc.",
  "mapyourshow.com",
];

const BUYER_DOMAINS = [
  "petrageousdesigns.com",
  "lovingpetsproducts.com",
  "thepetdimension.com",
  "babyking.com",
  "hut.com.mx",
  "neaterpets.com",
  "shetler.com",
  "waldos.com",
  "grupovizion.com.mx",
];

const FACTORY_DOMAINS = [
  "cottonsmiths.com",
  "swastikimpex.org",
  "aditiartswares@yahoo.co.in",
  "aditiartswares",
  "allana.com",
  "rajaryanexport.com",
  "ruparelindia.com",
  "centuryfilaments.com",
  "riexports.com",
  "snbenterprises.com",
  "ykindustries.co.in",
  "protectools.cn",
  "agrofoods.net",
  // Britannia Industries mails from britindia.com; it ships Waldos orders (PO 4329707).
  "britindia.com",
];

const FORWARDER_DOMAINS = [
  "icl-india.com",
  "skyline-freight.com",
  "mentor-freight.com",
  "wacbangladesh.com",
  "c-air.com",
  "expeditors.com",
  "cardinalgl.com",
  "deigratialogistics.com",
  "avmcargo.com",
  "in-asgroup.com",
  "pfmlindia.com",
];

const TRADER_MARKERS = ["globalpraisehk@gmail.com", "global praise", "globalpraise"];

const INTERNAL_DOMAINS = ["snspl.in"];

/** Free-mail domains — the connected address is internal, not the whole domain. */
const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "rediffmail.com",
  "proton.me",
  "protonmail.com",
]);

const FREIGHT_RE =
  /\b(1\s*x\s*40|1\s*x\s*20|40['’]?\s*hc|20['’]?\s*gp|\bh\/?bl\b|\bm\/?bl\b|bl draft|container|vgm|etd|eta\b|sailing|nhava\s*sheva|navasheva|mundra|forwarder|shipping bill|gated in|si submitted|cnee|shipper:|consignee|bill of lading|telex release|bkgconf|ocean freight|pol\b|pod\b)\b/i;
const PO_RE = /\bpo[#\s:-]*([a-z]?\s?\d[\dA-Za-z/-]{2,})/i;
const BOOKING_ID_RE = /\b(?:bkg|ebkg|bkgconf)[#\s:_-]*([A-Z0-9]{6,})\b/i;
const RFQ_RE =
  /\b(enquiry|inquiry|requirement|please quote|need pric|looking for|new item|new product|can you source|rfq|reorder)\b/i;
const QUOTE_RE = /\b(quotation|as sheet|price list|costing|fob\b)\b/i;
const PI_RE = /\b(proforma|\bpi\b|purchase order)\b/i;
const SAMPLE_RE = /\b(sample|proto|strike off|lab dip)\b/i;
const ARTWORK_RE = /\b(artwork|dieline|print file)\b/i;
const QC_RE = /\b(inspection|qc\b|aql)\b/i;
const PAY_RE = /\b(payment|remittance|\btt\b|\blc\b|outstanding|payment remitted)\b/i;
export const COMMISSION_RE =
  /\b(commission\s+invoice|agency\s+commission|qtr\s+commission)\b/i;
const RE_PREFIX = /^(re|fw|fwd|aw|sv):\s*/i;

const TRAVEL_ADMIN_RE =
  /\b(agoda|air\s*india|indigo|eticket|e-ticket|hotel|flight booking|booth assignment|mapyourshow|interzoo|plant renewal|bond renewal|buchung|customer receipt from booking id|make\s*my\s*trip|gst pending|stand\b.*expo|expo\s+202[0-9].*booth|msme|tds\b|reimbursement of tds|ledger statement|account ledger|registration status|section\s*232|tariff\b.*steel|credit card statement|electricity bill|estatement|appa\b|membership dues|membership invoice|association dues|reversal of credit note|global ledger|soa global praise)\b/i;

const BKG_BLACKLIST = new Set([
  "CONFIRMATION",
  "CUMENT",
  "CUMENTS",
  "ETICKET",
  "LLARAMA",
  "NUMBER",
  "DETAILS",
  "STATUS",
]);

export type PartyRole =
  | "internal"
  | "trader"
  | "buyer"
  | "factory"
  | "forwarder"
  | "noise"
  | "other";

export type ClassifyContext = {
  /** Connected mailbox addresses — always internal (and their company domains). */
  ownEmails?: string[];
};

function hit(email: string, needles: string[]) {
  return needles.some((n) => email.includes(n));
}

function domainOf(email: string) {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

export function partyRole(email: string | null | undefined, ctx: ClassifyContext = {}): PartyRole {
  const em = (email || "").toLowerCase().trim();
  if (!em) return "other";
  const internal = [...INTERNAL_DOMAINS, ...extraDomains("MAIL_EXTRA_INTERNAL_DOMAINS")];
  for (const raw of ctx.ownEmails || []) {
    const own = raw.toLowerCase();
    if (em === own) return "internal";
    const ownDomain = domainOf(own);
    if (ownDomain && !PUBLIC_MAIL_DOMAINS.has(ownDomain)) internal.push(`@${ownDomain}`);
  }
  if (hit(em, internal)) return "internal";
  if (TRADER_MARKERS.some((m) => m.includes("@") && em.includes(m)) || em.includes("globalpraise"))
    return "trader";
  if (hit(em, [...BUYER_DOMAINS, ...extraDomains("MAIL_EXTRA_BUYER_DOMAINS")])) return "buyer";
  if (hit(em, [...FACTORY_DOMAINS, ...extraDomains("MAIL_EXTRA_FACTORY_DOMAINS")])) return "factory";
  if (hit(em, [...FORWARDER_DOMAINS, ...extraDomains("MAIL_EXTRA_FORWARDER_DOMAINS")]))
    return "forwarder";
  if (hit(em, NOISE_DOMAINS)) return "noise";
  return "other";
}

export function isNoiseMessage(
  msg: { from_email?: string | null; subject?: string | null },
  ctx: ClassifyContext = {},
): boolean {
  if (partyRole(msg.from_email, ctx) === "noise") return true;
  const subj = msg.subject || "";
  if (TRAVEL_ADMIN_RE.test(subj)) return true;
  const low = subj.toLowerCase();
  return (
    low.includes("credit card") ||
    low.includes("estatement") ||
    low.includes("electricity bill")
  );
}

export function normTopic(subject: string | null | undefined): string {
  let text = (subject || "").trim();
  // Strip stacked prefixes ("RE: FW: …") — Python strips one; topics here
  // come from raw Subject (no Outlook conversation_topic), so strip all.
  while (RE_PREFIX.test(text)) text = text.replace(RE_PREFIX, "").trim();
  return text.toLowerCase().replace(/\s+/g, " ").slice(0, 180);
}

export function poKey(text: string | null | undefined): string | null {
  const m = PO_RE.exec(text || "");
  if (!m) return null;
  return m[1]!.replace(/\s+/g, "").toUpperCase().replace(/^[-/]+|[-/]+$/g, "");
}

export function bookingKey(text: string | null | undefined): string | null {
  const m = BOOKING_ID_RE.exec(text || "");
  if (!m) return null;
  const key = m[1]!.toUpperCase();
  if (BKG_BLACKLIST.has(key) || key.length < 6) return null;
  if (/^[A-Z]+$/.test(key) && key.length < 8) return null;
  return key;
}

/** Deal key for a message that does not reply into a known thread. */
export function dealKeyFor(subject: string | null | undefined, fallbackId: string): string {
  const po = poKey(subject);
  if (po) return `po:${po}`;
  const bkg = bookingKey(subject);
  if (bkg) return `bkg:${bkg}`;
  const topic = normTopic(subject);
  if (topic) return `topic:${topic}`;
  return `id:${fallbackId}`;
}

export function stageOf(subject: string, body: string): string {
  const text = `${subject} ${body.slice(0, 1500)}`;
  if (COMMISSION_RE.test(text)) return "commission";
  const freight = FREIGHT_RE.test(text);
  if (freight) return "booking";
  if (SAMPLE_RE.test(text)) return "samples";
  if (ARTWORK_RE.test(text)) return "artwork";
  if (QC_RE.test(text)) return "inspection";
  if (PI_RE.test(text) || poKey(subject)) return "pi_po";
  if (QUOTE_RE.test(text)) return "quoting";
  if (RFQ_RE.test(text)) return "requirement";
  if (PAY_RE.test(text)) return "payment";
  return "other";
}

const PRIMARY_ORDER = [
  "commission",
  "payment",
  "booking",
  "inspection",
  "samples",
  "artwork",
  "pi_po",
  "quoting",
  "requirement",
];

export function primaryStage(stages: Iterable<string>): string {
  const set = new Set(stages);
  return PRIMARY_ORDER.find((s) => set.has(s)) || "other";
}

export function commercialModelOf(
  blob: string,
  parties: Record<string, string[]>,
  addresses: string[],
): "trader_principal" | "agency_commission" {
  const low = blob.toLowerCase();
  if (TRADER_MARKERS.some((m) => low.includes(m))) return "trader_principal";
  if ((parties.trader || []).length) return "trader_principal";
  if (addresses.some((a) => (a || "").toLowerCase().includes("globalpraise")))
    return "trader_principal";
  return "agency_commission";
}

export function isTravelAdmin(text: string) {
  return TRAVEL_ADMIN_RE.test(text);
}

export function isFreight(text: string) {
  return FREIGHT_RE.test(text);
}

const TRADE_STAGES = new Set([
  "requirement",
  "quoting",
  "pi_po",
  "booking",
  "samples",
  "artwork",
  "inspection",
  "payment",
  "commission",
]);

export type RelevanceInput = {
  dealKey: string;
  subject: string;
  bodies: string;
  stage: string;
  roles: Record<string, number>;
  messageCount: number;
  docCount: number;
  poNumbers: string[];
  documentNames: string[];
};

/**
 * agent_worthy (cluster_threads) AND is_relevant (build_relevant_deals),
 * evaluated on the merged deal rather than per thread.
 */
export function isRelevantDeal(d: RelevanceInput, mode: "trade" | "all"): {
  relevant: boolean;
  reason: string;
} {
  const roles = d.roles;
  if ((roles.noise || 0) >= d.messageCount)
    return { relevant: false, reason: "all_noise" };
  const hasPo = d.poNumbers.length > 0 || d.dealKey.startsWith("po:");
  const blob = `${d.subject} ${d.documentNames.join(" ")}`;
  if (isTravelAdmin(blob) && !hasPo) return { relevant: false, reason: "travel_admin" };

  if (mode === "all") {
    // Hand anything with a trade signal to the worker; its isTradeDeal gate decides.
    if (d.stage !== "other" || hasPo || d.docCount > 0)
      return { relevant: true, reason: "filter_all" };
    return { relevant: false, reason: "no_trade_signal" };
  }

  const hasBuyer = (roles.buyer || 0) > 0;
  const hasFactory = (roles.factory || 0) > 0;
  const hasTrader = (roles.trader || 0) > 0;
  const hasForwarder = (roles.forwarder || 0) > 0;
  const hasTradeParty = hasBuyer || hasFactory || hasTrader;
  const hasDocs = d.docCount > 0;
  const freight = d.stage === "booking" || isFreight(`${d.subject} ${d.bodies}`);
  const commission = d.stage === "commission" || COMMISSION_RE.test(d.subject);

  const agentWorthy =
    (TRADE_STAGES.has(d.stage) &&
      (hasTradeParty ||
        hasPo ||
        (hasForwarder && freight) ||
        (hasDocs && (hasPo || freight)))) ||
    (hasPo && (hasTradeParty || hasForwarder || hasDocs));
  if (!agentWorthy) return { relevant: false, reason: "no_trade_party" };

  const n = d.messageCount;
  if (hasPo && (hasTradeParty || hasForwarder || hasDocs || n >= 2))
    return { relevant: true, reason: "po" };
  if (commission && (hasTradeParty || d.subject.toLowerCase().includes("snspl")))
    return { relevant: true, reason: "commission" };
  if (freight && (hasForwarder || hasTrader || hasDocs))
    return { relevant: true, reason: "freight" };
  if (TRADE_STAGES.has(d.stage) && n >= 2 && hasTradeParty)
    return { relevant: true, reason: "trade_thread" };
  if (
    TRADE_STAGES.has(d.stage) &&
    hasTradeParty &&
    hasDocs &&
    ["pi_po", "quoting", "requirement", "artwork", "samples", "inspection"].includes(d.stage)
  )
    return { relevant: true, reason: "trade_doc" };
  if (freight && hasForwarder && n >= 2) return { relevant: true, reason: "forwarder_chain" };
  return { relevant: false, reason: "weak_signal" };
}

/* ------------------------------------------------------------------ */
/* Worker slot + document choice (process_deals.py)                    */
/* ------------------------------------------------------------------ */

const STAGE_SLOT: Record<string, string> = {
  requirement: "requirement_extractor",
  quoting: "quote_normalizer",
  artwork: "artwork_checklist_extractor",
  samples: "sample_request_summarizer",
  inspection: "inspection_photo_summarizer",
  booking: "booking_extractor",
  payment: "payment_clock",
  commission: "commission_checklist",
  other: "requirement_extractor",
};

export const DOC_REQUIRED = new Set([
  "quote_normalizer",
  "pi_extractor",
  "po_extractor",
  "booking_extractor",
  "inspection_photo_summarizer",
]);

export const DOC_OPTIONAL = new Set([
  "artwork_checklist_extractor",
  "sample_request_summarizer",
  "final_docs_pack_check",
]);

export const MODERN_DOC_EXT = new Set([
  ".pdf",
  ".xlsx",
  ".docx",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);
const LEGACY_DOC_EXT = new Set([".doc", ".xls", ".ppt", ".rtf", ".csv"]);

const FREIGHT_DOC_TOKENS = [
  "hbl", "mbl", "bkgconf", "bkg_", "bkg-", "bkg ", "bill of lading", "telex release",
  "telex", "air waybill", "eawb", " awb", "awb.", "bl.pdf", "draft bl", "draft hbl",
  "shipping bill", "si form", "vgm", "booking confirmation", "booking conf",
];

const FREIGHT_DOC_PENALTY = [
  "packing list", "pack list", "commercial invoice", "proforma", "purchase order",
  "artwork", "inspection", "coa ", "certificate of analysis",
];

const KIND_PREF: Record<string, string[]> = {
  quoting: [".xlsx", ".pdf", ".docx"],
  pi_po: [".pdf", ".xlsx", ".docx"],
  booking: [".pdf", ".xlsx"],
  requirement: [".pdf", ".xlsx", ".docx"],
  artwork: [".pdf", ".docx", ".pptx"],
  samples: [".pdf", ".xlsx", ".png", ".jpg"],
  inspection: [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".pptx"],
  payment: [".pdf", ".xlsx"],
  other: [".pdf", ".xlsx", ".docx"],
};

const DOC_NAME_BONUS: Record<string, string[]> = {
  booking: ["hbl", "mbl", "bkgconf", "booking confirmation", "booking conf", "bill of lading", "telex", "awb", "bl.pdf", "draft bl", "shipping bill", "vgm"],
  quoting: ["quote", "quotation", "price", "as sheet", "costing", "offer"],
  pi_po: ["proforma", "performa", "purchase order", "pi-", "pi ", "po#", " po "],
  requirement: ["rfq", "enquiry", "spec", "reorder", "quote sheet"],
  artwork: ["art", "logo", "print", "dieline", "packaging"],
  samples: ["sample", "proto"],
  inspection: ["inspect", "qc", "packing list", "photo"],
  payment: ["bl", "bill of lading", "tt", "payment", "debit"],
};

const DOC_NAME_PENALTY: Record<string, string[]> = {
  booking: ["debit note", "gst", "payment summary", "invoice", "packing list", "artwork", "coa", "purchase order"],
  quoting: ["e-way", "eway", "packing list", "delivery note", "coa", "certificate of analysis"],
  pi_po: ["packing list", "shipping marks", "sticker", "logo"],
  requirement: ["eawb", "air waybill", "company profile"],
};

export type DocCandidate = { name: string; ext: string };

function hasModernDocument<T extends DocCandidate>(docs: T[], hints: string[] = []) {
  return docs.some((d) => {
    if (!MODERN_DOC_EXT.has(d.ext)) return false;
    if (!hints.length) return true;
    const name = d.name.toLowerCase();
    return hints.some((h) => name.includes(h));
  });
}

function hasFreightDocument<T extends DocCandidate>(docs: T[]) {
  const nonImage = new Set([...MODERN_DOC_EXT].filter((e) => ![".png", ".jpg", ".jpeg", ".webp"].includes(e)));
  return docs.some((d) => {
    if (!nonImage.has(d.ext)) return false;
    const name = d.name.toLowerCase();
    if (
      FREIGHT_DOC_PENALTY.some((p) => name.includes(p)) &&
      !["hbl", "mbl", "bkgconf", "bill of lading", "draft bl"].some((t) => name.includes(t))
    )
      return false;
    return FREIGHT_DOC_TOKENS.some((t) => name.includes(t));
  });
}

export function chooseSlot<T extends DocCandidate>(
  stage: string,
  subjects: string[],
  docs: T[],
): string {
  const blob = subjects.join(" ").toLowerCase();
  if (blob.includes("commission") || stage === "commission") return "commission_checklist";
  if (stage === "pi_po") {
    const wantsPo = blob.includes("purchase order") || blob.includes("po#") || blob.includes("po #");
    if (wantsPo && hasModernDocument(docs, ["po", "purchase", "order"])) return "po_extractor";
    if (hasModernDocument(docs, ["proforma", "performa", "pi-", "pi ", "pi_"])) return "pi_extractor";
    if (wantsPo && hasModernDocument(docs)) return "po_extractor";
    if (hasModernDocument(docs)) return "pi_extractor";
    return "final_docs_pack_check";
  }
  if (stage === "booking") {
    if (hasFreightDocument(docs)) return "booking_extractor";
    if (hasModernDocument(docs, ["po", "purchase"])) return "po_extractor";
    if (hasModernDocument(docs, ["proforma", "performa", "pi-", "pi "])) return "pi_extractor";
    if (["payment", "remit", "tt against", "outstanding", "dues"].some((t) => blob.includes(t)))
      return "payment_clock";
    return "final_docs_pack_check";
  }
  if (stage === "inspection") {
    return hasModernDocument(docs) ? "inspection_photo_summarizer" : "final_docs_pack_check";
  }
  if (stage === "quoting") {
    if (hasModernDocument(docs, ["quote", "quotation", "price", "costing", "as sheet", "offer", "revised"]))
      return "quote_normalizer";
    return "requirement_extractor";
  }
  return STAGE_SLOT[stage] || "requirement_extractor";
}

export function pickDocument<T extends DocCandidate>(
  stage: string,
  slot: string | null,
  docs: T[],
): T | null {
  let preferred = KIND_PREF[stage] || [".pdf", ".xlsx"];
  let bonus = DOC_NAME_BONUS[stage] || [];
  let penalty = DOC_NAME_PENALTY[stage] || [];
  if (slot === "final_docs_pack_check") {
    preferred = [".pdf", ".xlsx", ".docx"];
    bonus = ["packing list", "pack list", "commercial invoice", "invoice", "hbl", "mbl", "bill of lading", "shipping bill", "certificate of origin", "coo", "telex"];
    penalty = ["artwork", "logo", "upc", "coa", "sample"];
  } else if (slot === "booking_extractor") {
    bonus = DOC_NAME_BONUS.booking!;
    penalty = DOC_NAME_PENALTY.booking!;
  } else if (slot === "pi_extractor" || slot === "po_extractor") {
    preferred = [".pdf", ".xlsx", ".docx"];
    bonus = DOC_NAME_BONUS.pi_po!;
    penalty = DOC_NAME_PENALTY.pi_po!;
  }
  const ranked: { score: number; doc: T }[] = [];
  for (const doc of docs) {
    const name = doc.name.toLowerCase();
    const ext = doc.ext;
    if (LEGACY_DOC_EXT.has(ext) || !MODERN_DOC_EXT.has(ext)) continue;
    let score = preferred.includes(ext) ? preferred.indexOf(ext) : 10;
    if (bonus.some((t) => name.includes(t))) score -= 20;
    if (penalty.some((t) => name.includes(t))) score += 30;
    if (slot === "booking_extractor" || (slot == null && stage === "booking")) {
      if (FREIGHT_DOC_TOKENS.some((t) => name.includes(t))) score -= 40;
      if (FREIGHT_DOC_PENALTY.some((t) => name.includes(t))) score += 50;
      else if (["po", "purchase", "artwork", "logo", "upc"].some((t) => name.includes(t))) score += 50;
    }
    ranked.push({ score, doc });
  }
  ranked.sort((a, b) => a.score - b.score);
  return ranked[0]?.doc ?? null;
}

/** Matches cluster_threads.useful_attachments: real files only, no inline/images. */
export function isUsefulAttachment(att: {
  name: string;
  ext: string;
  inline?: boolean;
  skipped?: string;
  s3_key?: string;
}) {
  if (att.inline || att.skipped || !att.s3_key) return false;
  return ![".png", ".jpg", ".jpeg", ".gif", ".tiff", ".bmp"].includes(att.ext);
}

/** Agent ids per slot — same env names as scripts/pst-extract/process_deals.py. */
const SLOT_ENV: Record<string, [string, string]> = {
  requirement_extractor: ["NEXT_PUBLIC_AGENT_REQUIREMENT_EXTRACTOR", "AA00000025"],
  quote_normalizer: ["NEXT_PUBLIC_AGENT_QUOTE_NORMALIZER", "AA00000026"],
  artwork_checklist_extractor: ["NEXT_PUBLIC_AGENT_ARTWORK_CHECKLIST", "AA00000027"],
  sample_request_summarizer: ["NEXT_PUBLIC_AGENT_SAMPLE_REQUEST", "AA00000028"],
  pi_extractor: ["NEXT_PUBLIC_AGENT_PI_EXTRACTOR", "AA00000029"],
  po_extractor: ["NEXT_PUBLIC_AGENT_PO_EXTRACTOR", "AA00000030"],
  inspection_photo_summarizer: ["NEXT_PUBLIC_AGENT_INSPECTION", "AA00000034"],
  booking_extractor: ["NEXT_PUBLIC_AGENT_BOOKING", "AA00000036"],
  final_docs_pack_check: ["NEXT_PUBLIC_AGENT_DOCS_PACK", "AA00000038"],
  payment_clock: ["NEXT_PUBLIC_AGENT_PAYMENT_CLOCK", "AA00000039"],
  commission_checklist: ["NEXT_PUBLIC_AGENT_COMMISSION", "AA00000040"],
};

export function agentIdForSlot(slot: string): string {
  const entry = SLOT_ENV[slot];
  if (!entry) return "";
  return process.env[entry[0]]?.trim() || entry[1];
}
