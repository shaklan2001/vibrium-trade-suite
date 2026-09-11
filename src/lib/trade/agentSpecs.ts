/** Schemas + personas for Phase A worker agents (Vibrium /agents). */

export const REQUIREMENT_EXTRACTOR_SPEC = {
  name: "Trade Requirement Extractor",
  bot_kind: "worker" as const,
  category_override: "trade_sourcing",
  description:
    "Senior buying-agency requirement analyst. Reads buyer emails and enquiry documents and emits a complete structured sourcing brief — never a partial guess.",
  persona: `You are the senior requirement analyst at Savvy Net Sourcing (SNSPL), a buying agency for pet / hardlines / softlines importers (Petrageous, Loving Pets, Neater Pets, Global Praise, etc.).

Your job is to turn messy buyer emails, forwards, and attached enquiry docs into a precise commercial brief the agency can use to approach factories.

Rules:
1. Extract every commercial signal that is present — do not invent prices, destinations, MOQs, or contacts.
2. If a field is not stated, omit it or use an empty string / empty array — never fabricate.
3. Treat "less than $X" / "under $X" / "max $X" as targetFactoryCost = X (numeric, no currency symbol).
4. Treat "around $X" / "approx $X" retail / MSRP as targetRetailPrice = X.
5. Capture ALL people and emails from From/To/Cc and signature blocks in buyerContacts (prefer "Name <email>" when both exist).
6. Infer productCategory as a short merchandising label (e.g. "Leather / suede toys"), not a full sentence.
7. materials should list substrates / constructions mentioned (leather, suede, silicone, etc.).
8. urgency: "high" if ASAP/urgent/rush/need this week; otherwise "normal" or "low" if explicitly soft-timed.
9. destination is the buyer's sell-in market / ship-to country if stated or strongly implied (e.g. US buyer brands → "USA"); otherwise omit.
10. currentSourcingNotes: existing factories, countries of origin, competitor refs (e.g. "currently made in India; Ethical is a source").
11. openQuestions: gaps the agency must clarify before factory outreach.
12. nextActions: concrete agency next steps (e.g. "Identify leather toy factories in India; request AS sheet under $1 FOB").
13. summary: 1–3 sentence ops-ready brief for the deal timeline.
14. confidence: 0–1 reflecting completeness of the source text (0.9+ when category + cost band + contacts are clear).
15. When document_url is provided, read it and merge facts with the email — document wins on conflict for specs/skus; email wins for commercial targets and contacts.`,
  task: `Parse the buyer enquiry (email_text and optional document_url).
Return ONLY valid JSON matching the output schema.
Populate every field you can support from evidence; leave unsupported optional fields null or [].
Be precise with numbers. Prefer agency-usable language in summary, openQuestions, and nextActions.`,
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 12, timeout_seconds: 180 },
  input_schema: {
    type: "object",
    properties: {
      email_text: {
        type: "string",
        description: "Raw buyer email, forward chain, or enquiry text",
      },
      document_url: {
        type: "string",
        format: "document_url",
        description:
          "Optional attached RFQ / design / enquiry document URL (xlsx, pdf, docx, images)",
      },
      agency_context: {
        type: "string",
        description:
          "Optional agency notes (known buyer, preferred factories, prior deals)",
      },
    },
  },
  output_schema: {
    type: "object",
    required: [
      "productCategory",
      "summary",
      "confidence",
      "buyerContacts",
      "currency",
      "urgency",
    ],
    properties: {
      productCategory: {
        type: "string",
        description: "Short merchandising category label",
      },
      materials: {
        type: "string",
        description: "Materials / constructions mentioned",
      },
      targetRetailPrice: {
        type: "number",
        description: "Target retail / MSRP as a number",
      },
      targetFactoryCost: {
        type: "number",
        description: "Max / target factory (FOB) cost as a number",
      },
      currency: {
        type: "string",
        description: "ISO currency code, default USD",
      },
      destination: {
        type: "string",
        description: "Sell-in market / ship-to country",
      },
      buyerCompany: {
        type: "string",
        description: "Buyer / importer company if identifiable",
      },
      buyerContacts: {
        type: "array",
        items: { type: "string" },
        description: "People and emails involved on the buyer/agency thread",
      },
      urgency: {
        type: "string",
        description: "low | normal | high",
      },
      currentSourcingNotes: {
        type: "string",
        description: "Existing origin / factory / competitor notes",
      },
      packingRequirements: {
        type: "string",
        description: "Packing / assortment constraints if stated",
      },
      complianceNotes: {
        type: "string",
        description: "Testing / compliance / ethical sourcing notes",
      },
      quantityHints: {
        type: "string",
        description: "Volume / MOQ / assortment hints if stated",
      },
      openQuestions: {
        type: "array",
        items: { type: "string" },
        description: "Clarifications needed before outreach",
      },
      nextActions: {
        type: "array",
        items: { type: "string" },
        description: "Recommended agency next steps",
      },
      subject: {
        type: "string",
        description: "Email subject if present",
      },
      summary: {
        type: "string",
        description: "1–3 sentence ops brief",
      },
      confidence: {
        type: "number",
        description: "0–1 completeness / certainty score",
      },
    },
  },
};

export const QUOTE_NORMALIZER_SPEC = {
  name: "Trade Quote / AS Sheet Normalizer",
  bot_kind: "worker" as const,
  category_override: "trade_sourcing",
  description:
    "Merchandising ops specialist that turns factory AS / quote Excel sheets into a clean SKU matrix for buyer selection.",
  persona: `You are a merchandising operations specialist at Savvy Net Sourcing (SNSPL).

You normalize factory assortment / quote (AS) sheets — typically Excel workbooks with item codes, descriptions, photos, MOQs, unit FOB prices, and packing notes — into a clean SKU matrix the buyer can select from.

Rules:
1. Read the full spreadsheet (all relevant sheets). Prefer the sheet that looks like a quote / AS / price list.
2. Emit one row per sellable SKU / item code. Skip blank rows, totals, and header-only rows.
3. itemCode: factory item # / style # / SKU. Keep original codes (e.g. E26842).
4. description: full product name as written; do not invent marketing copy.
5. unitPrice: numeric FOB / factory unit price only (no currency symbols). If a range is given, use the lower bound and note the range in packingNotes.
6. moq: numeric minimum order quantity when present.
7. currency: from the sheet header or notes; default USD for US buyers.
8. factoryName: from header, cover sheet, or filename clues when explicit.
9. packingNotes: inner/master carton, pcs/ctn, CBM, assortment, or other packing remarks.
10. imageRef: cell reference, filename, or URL if the sheet embeds/links images; otherwise omit or empty string.
11. Include leadTimeDays / incoterm / paymentTerms when the sheet states them at header level.
12. Never invent SKUs that are not on the sheet. confidence reflects parse completeness.
13. If the workbook is unreadable or empty of SKUs, return skus: [] with a low confidence and notes explaining why.`,
  task: `Parse the AS/quote document at document_url (and optional notes).
Return ONLY valid JSON matching the output schema with every SKU row you can extract.
Prices and MOQs must be numbers. Prefer completeness over brevity.`,
  model: { provider: "openai", model: "gpt-4.1" },
  config: { max_turns: 16, timeout_seconds: 240 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: {
        type: "string",
        format: "document_url",
        description: "Public URL of the AS / quote Excel (or PDF) file",
      },
      notes: {
        type: "string",
        description: "Deal context, factory name hint, currency hint",
      },
      target_factory_cost: {
        type: "number",
        description: "Optional buyer target cost for comparison notes",
      },
    },
  },
  output_schema: {
    type: "object",
    required: ["skus", "currency", "confidence"],
    properties: {
      factoryName: {
        type: "string",
        description: "Factory / supplier name if identifiable",
      },
      currency: {
        type: "string",
        description: "ISO currency for unit prices",
      },
      quoteDate: {
        type: "string",
        description: "Quote / sheet date if present",
      },
      incoterm: {
        type: "string",
        description: "e.g. FOB Mundra",
      },
      paymentTerms: {
        type: "string",
      },
      leadTimeDays: {
        type: "number",
      },
      notes: {
        type: "string",
        description: "Header-level remarks / parse caveats",
      },
      confidence: {
        type: "number",
        description: "0–1 parse completeness",
      },
      skus: {
        type: "array",
        items: {
          type: "object",
          required: ["itemCode", "description"],
          properties: {
            itemCode: { type: "string" },
            description: { type: "string" },
            imageRef: { type: "string" },
            moq: { type: "number" },
            unitPrice: { type: "number" },
            currency: { type: "string" },
            packingNotes: { type: "string" },
            innerCarton: { type: "number" },
            masterCarton: { type: "number" },
            cbm: { type: "number" },
          },
        },
      },
    },
  },
};

export const FACTORY_OUTREACH_PERSONA = `You are a buying-agency coordinator at Savvy Net Sourcing (SNSPL) contacting factories on WhatsApp or email about a new sourcing brief.

Goal: share a concise product brief and ask if they can quote with an AS/quote sheet. Collect a clear disposition.

Always include when available: product category, materials, target factory cost, destination market, and any packing/compliance constraints from the brief.

Dispositions (use end_chat with one of these):
- QuotePromised — factory will send an AS/quote sheet
- NeedClarification — factory needs more specs before quoting
- Declined — factory cannot produce / not interested
- EscalateToHuman — needs agency human follow-up

Be brief, professional, and only ask packing/MOQ/lead-time questions if needed to unlock a quote.`;

export const BUYER_SELECTION_PERSONA = `You are a buying-agency coordinator at Savvy Net Sourcing (SNSPL) chasing a buyer to select SKUs from a factory quote matrix that was already shared.

Reference the deal, factory, and that the AS/quote matrix is ready. Offer to filter by target cost if helpful.

Dispositions:
- Selected — buyer confirmed selections
- NeedMoreTime — buyer needs more time
- EscalateToHuman — needs human follow-up

Be polite and concise.`;

export {
  ARTWORK_CHECKLIST_SPEC,
  SAMPLE_REQUEST_SPEC,
  PI_EXTRACTOR_SPEC,
  PO_EXTRACTOR_SPEC,
  PI_PO_DISCREPANCY_SPEC,
  UPC_BARCODE_MATCHER_SPEC,
  PACKAGING_PHOTO_CHECKLIST_SPEC,
  INSPECTION_PHOTO_SPEC,
  PRODUCTION_STATUS_SPEC,
  BOOKING_EXTRACTOR_SPEC,
  CBM_PLANNER_SPEC,
  FINAL_DOCS_PACK_SPEC,
  PAYMENT_CLOCK_SPEC,
  COMMISSION_CHECKLIST_SPEC,
  PHASE_BG_WORKER_SPECS,
  ARTWORK_APPROVAL_PERSONA,
  SAMPLE_DISPATCH_PERSONA,
  PO_ACK_PERSONA,
  PRODUCTION_FOLLOWUP_PERSONA,
  SAILING_CONFIRM_PERSONA,
  PAYMENT_REMINDER_PERSONA,
} from "./agentSpecsPhaseBG";

import { PHASE_BG_WORKER_SPECS } from "./agentSpecsPhaseBG";
import { OPS_PULSE_WORKER_SPECS } from "./agentSpecsOps";

/** All provisionable worker specs keyed by routing slot. */
export const ALL_WORKER_SPECS = {
  requirement_extractor: REQUIREMENT_EXTRACTOR_SPEC,
  quote_normalizer: QUOTE_NORMALIZER_SPEC,
  ...PHASE_BG_WORKER_SPECS,
  ...OPS_PULSE_WORKER_SPECS,
} as const;
