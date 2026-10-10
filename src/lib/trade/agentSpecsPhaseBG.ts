/** Phase B–G worker agent specs — grounded on docs/samples/Sourcing artefacts. */

type WorkerSpec = {
  name: string;
  bot_kind: "worker";
  category_override: string;
  description: string;
  persona: string;
  task: string;
  model: { provider: string; model: string };
  config: { max_turns: number; timeout_seconds: number };
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
};

const base = (
  partial: Omit<WorkerSpec, "bot_kind" | "category_override" | "model"> & {
    model?: WorkerSpec["model"];
  },
): WorkerSpec => ({
  bot_kind: "worker",
  category_override: "trade_sourcing",
  model: partial.model || { provider: "openai", model: "gpt-4.1" },
  ...partial,
});

export const ARTWORK_CHECKLIST_SPEC = base({
  name: "Trade Artwork Checklist Extractor",
  description:
    "Extracts required artwork / packaging assets and approval status from buyer or factory emails and design PDFs.",
  persona: `You are a buying-agency artwork coordinator at Savvy Net Sourcing (SNSPL).

You review packaging inserts, product artwork PDFs (e.g. Neater Mat / Neat-Lik Express India packs), and approval email threads.

Rules:
1. List discrete artwork assets (front panel, back panel, insert, barcode placement, carton print, hangtag, etc.).
2. Status: missing | pending | approved | changes_requested — only from evidence.
3. Never invent assets not implied by the brief or document.
4. summary: ops-ready note for the deal timeline.
5. confidence 0–1.`,
  task: `From email_text and/or document_url, return an artwork checklist matching the output schema.`,
  config: { max_turns: 12, timeout_seconds: 180 },
  input_schema: {
    type: "object",
    properties: {
      email_text: { type: "string" },
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["items", "summary", "confidence"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["asset", "status"],
          properties: {
            asset: { type: "string" },
            status: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const SAMPLE_REQUEST_SPEC = base({
  name: "Trade Sample Request Summarizer",
  description:
    "Summarizes sample dispatch / courier / photo confirmation from agency–factory threads.",
  persona: `You are an SNSPL sample coordinator.

Extract courier, tracking, dispatch/arrival dates, SKUs sampled, and photo references from emails or photo packs.

Prefer omit/empty over guessing. confidence 0–1.`,
  task: `Parse sample request / dispatch content and return structured summary.`,
  config: { max_turns: 10, timeout_seconds: 150 },
  input_schema: {
    type: "object",
    properties: {
      email_text: { type: "string" },
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["summary", "confidence"],
    properties: {
      courier: { type: "string" },
      trackingNumber: { type: "string" },
      dispatchDate: { type: "string" },
      expectedArrival: { type: "string" },
      photoRefs: { type: "array", items: { type: "string" } },
      items: { type: "array", items: { type: "string" } },
      status: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const PI_EXTRACTOR_SPEC = base({
  name: "Trade PI Extractor",
  description:
    "Parses factory Proforma Invoices (PI) into commercial header + line items.",
  persona: `You are an SNSPL commercial analyst reading factory Proforma Invoices (e.g. Swastik → Loving Pets PO 14682; Y.K. Industries Petrageous PIs).

Extract: docNumber, shipper/factory, consignee/buyer, Incoterm, payment terms, POL/POD, currency, totals, ready date, and line items (itemCode, description, qty, unitPrice, amount, cbm, packing).

CRITICAL SCHEMA RULES:
- Numbers must be numeric when present.
- If a number is unknown, OMIT the key entirely — never output null for totalAmount, totalCbm, qty, unitPrice, amount, cbm, or any other number.
- Use empty string only for optional strings you cannot fill; prefer omitting unknown optional strings.
- lines may be [] if the PI has no line items readable.
- confidence 0–1.`,
  task: `Parse the PI at document_url (and optional notes) into the commercial document schema. Set docType to "pi". Never emit null for numeric fields.`,
  config: { max_turns: 14, timeout_seconds: 240 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["docType", "lines", "summary", "confidence"],
    properties: {
      docType: { type: "string" },
      docNumber: { type: "string" },
      shipper: { type: "string" },
      consignee: { type: "string" },
      buyer: { type: "string" },
      factory: { type: "string" },
      incoterm: { type: "string" },
      paymentTerms: { type: "string" },
      pol: { type: "string" },
      pod: { type: "string" },
      currency: { type: "string" },
      totalAmount: { type: "number" },
      totalCbm: { type: "number" },
      readyDate: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            itemCode: { type: "string" },
            description: { type: "string" },
            qty: { type: "number" },
            unitPrice: { type: "number" },
            amount: { type: "number" },
            cbm: { type: "number" },
            packing: { type: "string" },
          },
        },
      },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const PO_EXTRACTOR_SPEC = base({
  name: "Trade PO Extractor",
  description:
    "Parses buyer Purchase Orders into commercial header + line items.",
  persona: `You are an SNSPL commercial analyst reading buyer POs (e.g. PO# 14682 Swastik; Neater Pets PO patterns).

Same field discipline as PI extraction. Set docType to "po".
CRITICAL: Numbers numeric when present; OMIT any unknown number key — never null for totalAmount/totalCbm/qty/unitPrice/amount/cbm.`,
  task: `Parse the PO at document_url into the commercial document schema. Set docType to "po". Never emit null for numeric fields.`,
  config: { max_turns: 14, timeout_seconds: 240 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["docType", "lines", "summary", "confidence"],
    properties: {
      docType: { type: "string" },
      docNumber: { type: "string" },
      shipper: { type: "string" },
      consignee: { type: "string" },
      buyer: { type: "string" },
      factory: { type: "string" },
      incoterm: { type: "string" },
      paymentTerms: { type: "string" },
      pol: { type: "string" },
      pod: { type: "string" },
      currency: { type: "string" },
      totalAmount: { type: "number" },
      totalCbm: { type: "number" },
      readyDate: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            itemCode: { type: "string" },
            description: { type: "string" },
            qty: { type: "number" },
            unitPrice: { type: "number" },
            amount: { type: "number" },
            cbm: { type: "number" },
            packing: { type: "string" },
          },
        },
      },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const PI_PO_DISCREPANCY_SPEC = base({
  name: "Trade PI vs PO Discrepancy",
  description:
    "Compares structured PI and PO payloads and lists commercial mismatches.",
  persona: `You are an SNSPL commercial controller.

Given pi_json and po_json, find mismatches on qty, price, CBM, Incoterm, ports, SKU codes, payment terms, totals.

severity: info | warning | critical.
aligned=true only if no warning/critical issues.
Do not invent values — compare provided JSON only.`,
  task: `Diff pi_json vs po_json and return mismatches + summary.`,
  config: { max_turns: 10, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    required: ["pi_json", "po_json"],
    properties: {
      pi_json: { type: "string" },
      po_json: { type: "string" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["mismatches", "aligned", "summary", "confidence"],
    properties: {
      mismatches: {
        type: "array",
        items: {
          type: "object",
          required: ["field", "severity"],
          properties: {
            field: { type: "string" },
            piValue: { type: "string" },
            poValue: { type: "string" },
            severity: { type: "string" },
            note: { type: "string" },
          },
        },
      },
      aligned: { type: "boolean" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const UPC_BARCODE_MATCHER_SPEC = base({
  name: "Trade UPC / Barcode Matcher",
  description:
    "Matches barcode artwork / labels against UPC master sheets and PO items.",
  persona: `You are an SNSPL packaging compliance specialist (Neater Mats / Neat-Lik Express UPC masters).

Given UPC master document and optional barcode art / notes, emit per-SKU matchStatus: matched | missing_barcode | missing_upc | mismatch.`,
  task: `Match UPCs to barcodes and return rows + summary.`,
  config: { max_turns: 14, timeout_seconds: 240 },
  input_schema: {
    type: "object",
    properties: {
      upc_document_url: { type: "string", format: "document_url" },
      barcode_document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
      email_text: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["rows", "summary", "confidence"],
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          required: ["matchStatus"],
          properties: {
            itemCode: { type: "string" },
            description: { type: "string" },
            upc: { type: "string" },
            barcodePresent: { type: "boolean" },
            matchStatus: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const PACKAGING_PHOTO_CHECKLIST_SPEC = base({
  name: "Trade Packaging Photo Checklist",
  description:
    "Confirms required packaging photo views are present in a packaging PDF/pack.",
  persona: `You review packaging photo packs (e.g. PACKAGING PO-20958.pdf).

Required views typically: front, back, side, top, inner, master carton, barcode close-up.
Mark present true/false from evidence only.`,
  task: `Return packaging photo checklist for the document.`,
  config: { max_turns: 12, timeout_seconds: 200 },
  input_schema: {
    type: "object",
    properties: {
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
      po_number: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["items", "summary", "confidence"],
    properties: {
      poNumber: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["view", "present"],
          properties: {
            view: { type: "string" },
            present: { type: "boolean" },
            notes: { type: "string" },
          },
        },
      },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const INSPECTION_PHOTO_SPEC = base({
  name: "Trade Inspection Photo Summarizer",
  description:
    "Summarizes factory/inspection photo packs into item-level pass/fail notes.",
  persona: `You are an SNSPL QC analyst reading inspection picture PDFs (e.g. Inspection pictures Po-20719).

Emit findings with result pass | fail | conditional | unknown. overall is a short QC verdict.
Input is document_url (+ optional notes/po_number only) — never expect email_text.`,
  task: `Summarize inspection document into findings.`,
  config: { max_turns: 14, timeout_seconds: 240 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
      po_number: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["findings", "summary", "confidence"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["result"],
          properties: {
            itemCode: { type: "string" },
            result: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
      overall: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const PRODUCTION_STATUS_SPEC = base({
  name: "Trade Production Status Extractor",
  description:
    "Extracts production readiness signals from factory status emails.",
  persona: `You parse factory production update emails for SNSPL.

Extract readyDate, percentComplete (0–100 if stated), blockers[], and a concise summary.
CRITICAL: If percentComplete is not stated, OMIT the key — never null.`,
  task: `Parse production status email_text into structured status. Never emit null for numbers.`,
  config: { max_turns: 8, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    required: ["email_text"],
    properties: {
      email_text: { type: "string" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["summary", "confidence"],
    properties: {
      readyDate: { type: "string" },
      percentComplete: { type: "number" },
      blockers: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const BOOKING_EXTRACTOR_SPEC = base({
  name: "Trade Booking Extractor",
  description:
    "Extracts ocean booking confirmation fields from carrier/forwarder PDFs. Rejects travel/hotel bookings.",
  persona: `You read CMA CGM / forwarder ocean booking confirmations (e.g. BKGCONF, HBL, MBL).

commercial_model in notes:
- agency_commission: SNSPL is buying agency / referee
- trader_principal: Global Praise (or SNSPL trading) is shipper or consignee as principal

Extract bookingNumber, carrier, vessel, voyage, POL, POD, ETD, ETA, equipment, cut-offs, shipper, consignee when present.

CRITICAL GATE:
- If the PDF/notes are hotel, Agoda, airline e-ticket, expo booth, or personal travel, set isTradeDeal=false, rejectReason explaining why, confidence low, and leave freight fields empty.
- Only set isTradeDeal=true for real ocean/air freight trade bookings.`,
  task: `Parse booking document_url into booking details. Always return isTradeDeal and commercialModel.`,
  config: { max_turns: 12, timeout_seconds: 200 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["summary", "confidence", "isTradeDeal"],
    properties: {
      isTradeDeal: { type: "boolean" },
      rejectReason: { type: "string" },
      commercialModel: {
        type: "string",
        description: "agency_commission | trader_principal",
      },
      bookingNumber: { type: "string" },
      carrier: { type: "string" },
      vessel: { type: "string" },
      voyage: { type: "string" },
      pol: { type: "string" },
      pod: { type: "string" },
      etd: { type: "string" },
      eta: { type: "string" },
      equipment: { type: "string" },
      cutOffs: { type: "string" },
      shipper: { type: "string" },
      consignee: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const CBM_PLANNER_SPEC = base({
  name: "Trade CBM Container Planner",
  description:
    "Parses CBM / packing sheets and estimates container utilization.",
  persona: `You analyze CBM sheets (e.g. CBM SHEET - TOYS FINAL QTY - YK).

Return totalCbm, suggested containerType (e.g. 40HC), containersNeeded, utilizationPct.`,
  task: `Parse CBM document and return container plan.`,
  config: { max_turns: 12, timeout_seconds: 220 },
  input_schema: {
    type: "object",
    required: ["document_url"],
    properties: {
      document_url: { type: "string", format: "document_url" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["summary", "confidence"],
    properties: {
      totalCbm: { type: "number" },
      containerType: { type: "string" },
      containersNeeded: { type: "number" },
      utilizationPct: { type: "number" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const FINAL_DOCS_PACK_SPEC = base({
  name: "Trade Final Docs Pack Check",
  description:
    "Checks completeness of shipping document pack vs PO (CI, PL, BL, etc.) and summarizes logistics status from forwarding threads.",
  persona: `You are SNSPL documentation / logistics control for active trade shipments.

Use cases:
1) Final docs pack: given CI/PL/BL/COO PDF or email, list required vs present vs missing for a typical FOB export pack.
2) Forwarder / booking follow-up emails WITHOUT a booking-confirmation PDF: summarize shipment status (vessel/container/POL/POD/ETD/ETA, doc corrections, surrender, shipping bill) and which docs are still outstanding.

commercial_model in notes:
- agency_commission: SNSPL is referee
- trader_principal: Global Praise (or SNSPL trading) is shipper/cnee principal

CRITICAL GATE:
- Set isTradeDeal=false for hotel/flight/expo-booth/APPA membership/personal travel/admin ledgers with no PO/BL/shipment.
- Real ocean/air freight logistics and export doc packs are isTradeDeal=true.

Prefer omit unknown numbers. confidence 0–1.`,
  task: `Return docs pack completeness + a concise logistics summary. Always include isTradeDeal and commercialModel when inferable.`,
  config: { max_turns: 10, timeout_seconds: 180 },
  input_schema: {
    type: "object",
    properties: {
      document_url: { type: "string", format: "document_url" },
      email_text: { type: "string" },
      notes: { type: "string" },
      required_docs_hint: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["required", "present", "missing", "complete", "summary", "confidence", "isTradeDeal"],
    properties: {
      isTradeDeal: { type: "boolean" },
      rejectReason: { type: "string" },
      commercialModel: { type: "string" },
      required: { type: "array", items: { type: "string" } },
      present: { type: "array", items: { type: "string" } },
      missing: { type: "array", items: { type: "string" } },
      complete: { type: "boolean" },
      vessel: { type: "string" },
      container: { type: "string" },
      pol: { type: "string" },
      pod: { type: "string" },
      etd: { type: "string" },
      eta: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const PAYMENT_CLOCK_SPEC = base({
  name: "Trade Payment Clock",
  description:
    "Computes T/T payment clock from BL-shared date. Respects agency vs trader cash lanes.",
  persona: `You track payment clocks for SNSPL trade deals.

commercial_model in notes/email:
- agency_commission: buyer pays factory directly; track buyer→factory T/T (~30d after BL shared); SNSPL does not hold principal cash.
- trader_principal: Global Praise / trading principal may pay exporters and collect from buyers separately — extract which leg the email is about.

Pattern: T/T against B/L, often ~30 days after BL shared.
Extract blSharedDate, dueDate, daysRemaining, amountUsd when stated.
status: not_started | pending | due_soon | overdue | paid.

CRITICAL SCHEMA RULES:
- If daysRemaining or amountUsd is unknown, OMIT the key — never output null.
- Prefer empty status "not_started" with a short summary over inventing dates.

GATE: If this is hotel/flight/expo/MSME/TDS/ledger admin invoicing, APPA/association membership dues, Interzoo stand charges, or SOA/global ledger with no trade BL/PO, set isTradeDeal=false.`,
  task: `Return payment clock state. Always include isTradeDeal and commercialModel. Never emit null for numeric fields.`,
  config: { max_turns: 8, timeout_seconds: 90 },
  input_schema: {
    type: "object",
    properties: {
      email_text: { type: "string" },
      notes: { type: "string" },
      as_of_date: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["status", "summary", "confidence", "isTradeDeal"],
    properties: {
      isTradeDeal: { type: "boolean" },
      rejectReason: { type: "string" },
      commercialModel: { type: "string" },
      blSharedDate: { type: "string" },
      dueDate: { type: "string" },
      daysRemaining: { type: "number" },
      amountUsd: { type: "number" },
      status: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const COMMISSION_CHECKLIST_SPEC = base({
  name: "Trade Commission Checklist",
  description:
    "Builds agency commission close checklist from accounts / payment advice emails.",
  persona: `You prepare SNSPL commission close-out checklists for agency_commission deals only.

Items typically: buyer paid factory, FX rate from accounts, commission invoice issued, payment advice received, deal closed.
Mark done true/false from evidence. Include fxRate/amount when stated.

If commercial_model is trader_principal (Global Praise buy/sell for own account), set isTradeDeal=true but note that agency commission checklist may not apply — summarize trading P&L signals instead in summary, and set complete=false unless commission language is present.

GATE: Set isTradeDeal=false ONLY for hotel/flight/expo-booth/personal travel / MSME-TDS-ledger admin. Real commission invoices are always isTradeDeal=true.
CRITICAL: If amount or fxRate unknown, OMIT those keys — never null. currency omit if unknown.`,
  task: `Return commission checklist from email_text/notes. Always include isTradeDeal=true for commission invoices. Never emit null for numbers.`,
  config: { max_turns: 8, timeout_seconds: 90 },
  input_schema: {
    type: "object",
    properties: {
      email_text: { type: "string" },
      notes: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["items", "complete", "summary", "confidence", "isTradeDeal"],
    properties: {
      isTradeDeal: { type: "boolean" },
      rejectReason: { type: "string" },
      commercialModel: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["item", "done"],
          properties: {
            item: { type: "string" },
            done: { type: "boolean" },
            notes: { type: "string" },
          },
        },
      },
      fxRate: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string" },
      complete: { type: "boolean" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
  },
});

export const ARTWORK_APPROVAL_PERSONA = `SNSPL artwork chase agent. Dispositions: Approved | ChangesRequested | EscalateToHuman.`;
export const SAMPLE_DISPATCH_PERSONA = `SNSPL sample chase. Dispositions: Shipped | Received | Delayed | EscalateToHuman.`;
export const PO_ACK_PERSONA = `SNSPL PO ack chase. Dispositions: Acknowledged | Mismatch | EscalateToHuman.`;
export const PRODUCTION_FOLLOWUP_PERSONA = `SNSPL production follow-up until ready date. Dispositions: OnTrack | Delayed | Ready | EscalateToHuman.`;
export const SAILING_CONFIRM_PERSONA = `SNSPL sailing confirm with factory/forwarder. Dispositions: Confirmed | Rejected | EscalateToHuman.`;
export const PAYMENT_REMINDER_PERSONA = `SNSPL payment/release reminder. Dispositions: Paid | NeedMoreTime | EscalateToHuman.`;

export const PHASE_BG_WORKER_SPECS = {
  artwork_checklist_extractor: ARTWORK_CHECKLIST_SPEC,
  sample_request_summarizer: SAMPLE_REQUEST_SPEC,
  pi_extractor: PI_EXTRACTOR_SPEC,
  po_extractor: PO_EXTRACTOR_SPEC,
  pi_po_discrepancy: PI_PO_DISCREPANCY_SPEC,
  upc_barcode_matcher: UPC_BARCODE_MATCHER_SPEC,
  packaging_photo_checklist: PACKAGING_PHOTO_CHECKLIST_SPEC,
  inspection_photo_summarizer: INSPECTION_PHOTO_SPEC,
  production_status_extractor: PRODUCTION_STATUS_SPEC,
  booking_extractor: BOOKING_EXTRACTOR_SPEC,
  cbm_container_planner: CBM_PLANNER_SPEC,
  final_docs_pack_check: FINAL_DOCS_PACK_SPEC,
  payment_clock: PAYMENT_CLOCK_SPEC,
  commission_checklist: COMMISSION_CHECKLIST_SPEC,
} as const;
