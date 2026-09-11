import type {
  ExportReadinessClass,
  PartyProfile,
  PartyProfileScores,
  SupplierHubApplication,
  SupplierHubReadinessDimension,
} from "@/types/trade";

export const READINESS_DIMENSIONS: Omit<
  SupplierHubReadinessDimension,
  "score" | "evidence"
>[] = [
  { id: "company", label: "Company & financial strength", weightPct: 10 },
  { id: "infrastructure", label: "Factory & infrastructure", weightPct: 15 },
  {
    id: "capacity",
    label: "Manufacturing capability & capacity",
    weightPct: 15,
  },
  {
    id: "products",
    label: "Product & classification readiness",
    weightPct: 15,
  },
  { id: "packaging", label: "Packaging & shipment readiness", weightPct: 10 },
  {
    id: "quality",
    label: "Quality / certification / audit readiness",
    weightPct: 10,
  },
  { id: "market", label: "Market / export exposure", weightPct: 10 },
  { id: "buyerSupport", label: "Buyer support & sampling", weightPct: 10 },
  {
    id: "commercial",
    label: "Commercial / order execution",
    weightPct: 5,
  },
];

export const ONBOARDING_STEPS = [
  { id: "meta", title: "Application", short: "Start" },
  { id: "company", title: "Company & finance", short: "Company" },
  { id: "infrastructure", title: "Factory & infrastructure", short: "Factory" },
  { id: "capacity", title: "Machinery & capacity", short: "Capacity" },
  { id: "workforce", title: "Workforce", short: "Workforce" },
  { id: "products", title: "Products", short: "Products" },
  { id: "packaging", title: "Packaging & shipment", short: "Packaging" },
  { id: "quality", title: "Quality & audits", short: "Quality" },
  { id: "market", title: "Market & export", short: "Market" },
  { id: "exportDocs", title: "Export registrations", short: "Docs" },
  { id: "buyerSupport", title: "Buyer support", short: "Support" },
  { id: "commercial", title: "Commercial terms", short: "Commercial" },
  { id: "assessment", title: "Readiness & declaration", short: "Assess" },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function filled(...vals: Array<string | undefined | null | boolean>): number {
  return vals.filter((v) => {
    if (typeof v === "boolean") return v;
    return Boolean(v && String(v).trim());
  }).length;
}

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseLeadDays(text?: string): number | undefined {
  if (!text) return undefined;
  const m = String(text).match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function parseMoq(text?: string): number | undefined {
  if (!text) return undefined;
  const cleaned = String(text).replace(/,/g, "");
  const m = cleaned.match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

export function emptyReadinessDimensions(): SupplierHubReadinessDimension[] {
  return READINESS_DIMENSIONS.map((d) => ({
    ...d,
    score: 0,
    evidence: "",
  }));
}

export function createEmptySupplierApplication(
  filledBy: "ops" | "supplier" = "ops",
): SupplierHubApplication {
  const ts = now();
  return {
    id: uuid(),
    status: "draft",
    filledBy,
    createdAt: ts,
    updatedAt: ts,
    company: { legalName: "" },
    infrastructure: { dedicatedAreas: [] },
    capacity: {
      machines: [{ name: "" }, { name: "" }, { name: "" }],
    },
    workforce: {},
    products: {
      families: [
        {
          name: "",
          category: "",
        },
      ],
    },
    packaging: { exportPackInfo: [] },
    quality: {
      certifications: [{ name: "" }],
      qcCapabilities: [],
    },
    market: { supplyMarkets: [], exportPath: [] },
    exportDocs: {},
    buyerSupport: {
      canRespondTo: [],
      samplingCapability: [],
      overseasSampleSupport: [],
    },
    commercial: { orderTypes: [] },
    assessment: {
      dimensions: emptyReadinessDimensions(),
      totalScore: 0,
      classification: "",
      autoSuggested: true,
    },
    declaration: { confirmed: false },
  };
}

function scoreCompany(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const c = app.company;
  const bits = filled(
    c.legalName,
    c.constitution,
    c.yearEstablished,
    c.registeredAddress,
    c.manufacturingAddresses,
    c.email,
    c.phone,
    c.turnoverFy2425 || c.turnoverFy2324,
    c.yearsManufacturing,
    c.yearsInCategory,
  );
  const score = clampScore(35 + bits * 6.5);
  const evidence = [
    c.constitution && `Constitution: ${c.constitution}`,
    c.yearsManufacturing && `${c.yearsManufacturing} yrs manufacturing`,
    (c.turnoverFy2425 || c.turnoverFy2324) && "Turnover provided",
  ]
    .filter(Boolean)
    .join(" · ");
  return { score, evidence };
}

function scoreInfrastructure(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const i = app.infrastructure;
  const bits = filled(
    i.totalPremisesSqft,
    i.productionSqft,
    i.fgWarehouseSqft,
    i.qcSqft,
    i.ownershipStatus,
    i.shiftsPerDay,
    i.utilisationPct,
    i.spareCapacityPct,
  );
  const dedicated = i.dedicatedAreas?.length || 0;
  const score = clampScore(30 + bits * 7 + dedicated * 3);
  return {
    score,
    evidence: [
      i.productionSqft && `Shop floor ${i.productionSqft} sqft`,
      i.spareCapacityPct && `${i.spareCapacityPct}% spare capacity`,
      dedicated ? `${dedicated} controlled areas` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function scoreCapacity(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const c = app.capacity;
  const machines = c.machines.filter((m) => m.name?.trim()).length;
  const bits = filled(
    c.productionLines,
    c.outputDailyWeeklyMonthly,
    c.maxCapacity,
    c.normalLeadTime,
    c.sampleLeadExisting,
    c.sampleLeadNew,
  );
  const score = clampScore(25 + machines * 8 + bits * 8);
  return {
    score,
    evidence: [
      machines ? `${machines} machines listed` : "",
      c.normalLeadTime && `Lead ${c.normalLeadTime}`,
      c.outputDailyWeeklyMonthly && `Output: ${c.outputDailyWeeklyMonthly}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function scoreProducts(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const families = app.products.families.filter(
    (f) => f.name?.trim() || f.category?.trim(),
  );
  let detail = 0;
  for (const f of families) {
    detail += filled(
      f.name,
      f.category,
      f.materials,
      f.description,
      f.hsnCode,
      (f.infoAvailable?.length || 0) > 0 ? "info" : "",
    );
  }
  const score = clampScore(
    families.length === 0 ? 15 : 40 + families.length * 10 + detail * 3,
  );
  return {
    score,
    evidence: families.length
      ? `${families.length} product family(ies): ${families
          .map((f) => f.category || f.name)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ")}`
      : "No products yet",
  };
}

function scorePackaging(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const p = app.packaging;
  const bits = filled(
    p.productForm,
    p.standardPackFormat,
    p.masterCaseDetails,
    p.customPackaging,
    p.exportPackMaterials,
    (p.exportPackInfo?.length || 0) > 0 ? "pack" : "",
  );
  const score = clampScore(25 + bits * 12);
  return {
    score,
    evidence: [
      p.productForm,
      p.customPackaging && `Custom pack: ${p.customPackaging}`,
      (p.exportPackInfo?.length || 0) > 0 &&
        `${p.exportPackInfo!.length} export pack fields`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function scoreQuality(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const q = app.quality;
  const certs = q.certifications.filter((c) => c.name?.trim()).length;
  const qc = q.qcCapabilities?.length || 0;
  const bits = filled(q.previousAudits, q.recentAuditOutcome, q.auditWillingness);
  const score = clampScore(20 + certs * 12 + qc * 6 + bits * 8);
  return {
    score,
    evidence: [
      certs ? `${certs} certification(s)` : "",
      qc ? `${qc} QC capabilities` : "",
      q.auditWillingness && `Audit: ${q.auditWillingness}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function scoreMarket(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const m = app.market;
  const markets = m.supplyMarkets?.length || 0;
  const paths = m.exportPath?.length || 0;
  const bits = filled(
    m.yearsDirectExport,
    m.exportCountries,
    m.annualExportTurnover,
    m.yearsIndirectExport,
    m.exportCategories,
  );
  // First-time exporters still get credit for domestic + willingness signals
  const score = clampScore(30 + markets * 10 + paths * 8 + bits * 6);
  return {
    score,
    evidence: [
      markets ? `Markets: ${m.supplyMarkets!.join(", ")}` : "",
      m.yearsDirectExport != null && m.yearsDirectExport !== ""
        ? `Direct export yrs: ${m.yearsDirectExport}`
        : "Prior export not required",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function scoreBuyerSupport(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const b = app.buyerSupport;
  const score = clampScore(
    25 +
      (b.canRespondTo?.length || 0) * 5 +
      (b.samplingCapability?.length || 0) * 5 +
      (b.overseasSampleSupport?.length || 0) * 4 +
      filled(b.sampleLeadTime, b.intlQueryOwner, b.englishCommunication) * 8,
  );
  return {
    score,
    evidence: [
      b.englishCommunication && `English: ${b.englishCommunication}`,
      b.sampleLeadTime && `Sample lead ${b.sampleLeadTime}`,
      (b.samplingCapability?.length || 0) > 0 &&
        `${b.samplingCapability!.length} sampling caps`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function scoreCommercial(app: SupplierHubApplication): {
  score: number;
  evidence: string;
} {
  const c = app.commercial;
  const bits = filled(
    c.moq,
    c.mov,
    c.repeatLeadTime,
    c.firstOrderLeadTime,
    c.paymentTerms,
    c.incoterms,
    c.exportGateway,
    (c.orderTypes?.length || 0) > 0 ? "orders" : "",
  );
  const score = clampScore(30 + bits * 8);
  return {
    score,
    evidence: [
      c.moq && `MOQ ${c.moq}`,
      c.paymentTerms && `Payment ${c.paymentTerms}`,
      c.incoterms && c.incoterms,
      c.exportGateway && `Gateway ${c.exportGateway}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

const DIMENSION_SCORERS: Record<
  string,
  (app: SupplierHubApplication) => { score: number; evidence: string }
> = {
  company: scoreCompany,
  infrastructure: scoreInfrastructure,
  capacity: scoreCapacity,
  products: scoreProducts,
  packaging: scorePackaging,
  quality: scoreQuality,
  market: scoreMarket,
  buyerSupport: scoreBuyerSupport,
  commercial: scoreCommercial,
};

export function classifyReadiness(total: number): ExportReadinessClass {
  if (total >= 80) return "export_ready";
  if (total >= 65) return "export_ready_with_conditions";
  if (total >= 45) return "partially_export_ready";
  return "not_currently_export_ready";
}

export function readinessClassLabel(c: ExportReadinessClass | ""): string {
  switch (c) {
    case "export_ready":
      return "Export ready";
    case "export_ready_with_conditions":
      return "Export ready with conditions";
    case "partially_export_ready":
      return "Partially export ready";
    case "not_currently_export_ready":
      return "Not currently export ready";
    default:
      return "—";
  }
}

/** Auto-suggest section-12 weighted scores from form answers. */
export function suggestReadinessAssessment(
  app: SupplierHubApplication,
): SupplierHubApplication["assessment"] {
  const dimensions = READINESS_DIMENSIONS.map((d) => {
    const { score, evidence } = DIMENSION_SCORERS[d.id]!(app);
    return { ...d, score, evidence };
  });
  const totalScore = clampScore(
    dimensions.reduce((a, d) => a + (d.score * d.weightPct) / 100, 0),
  );
  const gaps: string[] = [];
  for (const d of dimensions) {
    if (d.score < 55) gaps.push(`${d.label} (${d.score})`);
  }
  const strengths = dimensions
    .filter((d) => d.score >= 75)
    .map((d) => d.label)
    .slice(0, 4);

  return {
    dimensions,
    totalScore,
    classification: classifyReadiness(totalScore),
    criticalGaps: gaps.length
      ? `Close: ${gaps.join("; ")}`
      : app.assessment.criticalGaps || "",
    keyStrengths: strengths.length
      ? strengths.join("; ")
      : app.assessment.keyStrengths || "",
    recommendedNextSteps:
      app.assessment.recommendedNextSteps ||
      (totalScore >= 80
        ? "Eligible for buyer introduction; keep certs and samples current."
        : totalScore >= 65
          ? "Address listed conditions before introducing to premium buyers."
          : "Strengthen capacity/product/QC evidence before active shortlisting."),
    autoSuggested: true,
  };
}

export function recomputeAssessmentTotal(
  dimensions: SupplierHubReadinessDimension[],
): number {
  return clampScore(
    dimensions.reduce((a, d) => a + (d.score * d.weightPct) / 100, 0),
  );
}

function headcount(app: SupplierHubApplication): number {
  const w = app.workforce;
  const nums = [
    w.permanentProduction,
    w.permanentQuality,
    w.packingWarehouse,
    w.maintenance,
    w.supervisory,
    w.temporary,
  ]
    .map((x) => parseMoq(x) || 0)
    .reduce((a, b) => a + b, 0);
  return nums;
}

/** Map HUB answers → PartyProfile scores used by factory_recommender. */
export function derivePartyScores(
  app: SupplierHubApplication,
): PartyProfileScores {
  const a = app.assessment.dimensions.length
    ? app.assessment
    : suggestReadinessAssessment(app);
  const byId = Object.fromEntries(a.dimensions.map((d) => [d.id, d.score]));
  const hc = headcount(app);
  const size = clampScore(
    (byId.company || 50) * 0.35 +
      (byId.infrastructure || 50) * 0.35 +
      Math.min(100, 40 + hc / 5) * 0.3,
  );
  const output = clampScore(
    (byId.capacity || 50) * 0.55 + (byId.products || 50) * 0.45,
  );
  const onTimeDelivery = clampScore(
    (byId.capacity || 50) * 0.4 +
      (byId.commercial || 50) * 0.35 +
      (byId.buyerSupport || 50) * 0.25,
  );
  const shipmentReliability = clampScore(
    (byId.packaging || 50) * 0.4 +
      (byId.market || 50) * 0.3 +
      docReadinessBoost(app) * 0.3,
  );
  const quality = clampScore(
    (byId.quality || 50) * 0.7 + (byId.buyerSupport || 50) * 0.3,
  );
  const overall = clampScore(
    size * 0.12 +
      output * 0.18 +
      onTimeDelivery * 0.25 +
      shipmentReliability * 0.2 +
      quality * 0.25,
  );
  return {
    overall,
    size,
    output,
    onTimeDelivery,
    shipmentReliability,
    quality,
  };
}

function docReadinessBoost(app: SupplierHubApplication): number {
  const d = app.exportDocs;
  const statuses = [d.pan, d.gst, d.iec, d.lut, d.icegate, d.adCode, d.rcmc];
  const available = statuses.filter((s) => s === "available").length;
  const applied = statuses.filter((s) => s === "applied").length;
  return clampScore(35 + available * 9 + applied * 4);
}

function cityFromAddress(addr?: string): string | undefined {
  if (!addr) return undefined;
  const parts = addr.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] || parts[0] : parts[0];
}

export function applicationToPartyProfile(
  app: SupplierHubApplication,
  existing?: PartyProfile,
): PartyProfile {
  const assessment =
    app.assessment.dimensions.some((d) => d.score > 0) ||
    app.assessment.totalScore > 0
      ? app.assessment
      : suggestReadinessAssessment(app);
  const scores = derivePartyScores({ ...app, assessment });
  const categories = Array.from(
    new Set(
      app.products.families
        .flatMap((f) => [f.category, f.name])
        .map((s) => (s || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const materials = Array.from(
    new Set(
      app.products.families
        .map((f) => f.materials?.trim())
        .filter(Boolean) as string[],
    ),
  );
  const certifications = app.quality.certifications
    .map((c) => c.name.trim())
    .filter(Boolean);
  const avgLeadDays =
    parseLeadDays(app.commercial.repeatLeadTime) ||
    parseLeadDays(app.capacity.normalLeadTime);
  const sampleLeadDays =
    parseLeadDays(app.buyerSupport.sampleLeadTime) ||
    parseLeadDays(app.capacity.sampleLeadExisting);
  const moqTypical = parseMoq(app.commercial.moq);
  const movTypical = parseMoq(app.commercial.mov);

  const notesParts = [
    assessment.classification
      ? `HUB: ${readinessClassLabel(assessment.classification)} (${assessment.totalScore}/100)`
      : "",
    assessment.keyStrengths ? `Strengths: ${assessment.keyStrengths}` : "",
    assessment.criticalGaps ? `Gaps: ${assessment.criticalGaps}` : "",
    app.commercial.commercialConstraints
      ? `Constraints: ${app.commercial.commercialConstraints}`
      : "",
    app.company.domesticMarkets
      ? `Domestic: ${app.company.domesticMarkets}`
      : "",
  ].filter(Boolean);

  return {
    id: existing?.id || app.profileId || `factory-hub-${app.id.slice(0, 8)}`,
    role: "factory",
    name:
      app.company.primaryContact ||
      existing?.name ||
      app.company.tradeName ||
      "Factory desk",
    company:
      app.company.legalName ||
      app.company.tradeName ||
      existing?.company ||
      "Unnamed factory",
    email: app.company.email || existing?.email,
    phone: app.company.phone || app.company.whatsapp || existing?.phone,
    country: "India",
    city:
      cityFromAddress(app.company.manufacturingAddresses) ||
      cityFromAddress(app.company.registeredAddress) ||
      existing?.city,
    categories: categories.length ? categories : existing?.categories || [],
    scores,
    avgLeadDays: avgLeadDays ?? existing?.avgLeadDays,
    moqTypical: moqTypical ?? existing?.moqTypical,
    notes: notesParts.join(" · ") || existing?.notes,
    activeDealsHint: existing?.activeDealsHint ?? 0,
    sourceApplicationId: app.id,
    readinessClass: assessment.classification || undefined,
    readinessScore: assessment.totalScore,
    certifications,
    materials,
    paymentTermsAccepted: app.commercial.paymentTerms || undefined,
    incoterms: app.commercial.incoterms || undefined,
    exportPort: app.commercial.exportGateway || undefined,
    sampleLeadDays,
    movTypical,
    englishOk:
      app.buyerSupport.englishCommunication === "Yes"
        ? true
        : app.buyerSupport.englishCommunication === "No"
          ? false
          : undefined,
    auditWillingness: app.quality.auditWillingness || undefined,
    hubOnboardedAt: app.submittedAt || now(),
  };
}

/** Fields required before submit — ranking essentials. */
export function submitValidationErrors(
  app: SupplierHubApplication,
): string[] {
  const errors: string[] = [];
  if (!app.company.legalName.trim()) errors.push("Legal company name");
  if (!app.company.email?.trim() && !app.company.phone?.trim()) {
    errors.push("Email or phone");
  }
  const hasProduct = app.products.families.some(
    (f) => f.category?.trim() || f.name?.trim(),
  );
  if (!hasProduct) errors.push("At least one product / category");
  if (!app.commercial.moq?.trim() && !app.capacity.normalLeadTime?.trim()) {
    errors.push("MOQ or normal production lead time");
  }
  if (!app.declaration.confirmed) {
    errors.push("Manufacturer declaration confirmation");
  }
  if (!app.declaration.authorisedName?.trim()) {
    errors.push("Authorised person name");
  }
  return errors;
}

export function prepareApplicationForSubmit(
  app: SupplierHubApplication,
): SupplierHubApplication {
  let assessment = app.assessment;
  if (
    assessment.autoSuggested !== false ||
    !assessment.dimensions.some((d) => d.score > 0)
  ) {
    assessment = suggestReadinessAssessment(app);
  } else {
    const totalScore = recomputeAssessmentTotal(assessment.dimensions);
    assessment = {
      ...assessment,
      totalScore,
      classification:
        assessment.classification || classifyReadiness(totalScore),
    };
  }
  const ts = now();
  return {
    ...app,
    assessment,
    status: "submitted",
    submittedAt: ts,
    updatedAt: ts,
    declaration: {
      ...app.declaration,
      signedAt: app.declaration.signedAt || ts.slice(0, 10),
    },
  };
}
