export type Channel = "email" | "whatsapp" | "voice" | "portal";

export type DealStage =
  | "requirement"
  | "outreach"
  | "quoting"
  | "selection"
  | "artwork"
  | "samples"
  | "pi_po"
  | "packaging"
  | "production"
  | "booking"
  | "docs_payment"
  | "closed";

export const PHASE_A_STAGES: DealStage[] = [
  "requirement",
  "outreach",
  "quoting",
  "selection",
];

export const FUTURE_STAGES: DealStage[] = [
  "artwork",
  "samples",
  "pi_po",
  "packaging",
  "production",
  "booking",
  "docs_payment",
  "closed",
];

export const STAGE_LABELS: Record<DealStage, string> = {
  requirement: "Requirement",
  outreach: "Factory outreach",
  quoting: "Quoting",
  selection: "Buyer selection",
  artwork: "Artwork (Phase B)",
  samples: "Samples (Phase B)",
  pi_po: "PI / PO (Phase C)",
  packaging: "Packaging (Phase D)",
  production: "Production (Phase E)",
  booking: "Booking (Phase F)",
  docs_payment: "Docs & payment (Phase G)",
  closed: "Closed",
};

export interface Party {
  role: "buyer" | "agency" | "factory" | "forwarder";
  name: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface RequirementFields {
  productCategory?: string;
  materials?: string;
  targetRetailPrice?: number;
  targetFactoryCost?: number;
  currency?: string;
  destination?: string;
  buyerContacts?: string[];
  urgency?: string;
  summary?: string;
  confidence?: number;
  raw?: Record<string, unknown>;
}

export interface QuoteSku {
  itemCode?: string;
  description?: string;
  imageRef?: string;
  moq?: number;
  unitPrice?: number;
  currency?: string;
  packingNotes?: string;
  selected?: boolean;
}

export interface QuoteMatrix {
  factoryName?: string;
  currency?: string;
  skus: QuoteSku[];
  raw?: Record<string, unknown>;
  executionId?: string;
}

export interface TimelineEvent {
  id: string;
  at: string;
  channel: Channel;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface DealDocument {
  id: string;
  name: string;
  type: "rfq" | "quote" | "other";
  s3Key?: string;
  url?: string;
  uploadedAt: string;
}

export interface OutreachEnrollment {
  id: string;
  factoryName: string;
  contactId?: string;
  workflowId?: string;
  channel: Channel;
  status: "enrolled" | "in_progress" | "QuotePromised" | "NeedClarification" | "Declined" | "EscalateToHuman" | "Selected" | "NeedMoreTime" | "unknown";
  enrolledAt: string;
  disposition?: string;
}

export interface Deal {
  id: string;
  title: string;
  stage: DealStage;
  createdAt: string;
  updatedAt: string;
  parties: Party[];
  requirement?: RequirementFields;
  requirementExecutionId?: string;
  quote?: QuoteMatrix;
  documents: DealDocument[];
  timeline: TimelineEvent[];
  outreach: OutreachEnrollment[];
  selectionLocked?: boolean;
}

export type AgentSlot =
  | "requirement_extractor"
  | "quote_normalizer"
  | "factory_outreach"
  | "buyer_selection_chase"
  | "ops_copilot"
  | "wf_factory_outreach"
  | "wf_buyer_selection_chase";

export interface AgentRoutingMap {
  requirement_extractor: string;
  quote_normalizer: string;
  factory_outreach: string;
  buyer_selection_chase: string;
  ops_copilot: string;
  wf_factory_outreach: string;
  wf_buyer_selection_chase: string;
}

export const DEFAULT_ROUTING: AgentRoutingMap = {
  requirement_extractor:
    process.env.NEXT_PUBLIC_AGENT_REQUIREMENT_EXTRACTOR || "",
  quote_normalizer: process.env.NEXT_PUBLIC_AGENT_QUOTE_NORMALIZER || "",
  factory_outreach: process.env.NEXT_PUBLIC_BOT_FACTORY_OUTREACH || "",
  buyer_selection_chase:
    process.env.NEXT_PUBLIC_BOT_BUYER_SELECTION_CHASE || "",
  ops_copilot: "",
  wf_factory_outreach: process.env.NEXT_PUBLIC_WF_FACTORY_OUTREACH || "",
  wf_buyer_selection_chase:
    process.env.NEXT_PUBLIC_WF_BUYER_SELECTION_CHASE || "",
};
