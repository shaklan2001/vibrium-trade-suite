import type { WorkspaceProcessId } from "@/lib/trade/workspaceProcess";

/** Faces shown in the crew banner before the overflow count. */
export const CREW_BANNER_FACE_LIMIT = 14;

/** The agent that reads a mailbox thread and drafts the reply. */
export const MAIL_REPLY_AGENT_ID = "mail_reply";

/** Display names are a label, not a document. */
export const AGENT_DISPLAY_NAME_MAX_LENGTH = 48;

export const IDENTITY_STORAGE_KEY = "vtrade.agent-identity.v1";

/** Swimlanes whose name contains this token are run by agents. */
export const AGENCY_LANE_MARK = "Agency";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export type Gender = "f" | "m";
export type AgentKind = "conversational" | "functional" | "analytical";
export type Autonomy = "fully_auto" | "auto_with_approval" | "draft" | "suggest";

export const AUTONOMY_LABELS: Record<Autonomy, string> = {
  fully_auto: "Fully auto",
  auto_with_approval: "Auto with approval",
  draft: "Draft only",
  suggest: "Suggest only",
};

export const AUTONOMY_HINTS: Record<Autonomy, string> = {
  fully_auto: "Runs the step to the end on its own.",
  auto_with_approval: "Acts, then a person confirms the decision.",
  draft: "Writes the draft. A person sends or releases it.",
  suggest: "Flags and recommends. It never decides.",
};

export const AUTONOMY_ORDER: Autonomy[] = [
  "fully_auto",
  "auto_with_approval",
  "draft",
  "suggest",
];

export interface CrewAgent {
  id: string;
  processId: WorkspaceProcessId;
  kind: AgentKind;
  autonomy: Autonomy;
  role: string;
  summary: string;
  channels: readonly string[];
  name: string;
  title: string;
  gender: Gender;
}

export interface Identity {
  name: string;
  firstName: string;
  title: string;
  gender: Gender;
  /** Portrait seed. Stays on the agent id so a rename keeps the same face. */
  seed: string;
  photo?: string;
}

export const CREW: CrewAgent[] = [
  {
    id: "ops_copilot",
    processId: "ops",
    kind: "conversational",
    autonomy: "suggest",
    role: "Answers the desk from the live book",
    summary: "Savvy reads the open book and answers in plain language. She does not change a deal.",
    channels: ["Chat"],
    name: "Savvy",
    title: "Trade Copilot",
    gender: "f",
  },
  {
    id: MAIL_REPLY_AGENT_ID,
    processId: "ops",
    kind: "conversational",
    autonomy: "draft",
    role: "Reads the mail and drafts the reply",
    summary: "Reads the newest mail in the thread and drafts the reply in the merchandiser’s style. A person reviews it and sends it.",
    channels: ["Email"],
    name: "Ankita",
    title: "Mail Read & Reply",
    gender: "f",
  },
  {
    id: "requirement_extractor",
    processId: "ops",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Turns an enquiry into a brief",
    summary: "Reads buyer emails and enquiry documents into a complete sourcing brief. It does not guess a missing field.",
    channels: ["Mail"],
    name: "Aarav Mehta",
    title: "Requirement Analyst",
    gender: "m",
  },
  {
    id: "quote_normalizer",
    processId: "ops",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Cleans factory quote sheets",
    summary: "Turns a factory AS or quote sheet into a SKU matrix the buyer can select from.",
    channels: ["Documents"],
    name: "Sara Fernandes",
    title: "Quote Normalizer",
    gender: "f",
  },
  {
    id: "artwork_checklist_extractor",
    processId: "ops",
    kind: "functional",
    autonomy: "auto_with_approval",
    role: "Lists artwork still open",
    summary: "Pulls required artwork and packaging assets, and what is already approved, from the thread and design PDFs.",
    channels: ["Documents"],
    name: "Diya Kapoor",
    title: "Artwork Checklist",
    gender: "f",
  },
  {
    id: "sample_request_summarizer",
    processId: "ops",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Summarises sample movement",
    summary: "Summarises sample dispatch, courier, and photo confirmation from the factory thread.",
    channels: ["Mail"],
    name: "Ishaan Rao",
    title: "Sample Brief",
    gender: "m",
  },
  {
    id: "pi_extractor",
    processId: "ops",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Reads the proforma invoice",
    summary: "Parses a factory proforma invoice into its header and line items.",
    channels: ["Documents"],
    name: "Tanvi Joshi",
    title: "PI Reader",
    gender: "f",
  },
  {
    id: "po_extractor",
    processId: "ops",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Reads the purchase order",
    summary: "Parses a buyer purchase order into its header and line items.",
    channels: ["Documents"],
    name: "Vihaan Malhotra",
    title: "PO Reader",
    gender: "m",
  },
  {
    id: "pi_po_discrepancy",
    processId: "ops",
    kind: "functional",
    autonomy: "auto_with_approval",
    role: "Checks PI against PO",
    summary: "Compares the structured PI and PO and lists the commercial mismatches.",
    channels: ["Documents"],
    name: "Ananya Bose",
    title: "PI vs PO",
    gender: "f",
  },
  {
    id: "upc_barcode_matcher",
    processId: "ops",
    kind: "functional",
    autonomy: "auto_with_approval",
    role: "Matches barcodes to the PO",
    summary: "Matches barcode artwork and labels against the UPC master and the PO lines.",
    channels: ["Documents"],
    name: "Rohan Gupta",
    title: "Barcode Match",
    gender: "m",
  },
  {
    id: "packaging_photo_checklist",
    processId: "ops",
    kind: "functional",
    autonomy: "suggest",
    role: "Checks pack photos",
    summary: "Confirms the required packaging photo views are present in the pack.",
    channels: ["Photos"],
    name: "Zara Khan",
    title: "Pack Photos",
    gender: "f",
  },
  {
    id: "inspection_photo_summarizer",
    processId: "ops",
    kind: "analytical",
    autonomy: "suggest",
    role: "Reads inspection photos",
    summary: "Summarises an inspection photo pack into item-level pass and fail notes. A person decides the release.",
    channels: ["Photos"],
    name: "Aditya Verma",
    title: "Inspection Read",
    gender: "m",
  },
  {
    id: "production_status_extractor",
    processId: "ops",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Reads production updates",
    summary: "Pulls production readiness out of factory status emails.",
    channels: ["Mail"],
    name: "Pooja Agarwal",
    title: "Production Status",
    gender: "f",
  },
  {
    id: "booking_extractor",
    processId: "ops",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Reads the ocean booking",
    summary: "Pulls the ocean booking fields from a carrier or forwarder PDF. Travel and hotel bookings are ignored.",
    channels: ["Mail"],
    name: "Nikhil Saxena",
    title: "Booking Reader",
    gender: "m",
  },
  {
    id: "cbm_container_planner",
    processId: "ops",
    kind: "functional",
    autonomy: "auto_with_approval",
    role: "Plans the container",
    summary: "Reads the CBM sheet and estimates how full the container will be. A person confirms the equipment.",
    channels: ["Documents"],
    name: "Ira Banerjee",
    title: "Container Plan",
    gender: "f",
  },
  {
    id: "final_docs_pack_check",
    processId: "ops",
    kind: "functional",
    autonomy: "auto_with_approval",
    role: "Checks the document pack",
    summary: "Checks the shipping pack against the PO — invoice, packing list, bill of lading — and summarises the forwarder thread.",
    channels: ["Documents"],
    name: "Kunal Bhatia",
    title: "Docs Pack",
    gender: "m",
  },
  {
    id: "ops_risk_scanner",
    processId: "ops",
    kind: "analytical",
    autonomy: "suggest",
    role: "Flags deals at risk",
    summary: "Scans the book for attention items and clusters what can slip. It never closes a deal.",
    channels: ["Book"],
    name: "Siddharth Pillai",
    title: "Risk Scanner",
    gender: "m",
  },
  {
    id: "ops_priority_ranker",
    processId: "ops",
    kind: "analytical",
    autonomy: "suggest",
    role: "Orders the day’s work",
    summary: "Scores the open deals and ranks the order the desk should touch them.",
    channels: ["Book"],
    name: "Kiara Singh",
    title: "Priority Ranker",
    gender: "f",
  },
  {
    id: "ops_daily_brief",
    processId: "ops",
    kind: "analytical",
    autonomy: "draft",
    role: "Writes the morning brief",
    summary: "Writes the morning brief for Command Center from the live book.",
    channels: ["Book"],
    name: "Aryan Chopra",
    title: "Daily Brief",
    gender: "m",
  },
  {
    id: "factory_recommender",
    processId: "ops",
    kind: "analytical",
    autonomy: "suggest",
    role: "Suggests factories",
    summary: "Shortlists factories for a buyer requirement from the partner profiles. A person makes the approach.",
    channels: ["Book"],
    name: "Saanvi Gill",
    title: "Factory Match",
    gender: "f",
  },
  {
    id: "shipment_pulse",
    processId: "ops",
    kind: "analytical",
    autonomy: "suggest",
    role: "Watches sailings",
    summary: "Summarises what is about to come, about to go, and already in the water, from the booking mail.",
    channels: ["Book"],
    name: "Reyansh Das",
    title: "Shipment Pulse",
    gender: "m",
  },
  {
    id: "payment_reader",
    processId: "finance",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Reads a payment into the ledger",
    summary: "Reads a payment email, remittance, TT copy, or invoice into one entry: who paid whom, how much, when, and for which POs.",
    channels: ["Email"],
    name: "Meera Kapoor",
    title: "Payment Reader",
    gender: "f",
  },
  {
    id: "payment_clock",
    processId: "finance",
    kind: "functional",
    autonomy: "fully_auto",
    role: "Runs the payment clock",
    summary: "Computes the T/T payment clock from the day the bill of lading was shared, for both the agency and trader lanes.",
    channels: ["Documents"],
    name: "Advait Hegde",
    title: "Payment Clock",
    gender: "m",
  },
  {
    id: "commission_checklist",
    processId: "finance",
    kind: "functional",
    autonomy: "auto_with_approval",
    role: "Checks the commission file",
    summary: "Builds the agency commission close from accounts mail and payment advice.",
    channels: ["Documents"],
    name: "Nisha Thakur",
    title: "Commission Check",
    gender: "f",
  },
  {
    id: "deal_economics_analyst",
    processId: "finance",
    kind: "analytical",
    autonomy: "suggest",
    role: "Explains deal economics",
    summary: "Explains cycle time, money, and risk on one deal, and cites the mail it came from.",
    channels: ["Book"],
    name: "Yash Arora",
    title: "Deal Economics",
    gender: "m",
  },
  {
    id: "finance_pulse",
    processId: "finance",
    kind: "analytical",
    autonomy: "suggest",
    role: "Summarises the money book",
    summary: "Summarises what is coming, what came in, what is about to come, what is at risk, and what is payable.",
    channels: ["Book"],
    name: "Tara Sen",
    title: "Finance Pulse",
    gender: "f",
  },
];

const CREW_IDS = new Set(CREW.map((agent) => agent.id));

export function crewFor(processId: WorkspaceProcessId): CrewAgent[] {
  return CREW.filter((agent) => agent.processId === processId);
}

export function identityOf(agent: CrewAgent, names: Readonly<Record<string, string>>): Identity {
  const custom = names[agent.id];
  const name = custom && custom.length > 0 ? custom : agent.name;
  const first = name.split(/[\s·]+/)[0];
  return {
    name,
    firstName: first || name,
    title: agent.title,
    gender: agent.gender,
    seed: agent.id,
  };
}

/** Empty, too long, or control characters are rejected. Empty means "use the given name". */
export function sanitizeAgentName(value: string): string | null {
  const name = value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  if (!name || name.length > AGENT_DISPLAY_NAME_MAX_LENGTH) return null;
  return name;
}

export function readIdentityOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const names: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!CREW_IDS.has(id) || typeof value !== "string") continue;
      const name = sanitizeAgentName(value);
      if (name) names[id] = name;
    }
    return names;
  } catch {
    return {};
  }
}

export function writeIdentityOverrides(names: Readonly<Record<string, string>>): void {
  const clean: Record<string, string> = {};
  for (const [id, value] of Object.entries(names)) {
    if (!CREW_IDS.has(id)) continue;
    const name = sanitizeAgentName(value);
    const agent = CREW.find((item) => item.id === id);
    if (!name || !agent || name === agent.name) continue;
    clean[id] = name;
  }
  window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(clean));
}

function assertCrew(): void {
  const ids = new Set<string>();
  for (const agent of CREW) {
    if (ids.has(agent.id)) throw new Error(`duplicate crew id ${agent.id}`);
    ids.add(agent.id);
    if (!sanitizeAgentName(agent.name)) throw new Error(`bad crew name ${agent.id}`);
    if (!agent.summary || agent.channels.length === 0) {
      throw new Error(`incomplete crew card ${agent.id}`);
    }
  }
}

if (process.env.NODE_ENV !== "production") assertCrew();
