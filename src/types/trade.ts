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

export const ALL_STAGES: DealStage[] = [
  "requirement",
  "outreach",
  "quoting",
  "selection",
  "artwork",
  "samples",
  "pi_po",
  "packaging",
  "production",
  "booking",
  "docs_payment",
  "closed",
];

export const PHASE_A_STAGES: DealStage[] = [
  "requirement",
  "outreach",
  "quoting",
  "selection",
];

export const PHASE_BG_STAGES: DealStage[] = [
  "artwork",
  "samples",
  "pi_po",
  "packaging",
  "production",
  "booking",
  "docs_payment",
  "closed",
];

/** @deprecated use PHASE_BG_STAGES */
export const FUTURE_STAGES = PHASE_BG_STAGES;

export const STAGE_LABELS: Record<DealStage, string> = {
  requirement: "Requirement",
  outreach: "Factory outreach",
  quoting: "Quoting",
  selection: "Buyer selection",
  artwork: "Artwork",
  samples: "Samples",
  pi_po: "PI / PO",
  packaging: "Packaging",
  production: "Production",
  booking: "Booking",
  docs_payment: "Docs & payment",
  closed: "Closed",
};

export interface Party {
  role: "buyer" | "agency" | "factory" | "forwarder" | "trader";
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  /** Link into the org party directory */
  profileId?: string;
}

/** Persisted email / message that grounded an extraction or stage action */
export type SourceMessageKind =
  | "requirement"
  | "quote"
  | "artwork"
  | "samples"
  | "pi"
  | "po"
  | "packaging"
  | "production"
  | "inspection"
  | "booking"
  | "payment"
  | "commission"
  | "other";

/** File attached to a source message (openable for audit) */
export interface SourceAttachment {
  name: string;
  /** Repo path e.g. docs/samples/Sourcing/... */
  samplePath?: string;
  /** Openable URL (static /samples/... or uploaded) */
  url?: string;
  /** Worker / agent that consumed this artefact */
  extractedBy?: string;
  /** One-line note of what the agent pulled from this file */
  extractedSummary?: string;
}

export interface SourceMessage {
  id: string;
  kind: SourceMessageKind;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  receivedAt?: string;
  body: string;
  relatedDocumentId?: string;
  label?: string;
  attachments?: SourceAttachment[];
  /** Agent that extracted structured fields from this message */
  extractedBy?: string;
  /** Short summary of agent output grounded in this source */
  extractedSummary?: string;
}

/** Org-wide buyer / factory profile for scoring & recommendations */
export interface PartyProfileScores {
  /** Composite 0–100 */
  overall: number;
  /** Relative scale / headcount / plants */
  size: number;
  /** Volume / SKU breadth capacity */
  output: number;
  /** On-time production & ready dates */
  onTimeDelivery: number;
  /** Booking / sailing / docs reliability */
  shipmentReliability: number;
  /** QC / inspection pass rate proxy */
  quality: number;
}

export type ExportReadinessClass =
  | "export_ready"
  | "export_ready_with_conditions"
  | "partially_export_ready"
  | "not_currently_export_ready";

export interface PartyProfile {
  id: string;
  role: "buyer" | "factory";
  name: string;
  company: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  categories: string[];
  scores: PartyProfileScores;
  avgLeadDays?: number;
  moqTypical?: number;
  notes?: string;
  activeDealsHint?: number;
  /** Linked Supplier HUB application when onboarded via form */
  sourceApplicationId?: string;
  readinessClass?: ExportReadinessClass;
  readinessScore?: number;
  certifications?: string[];
  materials?: string[];
  paymentTermsAccepted?: string;
  incoterms?: string;
  exportPort?: string;
  sampleLeadDays?: number;
  movTypical?: number;
  englishOk?: boolean;
  auditWillingness?: string;
  hubOnboardedAt?: string;
}

export interface FactoryRecommendation {
  profileId: string;
  company: string;
  score: number;
  fitReasons: string[];
  caution?: string;
}

/** Doc status for Indian export registrations */
export type DocReadinessStatus = "available" | "applied" | "na" | "";

export interface SupplierProductFamily {
  name: string;
  category: string;
  description?: string;
  materials?: string;
  sizesVariants?: string;
  skuCode?: string;
  hsnCode?: string;
  infoAvailable?: string[];
}

export interface SupplierMachineRow {
  name: string;
  qty?: string;
  capacity?: string;
  makeModel?: string;
  year?: string;
}

export interface SupplierCertificationRow {
  name: string;
  issuer?: string;
  validity?: string;
  scope?: string;
}

export interface SupplierHubReadinessDimension {
  id: string;
  label: string;
  weightPct: number;
  score: number;
  evidence?: string;
}

/**
 * Savvy Net Supplier HUB Registration & Export Readiness application.
 * Maps to docs/suppliers/Savvy_Net_Supplier_HUB_Application_Export_Readiness_Form_v4.pdf
 */
export interface SupplierHubApplication {
  id: string;
  status: "draft" | "submitted";
  filledBy: "ops" | "supplier";
  reference?: string;
  preparedBy?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  /** PartyProfile id created/updated on submit */
  profileId?: string;

  company: {
    legalName: string;
    tradeName?: string;
    constitution?: string;
    yearEstablished?: string;
    registeredAddress?: string;
    manufacturingAddresses?: string;
    facilityCount?: string;
    website?: string;
    primaryContact?: string;
    designation?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    turnoverFy2324?: string;
    turnoverFy2425?: string;
    turnoverFy2526?: string;
    yearsManufacturing?: string;
    yearsInCategory?: string;
    domesticMarkets?: string;
  };

  infrastructure: {
    totalPremisesSqft?: string;
    builtUpSqft?: string;
    productionSqft?: string;
    rmStorageSqft?: string;
    wipStorageSqft?: string;
    fgWarehouseSqft?: string;
    packingSqft?: string;
    qcSqft?: string;
    labSqft?: string;
    dispatchSqft?: string;
    ownershipStatus?: string;
    shiftsPerDay?: string;
    workingDaysPerWeek?: string;
    utilisationPct?: string;
    spareCapacityPct?: string;
    dedicatedAreas?: string[];
  };

  capacity: {
    machines: SupplierMachineRow[];
    productionLines?: string;
    outputDailyWeeklyMonthly?: string;
    maxCapacity?: string;
    capacityUtilisationPct?: string;
    normalLeadTime?: string;
    sampleLeadExisting?: string;
    sampleLeadNew?: string;
    plannedExpansion?: string;
  };

  workforce: {
    permanentProduction?: string;
    permanentQuality?: string;
    packingWarehouse?: string;
    maintenance?: string;
    supervisory?: string;
    temporary?: string;
    avgPresentDay?: string;
    tempLabourDependency?: string;
    keyPersonnel?: string;
  };

  products: {
    families: SupplierProductFamily[];
  };

  packaging: {
    productForm?: string;
    standardPackFormat?: string;
    exportPackInfo?: string[];
    masterCaseDetails?: string;
    customPackaging?: string;
    exportPackMaterials?: string;
  };

  quality: {
    certifications: SupplierCertificationRow[];
    qcCapabilities?: string[];
    previousAudits?: string;
    recentAuditOutcome?: string;
    auditWillingness?: string;
  };

  market: {
    supplyMarkets?: string[];
    exportPath?: string[];
    yearsDirectExport?: string;
    exportCountries?: string;
    annualExportTurnover?: string;
    yearsIndirectExport?: string;
    indirectExportCountries?: string;
    exportCategories?: string;
  };

  exportDocs: {
    pan?: DocReadinessStatus;
    panRef?: string;
    gst?: DocReadinessStatus;
    gstRef?: string;
    lut?: DocReadinessStatus;
    lutRef?: string;
    iec?: DocReadinessStatus;
    iecRef?: string;
    icegate?: DocReadinessStatus;
    icegateRef?: string;
    adCode?: DocReadinessStatus;
    adCodeRef?: string;
    rcmc?: DocReadinessStatus;
    rcmcRef?: string;
    entityDoc?: DocReadinessStatus;
    entityDocRef?: string;
    productLicences?: string;
    exportTemplates?: string;
    portsUsed?: string;
  };

  buyerSupport: {
    canRespondTo?: string[];
    samplingCapability?: string[];
    overseasSampleSupport?: string[];
    sampleLeadTime?: string;
    intlQueryOwner?: string;
    englishCommunication?: string;
  };

  commercial: {
    moq?: string;
    mov?: string;
    repeatLeadTime?: string;
    firstOrderLeadTime?: string;
    paymentTerms?: string;
    preferredPaymentMethod?: string;
    incoterms?: string;
    exportGateway?: string;
    orderTypes?: string[];
    commercialConstraints?: string;
  };

  assessment: {
    dimensions: SupplierHubReadinessDimension[];
    totalScore: number;
    classification: ExportReadinessClass | "";
    criticalGaps?: string;
    keyStrengths?: string;
    recommendedNextSteps?: string;
    /** True when scores were auto-suggested (ops may override) */
    autoSuggested?: boolean;
  };

  declaration: {
    confirmed: boolean;
    authorisedName?: string;
    designation?: string;
    signedAt?: string;
  };
}

export interface RequirementFields {
  productCategory?: string;
  materials?: string;
  targetRetailPrice?: number;
  targetFactoryCost?: number;
  currency?: string;
  destination?: string;
  buyerCompany?: string;
  buyerContacts?: string[];
  urgency?: string;
  currentSourcingNotes?: string;
  packingRequirements?: string;
  complianceNotes?: string;
  quantityHints?: string;
  openQuestions?: string[];
  nextActions?: string[];
  subject?: string;
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
  innerCarton?: number;
  masterCarton?: number;
  cbm?: number;
  selected?: boolean;
}

export interface QuoteMatrix {
  factoryName?: string;
  currency?: string;
  quoteDate?: string;
  incoterm?: string;
  paymentTerms?: string;
  leadTimeDays?: number;
  notes?: string;
  confidence?: number;
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

export type DocumentType =
  | "rfq"
  | "quote"
  | "artwork"
  | "sample_photo"
  | "pi"
  | "po"
  | "upc"
  | "barcode"
  | "packaging"
  | "inspection"
  | "booking"
  | "cbm"
  | "packing_list"
  | "commercial_invoice"
  | "bl"
  | "other";

export interface DealDocument {
  id: string;
  name: string;
  type: DocumentType;
  s3Key?: string;
  url?: string;
  samplePath?: string;
  uploadedAt: string;
  /** Agent that extracted from this document */
  extractedBy?: string;
  extractedSummary?: string;
}

export interface OutreachEnrollment {
  id: string;
  factoryName: string;
  contactId?: string;
  workflowId?: string;
  channel: Channel;
  status:
    | "enrolled"
    | "in_progress"
    | "QuotePromised"
    | "NeedClarification"
    | "Declined"
    | "EscalateToHuman"
    | "Selected"
    | "NeedMoreTime"
    | "unknown";
  enrolledAt: string;
  disposition?: string;
}

/** Phase B */
export interface ArtworkChecklistItem {
  asset: string;
  status: "missing" | "pending" | "approved" | "changes_requested";
  notes?: string;
}

export interface ArtworkChecklist {
  items: ArtworkChecklistItem[];
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

export interface SampleRequestSummary {
  courier?: string;
  trackingNumber?: string;
  dispatchDate?: string;
  expectedArrival?: string;
  photoRefs?: string[];
  items?: string[];
  status?: string;
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

/** Phase C */
export interface CommercialLine {
  itemCode?: string;
  description?: string;
  qty?: number;
  unitPrice?: number;
  amount?: number;
  cbm?: number;
  packing?: string;
}

export interface CommercialDocument {
  docType: "pi" | "po";
  docNumber?: string;
  shipper?: string;
  consignee?: string;
  buyer?: string;
  factory?: string;
  incoterm?: string;
  paymentTerms?: string;
  pol?: string;
  pod?: string;
  currency?: string;
  totalAmount?: number;
  totalCbm?: number;
  readyDate?: string;
  lines: CommercialLine[];
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

export interface DiscrepancyItem {
  field: string;
  piValue?: string;
  poValue?: string;
  severity: "info" | "warning" | "critical";
  note?: string;
}

export interface PiPoDiscrepancy {
  mismatches: DiscrepancyItem[];
  aligned: boolean;
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

/** Phase D */
export interface UpcMatchRow {
  itemCode?: string;
  description?: string;
  upc?: string;
  barcodePresent?: boolean;
  matchStatus: "matched" | "missing_barcode" | "missing_upc" | "mismatch";
  notes?: string;
}

export interface UpcBarcodeMatch {
  rows: UpcMatchRow[];
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

export interface PackagingChecklistItem {
  view: string;
  present: boolean;
  notes?: string;
}

export interface PackagingChecklist {
  items: PackagingChecklistItem[];
  poNumber?: string;
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

/** Phase E */
export interface InspectionFinding {
  itemCode?: string;
  result: "pass" | "fail" | "conditional" | "unknown";
  notes?: string;
}

export interface InspectionSummary {
  findings: InspectionFinding[];
  overall?: string;
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

export interface ProductionStatus {
  readyDate?: string;
  percentComplete?: number;
  blockers?: string[];
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

/** Phase F */
export interface BookingDetails {
  bookingNumber?: string;
  carrier?: string;
  vessel?: string;
  voyage?: string;
  pol?: string;
  pod?: string;
  etd?: string;
  eta?: string;
  equipment?: string;
  cutOffs?: string;
  /** Logistics posture for Command Center shipment KPIs */
  shipmentStatus?:
    | "planned"
    | "about_to_sail"
    | "in_waters"
    | "about_to_arrive"
    | "arrived"
    | "unknown";
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

export interface CbmPlan {
  totalCbm?: number;
  containerType?: string;
  containersNeeded?: number;
  utilizationPct?: number;
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

/** Phase G */
export interface DocsPackCheck {
  required: string[];
  present: string[];
  missing: string[];
  complete: boolean;
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentClock {
  blSharedDate?: string;
  dueDate?: string;
  daysRemaining?: number;
  status: "not_started" | "pending" | "due_soon" | "overdue" | "paid";
  /** Commercial amount on the payment clock (buyer → factory), USD */
  amountUsd?: number;
  currency?: string;
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

/** Who the installment is owed by / paid by in the commercial lane */
export type PaymentScheduleSide = "buyer" | "factory";

export type PaymentCheckpointStatus =
  | "upcoming"
  | "due"
  | "received"
  | "overdue"
  | "waived";

/**
 * Installment from PO/PI payment terms — released when a checkpoint is met
 * (e.g. PO signed, goods ready, BL shared) and confirmed by email.
 */
export interface PaymentCheckpoint {
  id: string;
  side: PaymentScheduleSide;
  /** Human label e.g. "30% advance on PO acknowledgement" */
  label: string;
  /** Share of order value when terms are %-based */
  percent?: number;
  amountUsd: number;
  /** Planned release / due date */
  dueDate?: string;
  status: PaymentCheckpointStatus;
  /** When funds were confirmed received */
  receivedAt?: string;
  /** Gate that unlocks this installment */
  checkpoint?: string;
  /** Source message confirming the gate and/or receipt */
  confirmationSourceId?: string;
  /** Related mailbox source ids for audit trail */
  sourceIds?: string[];
  termsExcerpt?: string;
}

/** Structured payment terms schedule for a deal (buyer PO + factory PI/PO). */
export interface DealPaymentSchedule {
  /** Buyer PO payment terms (how/when buyer remits) */
  buyerTerms?: string;
  /** Factory PI/PO payment terms (how/when factory is paid) */
  factoryTerms?: string;
  currency?: string;
  orderValueUsd?: number;
  checkpoints: PaymentCheckpoint[];
  sources?: ProvenanceCite[];
}

export interface CommissionChecklist {
  items: { item: string; done: boolean; notes?: string }[];
  fxRate?: string;
  amount?: number;
  currency?: string;
  complete: boolean;
  summary?: string;
  confidence?: number;
  executionId?: string;
  raw?: Record<string, unknown>;
}

export interface Deal {
  id: string;
  /** Human-facing deal code e.g. SNS-26-1042 */
  code: string;
  title: string;
  stage: DealStage;
  createdAt: string;
  updatedAt: string;
  parties: Party[];
  requirement?: RequirementFields;
  requirementExecutionId?: string;
  quote?: QuoteMatrix;
  documents: DealDocument[];
  /** Original emails / messages that grounded extractions */
  sources: SourceMessage[];
  timeline: TimelineEvent[];
  outreach: OutreachEnrollment[];
  selectionLocked?: boolean;
  showcase?: boolean;
  /** Seeded as part of Command Center book-of-business portfolio */
  portfolioSeed?: boolean;
  /** Hydrated from Outlook mailbox ingest (Neon processed_deals) */
  mailboxIngest?: boolean;
  /** Raw processed_deals.id (po:… / topic:…) for evidence API */
  mailboxSourceId?: string;
  /** agency_commission (SNSPL referee) | trader_principal (Global Praise) */
  commercialModel?: "agency_commission" | "trader_principal";
  /** Worker slot that produced the latest extract */
  mailboxSlot?: string;
  /** Latest agent structured result (for audit panel) */
  agentResult?: Record<string, unknown>;
  recommendedFactoryIds?: string[];
  artwork?: ArtworkChecklist;
  samples?: SampleRequestSummary;
  pi?: CommercialDocument;
  po?: CommercialDocument;
  discrepancy?: PiPoDiscrepancy;
  upcMatch?: UpcBarcodeMatch;
  packaging?: PackagingChecklist;
  inspection?: InspectionSummary;
  production?: ProductionStatus;
  booking?: BookingDetails;
  cbm?: CbmPlan;
  docsPack?: DocsPackCheck;
  payment?: PaymentClock;
  commission?: CommissionChecklist;
  /** PO/PI payment-term installments + checkpoint confirmations */
  paymentSchedule?: DealPaymentSchedule;
  /** Deal-level economics for Command Center (seeded + agent-refined) */
  economics?: DealEconomics;
  /** Cash exposure ledger (Finance workspace) */
  cashExposure?: DealCashExposure;
}

/** Cite the mail / artefact a KPI was grounded in */
export interface ProvenanceCite {
  dealId: string;
  dealCode?: string;
  sourceId?: string;
  kind?: SourceMessageKind;
  subject?: string;
  from?: string;
  excerpt: string;
}

export type CashBlockLocation =
  | "vendor"
  | "production"
  | "transit"
  | "port"
  | "inventory"
  | "buyer"
  | "none";

/** Per-deal cash ledger for working-capital exposure */
export interface DealCashExposure {
  pipelineCommitmentUsd: number;
  cashDeployedUsd: number;
  cashStillRequiredUsd: number;
  wipValueUsd?: number;
  receivableExpectedUsd: number;
  receivableDueDate?: string;
  receivableStatus: "none" | "expected" | "overdue" | "collected";
  blockedAt: CashBlockLocation;
  vendorPayDate?: string;
  buyerPayDate?: string;
  payGapDays?: number;
  commissionFxRate?: string;
  commissionInvoiceUsd?: number;
  commissionStatus?: "awaiting_fx" | "invoiced" | "chasing" | "received";
  sources: ProvenanceCite[];
}

export type AffordabilityBand = "comfortable" | "tight" | "blocked";

/** Per-deal time / money / risk-reward for Command Center Deals section */
export interface DealEconomics {
  dealId?: string;
  dealCode?: string;
  title?: string;
  commercialValueUsd: number;
  agencyCommissionUsd: number;
  agencyCommissionPct?: number;
  /** Typical end-to-end cycle for this lane (days) */
  cycleDaysTypical: number;
  /** Elapsed / observed so far */
  cycleDaysElapsed: number;
  /** Commercial cash at risk (buyer→factory unpaid / contested) */
  commercialCashAtRiskUsd: number;
  /** Agency commission / fee cash at risk */
  agencyCashAtRiskUsd: number;
  /** Expected inflows to agency in next ~14 days */
  agencyInflowNext14dUsd: number;
  riskRewardRatio: number;
  affordability: AffordabilityBand;
  liquidityNote: string;
  sources: ProvenanceCite[];
  summary?: string;
}

export interface FinancePulseLine {
  dealId: string;
  dealCode: string;
  title: string;
  bucket:
    | "commercial_incoming"
    | "commercial_received"
    | "commercial_about_to_come"
    | "commercial_at_risk"
    | "agency_incoming"
    | "agency_received"
    | "agency_about_to_come"
    | "agency_at_risk"
    | "agency_payables";
  amountUsd: number;
  note?: string;
  sources: ProvenanceCite[];
}

export interface FinancePulseReport {
  currency: string;
  /** Buyer→factory commercial */
  commercialReceivedUsd: number;
  commercialAboutToComeUsd: number;
  commercialAtRiskUsd: number;
  commercialExpectedTotalUsd: number;
  /** Agency commission / fee cash */
  agencyReceivedUsd: number;
  agencyAboutToComeUsd: number;
  agencyAtRiskUsd: number;
  agencyExpectedTotalUsd: number;
  agencyPayablesUsd: number;
  lines: FinancePulseLine[];
  summary: string;
  sources: ProvenanceCite[];
  confidence?: number;
}

export interface ShipmentPulseLine {
  dealId: string;
  dealCode: string;
  title: string;
  posture: "about_to_come" | "about_to_go" | "in_waters" | "other";
  etd?: string;
  eta?: string;
  vessel?: string;
  pol?: string;
  pod?: string;
  note?: string;
  sources: ProvenanceCite[];
}

export interface ShipmentPulseReport {
  aboutToCome: number;
  aboutToGo: number;
  inWaters: number;
  lines: ShipmentPulseLine[];
  summary: string;
  sources: ProvenanceCite[];
  confidence?: number;
}

export type WorkerSlot =
  | "requirement_extractor"
  | "quote_normalizer"
  | "artwork_checklist_extractor"
  | "sample_request_summarizer"
  | "pi_extractor"
  | "po_extractor"
  | "pi_po_discrepancy"
  | "upc_barcode_matcher"
  | "packaging_photo_checklist"
  | "inspection_photo_summarizer"
  | "production_status_extractor"
  | "booking_extractor"
  | "cbm_container_planner"
  | "final_docs_pack_check"
  | "payment_clock"
  | "commission_checklist"
  | "ops_risk_scanner"
  | "ops_priority_ranker"
  | "ops_daily_brief"
  | "factory_recommender"
  | "deal_economics_analyst"
  | "finance_pulse"
  | "shipment_pulse";

export type AgentSlot =
  | WorkerSlot
  | "factory_outreach"
  | "buyer_selection_chase"
  | "ops_copilot"
  | "wf_factory_outreach"
  | "wf_buyer_selection_chase";

export type AttentionSeverity = "critical" | "warning" | "info";

export type AttentionCategory =
  | "payment"
  | "docs"
  | "discrepancy"
  | "production"
  | "artwork"
  | "samples"
  | "stage_aging"
  | "selection"
  | "booking"
  | "commission"
  | "outreach";

export interface AttentionItem {
  id: string;
  dealId: string;
  dealCode: string;
  dealTitle: string;
  severity: AttentionSeverity;
  category: AttentionCategory;
  title: string;
  detail: string;
  dueAt?: string;
  nextStep: string;
  href: string;
}

export interface DealPriority {
  dealId: string;
  code: string;
  title: string;
  stage: DealStage;
  score: number;
  reasons: string[];
  attentionCount: number;
}

export interface CompanyPulse {
  openDeals: number;
  closedDeals: number;
  byStage: Record<DealStage, number>;
  atRiskCount: number;
  overduePayments: number;
  criticalAttention: number;
  warningAttention: number;
  avgStageAgeDays: number;
  needsAttentionNow: number;
}

export interface OpsIntelCache {
  /** True when content came from ops workers (not local templates) */
  agentSourced?: boolean;
  briefMarkdown?: string;
  headline?: string;
  rankedDealIds?: string[];
  rankRationales?: Record<string, string>;
  ranked?: DealPriority[];
  attention?: AttentionItem[];
  todos?: AttentionItem[];
  riskSummary?: string;
  prioritySummary?: string;
  finance?: FinancePulseReport;
  shipment?: ShipmentPulseReport;
  dealEconomics?: DealEconomics[];
  economicsSummary?: string;
  refreshedAt?: string;
  lastAutoDayKey?: string;
}

export type AgentRoutingMap = Record<AgentSlot, string>;

export const WORKER_SLOTS: WorkerSlot[] = [
  "requirement_extractor",
  "quote_normalizer",
  "artwork_checklist_extractor",
  "sample_request_summarizer",
  "pi_extractor",
  "po_extractor",
  "pi_po_discrepancy",
  "upc_barcode_matcher",
  "packaging_photo_checklist",
  "inspection_photo_summarizer",
  "production_status_extractor",
  "booking_extractor",
  "cbm_container_planner",
  "final_docs_pack_check",
  "payment_clock",
  "commission_checklist",
  "ops_risk_scanner",
  "ops_priority_ranker",
  "ops_daily_brief",
  "factory_recommender",
  "deal_economics_analyst",
  "finance_pulse",
  "shipment_pulse",
];

export const DEFAULT_ROUTING: AgentRoutingMap = {
  requirement_extractor:
    process.env.NEXT_PUBLIC_AGENT_REQUIREMENT_EXTRACTOR || "AA00000025",
  quote_normalizer:
    process.env.NEXT_PUBLIC_AGENT_QUOTE_NORMALIZER || "AA00000026",
  artwork_checklist_extractor:
    process.env.NEXT_PUBLIC_AGENT_ARTWORK_CHECKLIST || "AA00000027",
  sample_request_summarizer:
    process.env.NEXT_PUBLIC_AGENT_SAMPLE_REQUEST || "AA00000028",
  pi_extractor: process.env.NEXT_PUBLIC_AGENT_PI_EXTRACTOR || "AA00000029",
  po_extractor: process.env.NEXT_PUBLIC_AGENT_PO_EXTRACTOR || "AA00000030",
  pi_po_discrepancy:
    process.env.NEXT_PUBLIC_AGENT_PI_PO_DISCREPANCY || "AA00000031",
  upc_barcode_matcher:
    process.env.NEXT_PUBLIC_AGENT_UPC_BARCODE || "AA00000032",
  packaging_photo_checklist:
    process.env.NEXT_PUBLIC_AGENT_PACKAGING_CHECKLIST || "AA00000033",
  inspection_photo_summarizer:
    process.env.NEXT_PUBLIC_AGENT_INSPECTION || "AA00000034",
  production_status_extractor:
    process.env.NEXT_PUBLIC_AGENT_PRODUCTION_STATUS || "AA00000035",
  booking_extractor: process.env.NEXT_PUBLIC_AGENT_BOOKING || "AA00000036",
  cbm_container_planner: process.env.NEXT_PUBLIC_AGENT_CBM || "AA00000037",
  final_docs_pack_check:
    process.env.NEXT_PUBLIC_AGENT_DOCS_PACK || "AA00000038",
  payment_clock: process.env.NEXT_PUBLIC_AGENT_PAYMENT_CLOCK || "AA00000039",
  commission_checklist:
    process.env.NEXT_PUBLIC_AGENT_COMMISSION || "AA00000040",
  ops_risk_scanner:
    process.env.NEXT_PUBLIC_AGENT_OPS_RISK_SCANNER || "AA00000055",
  ops_priority_ranker:
    process.env.NEXT_PUBLIC_AGENT_OPS_PRIORITY_RANKER || "AA00000056",
  ops_daily_brief:
    process.env.NEXT_PUBLIC_AGENT_OPS_DAILY_BRIEF || "AA00000057",
  factory_recommender:
    process.env.NEXT_PUBLIC_AGENT_FACTORY_RECOMMENDER || "AA00000058",
  deal_economics_analyst:
    process.env.NEXT_PUBLIC_AGENT_DEAL_ECONOMICS || "AA00000059",
  finance_pulse: process.env.NEXT_PUBLIC_AGENT_FINANCE_PULSE || "AA00000060",
  shipment_pulse:
    process.env.NEXT_PUBLIC_AGENT_SHIPMENT_PULSE || "AA00000061",
  factory_outreach: process.env.NEXT_PUBLIC_BOT_FACTORY_OUTREACH || "",
  buyer_selection_chase:
    process.env.NEXT_PUBLIC_BOT_BUYER_SELECTION_CHASE || "",
  ops_copilot:
    process.env.NEXT_PUBLIC_BOT_OPS_COPILOT ||
    process.env.VIBRIUM_OPS_COPILOT_BOT_ID ||
    "VB00000323",
  wf_factory_outreach: process.env.NEXT_PUBLIC_WF_FACTORY_OUTREACH || "",
  wf_buyer_selection_chase:
    process.env.NEXT_PUBLIC_WF_BUYER_SELECTION_CHASE || "",
};
