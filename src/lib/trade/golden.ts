/**
 * Golden agent results for offline / showcase demos.
 * Prefer live worker results when agents are configured; these seed the UI.
 */
import type {
  ArtworkChecklist,
  BookingDetails,
  CbmPlan,
  CommercialDocument,
  CommissionChecklist,
  DocsPackCheck,
  InspectionSummary,
  PackagingChecklist,
  PaymentClock,
  PiPoDiscrepancy,
  ProductionStatus,
  QuoteMatrix,
  RequirementFields,
  SampleRequestSummary,
  UpcBarcodeMatch,
} from "@/types/trade";

export const GOLDEN_REQUIREMENT: RequirementFields = {
  productCategory: "Leather / suede toys",
  materials: "leather, suede",
  targetRetailPrice: 4.99,
  targetFactoryCost: 1,
  currency: "USD",
  destination: "USA",
  buyerCompany: "Petrageous Designs",
  buyerContacts: [
    "Gretchen George <gretchen@petrageousdesigns.com>",
    "Brian George <brian@petrageousdesigns.com>",
    "Matthew Smigiel <Matthew@petrageousdesigns.com>",
  ],
  urgency: "normal",
  currentSourcingNotes: "Currently made in India; Ethical is a source.",
  openQuestions: [
    "Which SKUs/designs are required for sampling?",
    "Any specific compliance or safety certifications needed?",
  ],
  nextActions: [
    "Identify India leather/suede toy factories under $1.00 FOB",
    "Request AS sheet from shortlisted factories",
  ],
  subject: "Leather Toys AS Sheet",
  summary:
    "Petrageous seeks leather/suede toys with retail ~$4.99 and factory cost under $1.00; currently sourced in India.",
  confidence: 0.95,
  raw: { mode: "golden" },
};

export const GOLDEN_QUOTE: QuoteMatrix = {
  factoryName: "Y.K. Industries",
  currency: "USD",
  confidence: 0.9,
  skus: [
    {
      itemCode: "E26842",
      description: '13" Durable Leather Raccoon Rope Toy',
      unitPrice: 0.85,
      moq: 500,
      currency: "USD",
      selected: true,
    },
    {
      itemCode: "E26843",
      description: '13" Durable Leather Moose Rope Toy',
      unitPrice: 0.85,
      moq: 500,
      currency: "USD",
      selected: true,
    },
    {
      itemCode: "E26844",
      description: '13" Durable Leather Bear Rope Toy',
      unitPrice: 0.85,
      moq: 500,
      currency: "USD",
      selected: true,
    },
    {
      itemCode: "E26845",
      description: '13" Durable Leather Rabbit Rope Toy',
      unitPrice: 0.85,
      moq: 500,
      currency: "USD",
      selected: false,
    },
  ],
  raw: { mode: "golden" },
};

export const GOLDEN_ARTWORK: ArtworkChecklist = {
  items: [
    { asset: "Neater Mat front insert (6x4 India)", status: "pending", notes: "NP_neatermat PDF" },
    { asset: "Neat-Lik Express funlick insert (5x7)", status: "pending" },
    { asset: "Back panel barcode placement", status: "missing", notes: "Awaiting UPC confirmation" },
    { asset: "Master carton print", status: "pending" },
  ],
  summary: "Artwork pack shared with buyer; barcode placement still open.",
  confidence: 0.88,
  raw: { mode: "golden" },
};

export const GOLDEN_SAMPLES: SampleRequestSummary = {
  courier: "DHL",
  trackingNumber: "1234567890",
  dispatchDate: "2026-08-20",
  expectedArrival: "2026-08-27",
  items: ["E26842", "E26843", "E26844"],
  photoRefs: ["WhatsApp sample pack 20-Aug"],
  status: "Shipped",
  summary: "Y.K. dispatched 3 leather toy samples via DHL AWB 1234567890.",
  confidence: 0.92,
  raw: { mode: "golden" },
};

export const GOLDEN_PI: CommercialDocument = {
  docType: "pi",
  docNumber: "PI-LP-14682",
  factory: "Swastik Industries",
  shipper: "Swastik Industries",
  buyer: "Loving Pets Corp",
  consignee: "Loving Pets Corp",
  incoterm: "FOB Mundra",
  paymentTerms: "T/T against B/L",
  pol: "Mundra",
  pod: "New York",
  currency: "USD",
  totalAmount: 18500,
  totalCbm: 28.4,
  readyDate: "2026-09-19",
  lines: [
    {
      itemCode: "LP-4421",
      description: "Silicone pet mat assorted",
      qty: 5000,
      unitPrice: 1.85,
      amount: 9250,
      cbm: 12.1,
    },
    {
      itemCode: "LP-4422",
      description: "Silicone pet mat large",
      qty: 4000,
      unitPrice: 2.3125,
      amount: 9250,
      cbm: 16.3,
    },
  ],
  summary: "Swastik PI for Loving Pets PO 14682 — FOB Mundra, T/T against B/L.",
  confidence: 0.9,
  raw: { mode: "golden" },
};

export const GOLDEN_PO: CommercialDocument = {
  docType: "po",
  docNumber: "14682",
  factory: "Swastik Industries",
  buyer: "Loving Pets Corp",
  consignee: "Loving Pets Corp",
  incoterm: "FOB Mundra",
  paymentTerms: "T/T against B/L",
  pol: "Mundra",
  pod: "New York",
  currency: "USD",
  totalAmount: 18500,
  totalCbm: 28.4,
  readyDate: "2026-09-19",
  lines: [
    {
      itemCode: "LP-4421",
      description: "Silicone pet mat assorted",
      qty: 5000,
      unitPrice: 1.85,
      amount: 9250,
      cbm: 12.1,
    },
    {
      itemCode: "LP-4422",
      description: "Silicone pet mat large",
      qty: 4000,
      unitPrice: 2.3125,
      amount: 9250,
      cbm: 16.3,
    },
  ],
  summary: "Buyer PO 14682 aligned with Swastik PI on qty and FOB Mundra.",
  confidence: 0.91,
  raw: { mode: "golden" },
};

export const GOLDEN_DISCREPANCY: PiPoDiscrepancy = {
  mismatches: [
    {
      field: "paymentTerms",
      piValue: "T/T against B/L",
      poValue: "T/T against B/L",
      severity: "info",
      note: "Aligned",
    },
  ],
  aligned: true,
  summary: "PI and PO commercial fields are aligned for PO 14682.",
  confidence: 0.93,
  raw: { mode: "golden" },
};

export const GOLDEN_UPC: UpcBarcodeMatch = {
  rows: [
    {
      itemCode: "NM-6X4",
      description: "Neater Mat 6x4",
      upc: "810123456789",
      barcodePresent: true,
      matchStatus: "matched",
    },
    {
      itemCode: "NL-5X7",
      description: "Neat-Lik Express 5x7",
      upc: "810123456796",
      barcodePresent: true,
      matchStatus: "matched",
    },
    {
      itemCode: "NM-CARTON",
      description: "Master carton label",
      upc: "",
      barcodePresent: false,
      matchStatus: "missing_upc",
      notes: "Awaiting buyer UPC assignment",
    },
  ],
  summary: "2 of 3 Neater packaging SKUs matched to barcode art; carton UPC open.",
  confidence: 0.86,
  raw: { mode: "golden" },
};

export const GOLDEN_PACKAGING: PackagingChecklist = {
  poNumber: "20958",
  items: [
    { view: "Front", present: true },
    { view: "Back", present: true },
    { view: "Side", present: true },
    { view: "Top", present: true },
    { view: "Inner pack", present: true },
    { view: "Master carton", present: true },
    { view: "Barcode close-up", present: false, notes: "Not clearly visible in pack" },
  ],
  summary: "PACKAGING PO-20958 covers core views; barcode close-up weak.",
  confidence: 0.84,
  raw: { mode: "golden" },
};

export const GOLDEN_INSPECTION: InspectionSummary = {
  findings: [
    { itemCode: "NM-6X4", result: "pass", notes: "Print registration OK" },
    { itemCode: "NL-5X7", result: "conditional", notes: "Minor edge flash — within tolerance if buyer accepts" },
  ],
  overall: "Conditional pass — one SKU needs buyer confirm on flash",
  summary: "Inspection photos PO-20719 reviewed; mostly pass with one conditional.",
  confidence: 0.87,
  raw: { mode: "golden" },
};

export const GOLDEN_PRODUCTION: ProductionStatus = {
  readyDate: "2026-09-19",
  percentComplete: 85,
  blockers: ["Final barcode artwork on 2 SKUs"],
  summary: "Swastik PO 14682 ~85% complete; ready date 19 Sep if barcodes clear by Wed.",
  confidence: 0.9,
  raw: { mode: "golden" },
};

export const GOLDEN_BOOKING: BookingDetails = {
  bookingNumber: "EID0949971",
  carrier: "CMA CGM",
  vessel: "MSC LORETO",
  voyage: "26W36",
  pol: "Mundra",
  pod: "New York",
  etd: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
  eta: new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10),
  equipment: "40'HC",
  cutOffs: "SI cut-off tomorrow 17:00 IST · CY cut-off +3 days",
  shipmentStatus: "about_to_sail",
  summary: "About to sail — Mundra→NY 40HC · confirm docs today.",
  confidence: 0.9,
  raw: { mode: "golden" },
};

export const GOLDEN_CBM: CbmPlan = {
  totalCbm: 58.2,
  containerType: "40HC",
  containersNeeded: 1,
  utilizationPct: 86,
  summary: "YK toys CBM sheet totals ~58.2 CBM — fits one 40HC at ~86% utilization.",
  confidence: 0.88,
  raw: { mode: "golden" },
};

export const GOLDEN_DOCS: DocsPackCheck = {
  required: [
    "Commercial Invoice",
    "Packing List",
    "Bill of Lading",
    "Certificate of Origin",
  ],
  present: ["Packing List"],
  missing: ["Commercial Invoice", "Bill of Lading", "Certificate of Origin"],
  complete: false,
  summary: "PL V3F present; CI/BL/COO still outstanding for full docs pack.",
  confidence: 0.85,
  raw: { mode: "golden" },
};

export const GOLDEN_PAYMENT: PaymentClock = {
  blSharedDate: "2026-08-01",
  dueDate: "2026-08-31",
  daysRemaining: -5,
  status: "overdue",
  amountUsd: 17200,
  currency: "USD",
  summary:
    "BL shared 1 Aug; T/T +30 due 31 Aug — USD 17,200 overdue (Loving Pets / Swastik).",
  confidence: 0.9,
  raw: { mode: "golden" },
};

export const GOLDEN_COMMISSION: CommissionChecklist = {
  items: [
    { item: "Buyer paid factory", done: true },
    { item: "FX rate confirmed by accounts", done: true, notes: "83.25 INR/USD" },
    { item: "Commission invoice issued", done: false },
    { item: "Payment advice received", done: false },
    { item: "Deal marked closed", done: false },
  ],
  fxRate: "83.25 INR/USD",
  amount: 925,
  currency: "USD",
  complete: false,
  summary: "Factory paid; commission invoice and payment advice still open.",
  confidence: 0.89,
  raw: { mode: "golden" },
};
