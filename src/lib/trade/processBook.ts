export const OPS_LANES = ["Buyer", "Agency (SNSPL)", "Factory", "Forwarder"] as const;
export type OpsLane = (typeof OPS_LANES)[number];

export interface ProcessStep {
  id: string;
  phase: string;
  title: string;
  lane: string;
  detail: string;
}

export const OPS_STEPS: ProcessStep[] = [
  { id: "1", phase: "A · Requirement", title: "Buyer shares enquiry", lane: "Buyer", detail: "Category, retail, target FOB, contacts" },
  { id: "2", phase: "A · Requirement", title: "Approach factories", lane: "Agency (SNSPL)", detail: "Match partners by score & category" },
  { id: "3", phase: "A · Requirement", title: "AS / quote sheet", lane: "Factory", detail: "SKU matrix, MOQ, FOB" },
  { id: "4", phase: "A · Requirement", title: "Buyer selects SKUs", lane: "Buyer", detail: "Lock selection via agency" },
  { id: "5", phase: "B · Artwork", title: "Artwork / inserts", lane: "Buyer", detail: "Design files to agency" },
  { id: "6", phase: "B · Artwork", title: "Approval loop", lane: "Agency (SNSPL)", detail: "Forward ↔ factory ↔ buyer" },
  { id: "7", phase: "B · Samples", title: "Sample dispatch", lane: "Factory", detail: "Courier + photos" },
  { id: "8", phase: "C · Commercial", title: "Issue PI", lane: "Factory", detail: "Qty, packing, Incoterm" },
  { id: "9", phase: "C · Commercial", title: "Issue PO", lane: "Buyer", detail: "PO lines, UPC, load date" },
  { id: "10", phase: "C · Commercial", title: "PI vs PO check", lane: "Agency (SNSPL)", detail: "Discrepancy before lock" },
  { id: "11", phase: "D · Spec", title: "UPC / barcode / pack", lane: "Agency (SNSPL)", detail: "Approval gates 17–28" },
  { id: "12", phase: "E · Production", title: "Produce & inspect", lane: "Factory", detail: "Ready date, QC findings" },
  { id: "13", phase: "F · Booking", title: "Book & CBM plan", lane: "Forwarder", detail: "Cut-offs, vessel, equipment" },
  { id: "14", phase: "G · Close", title: "Docs & T/T clock", lane: "Agency (SNSPL)", detail: "CI/PL/BL · payment · commission" },
];

export const OPS_PHASES: readonly string[] = [
  "Requirement → Quote",
  "Artwork & samples",
  "PI / PO lock",
  "Spec & packaging",
  "Production",
  "Booking",
  "Docs · pay · commission",
];

export const FINANCE_LANES = [
  "Buyer",
  "Agency · Sourcing",
  "Agency · Accounts",
  "Factory",
] as const;

export const FINANCE_STEPS: ProcessStep[] = [
  { id: "1", phase: "0 · PI / PO", title: "PI & PO received", lane: "Agency · Sourcing", detail: "Lock commercial docs; capture payment terms both sides" },
  { id: "2", phase: "0 · PI / PO", title: "Parse payment terms", lane: "Agency · Accounts", detail: "Buyer PO + factory PI installments & checkpoints" },
  { id: "3", phase: "1 · Deploy", title: "Advance / deposit out", lane: "Agency · Accounts", detail: "Pay factory installment when checkpoint met" },
  { id: "4", phase: "1 · Deploy", title: "Confirm factory receipt", lane: "Factory", detail: "Email / advice — installment received" },
  { id: "5", phase: "2 · Track", title: "Open installments", lane: "Agency · Accounts", detail: "Still required · rolling 30–120d need" },
  { id: "6", phase: "2 · Track", title: "Cash blocked by stage", lane: "Agency · Sourcing", detail: "Production / transit / docs hold cash" },
  { id: "7", phase: "3 · Recover", title: "Buyer checkpoint due", lane: "Buyer", detail: "PO term gate (PO ack, BL, sailing…)" },
  { id: "8", phase: "3 · Recover", title: "Buyer remittance confirmed", lane: "Agency · Accounts", detail: "Email confirms payment against checkpoint" },
  { id: "9", phase: "3 · Recover", title: "Vendor ↔ buyer gap", lane: "Agency · Accounts", detail: "Days between factory pay and buyer collect" },
  { id: "10", phase: "4 · Settle", title: "Factory confirms buyer funds", lane: "Factory", detail: "Commercial settled on factory books" },
  { id: "11", phase: "4 · Settle", title: "Commission invoice / FX", lane: "Agency · Accounts", detail: "Agency fee awaiting, chasing, or received" },
  { id: "12", phase: "4 · Settle", title: "Close deal ledger", lane: "Agency · Sourcing", detail: "Sourcing + Accounts close the order" },
];

export const FINANCE_PHASES: readonly string[] = [
  "PI / PO + terms",
  "Deploy to factory",
  "Track exposure",
  "Buyer recoveries",
  "Commission settle",
];

export function bookFor(processId: "ops" | "finance"): {
  lanes: readonly string[];
  steps: ProcessStep[];
  phases: readonly string[];
} {
  if (processId === "finance") {
    return { lanes: FINANCE_LANES, steps: FINANCE_STEPS, phases: FINANCE_PHASES };
  }
  return { lanes: OPS_LANES, steps: OPS_STEPS, phases: OPS_PHASES };
}
