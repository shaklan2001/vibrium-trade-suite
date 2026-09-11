import type { OnboardingStepId } from "@/lib/trade/supplierOnboarding";
import type { SupplierHubApplication } from "@/types/trade";

export type FieldErrors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s()-]{7,20}$/;
const URL_RE = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;
const YEAR_RE = /^(19|20)\d{2}$/;
const PCT_RE = /^(100|[1-9]?\d)(\.\d+)?%?$/;
const POS_NUM_RE = /^\d[\d,]*(?:\.\d+)?$/;

function trim(v?: string | null) {
  return (v || "").trim();
}

function requireText(v: string | undefined, label: string): string | undefined {
  if (!trim(v)) return `${label} is required`;
  return undefined;
}

function optionalEmail(v?: string): string | undefined {
  const t = trim(v);
  if (!t) return undefined;
  if (!EMAIL_RE.test(t)) return "Enter a valid email, e.g. yash@ykindustries.co.in";
  return undefined;
}

function optionalPhone(v?: string): string | undefined {
  const t = trim(v);
  if (!t) return undefined;
  if (!PHONE_RE.test(t)) return "Enter a valid phone, e.g. +91 98765 43210";
  return undefined;
}

function optionalUrl(v?: string): string | undefined {
  const t = trim(v);
  if (!t) return undefined;
  if (!URL_RE.test(t)) return "Enter a website like https://www.ykindustries.co.in";
  return undefined;
}

function optionalYear(v?: string): string | undefined {
  const t = trim(v);
  if (!t) return undefined;
  if (!YEAR_RE.test(t)) return "Use a 4-digit year, e.g. 2008";
  return undefined;
}

function optionalPct(v?: string): string | undefined {
  const t = trim(v);
  if (!t) return undefined;
  if (!PCT_RE.test(t.replace(/\s/g, ""))) return "Enter 0–100, e.g. 72 or 72%";
  return undefined;
}

function optionalPositiveNumber(v?: string, hint = "e.g. 25000"): string | undefined {
  const t = trim(v);
  if (!t) return undefined;
  if (!POS_NUM_RE.test(t.replace(/\s/g, ""))) return `Enter a number, ${hint}`;
  return undefined;
}

function optionalLead(v?: string): string | undefined {
  const t = trim(v);
  if (!t) return undefined;
  if (!/\d/.test(t)) return "Include days or weeks, e.g. 45 days";
  return undefined;
}

/** Placeholders — realistic SNSPL / Indian factory examples */
export const PH: Record<string, string> = {
  reference: "HUB-2026-0142",
  preparedBy: "Priya Sharma (SNSPL) or supplier contact name",
  legalName: "Y.K. Industries Private Limited",
  tradeName: "Y.K. Pet Products",
  yearEstablished: "2008",
  registeredAddress: "Plot 12, Sector 7, Industrial Area, Moradabad, UP 244001",
  manufacturingAddresses:
    "Unit 1: Same as registered · Unit 2: SIDCUL, Haridwar (optional)",
  facilityCount: "2",
  website: "https://www.ykindustries.co.in",
  primaryContact: "Yash Kumar",
  designation: "Director — Exports",
  email: "yash@ykindustries.co.in",
  phone: "+91 98765 43210",
  whatsapp: "+91 98765 43210",
  turnoverFy2324: "₹4.2 Cr / ~USD 500,000",
  turnoverFy2425: "₹5.1 Cr / ~USD 610,000",
  turnoverFy2526: "₹6.0 Cr (projected)",
  yearsManufacturing: "18",
  yearsInCategory: "12",
  domesticMarkets: "North India pet specialty, modern trade, Amazon.in",
  totalPremisesSqft: "45000",
  builtUpSqft: "32000",
  productionSqft: "18000",
  rmStorageSqft: "4000",
  wipStorageSqft: "2500",
  fgWarehouseSqft: "5000",
  packingSqft: "2000",
  qcSqft: "800",
  labSqft: "400",
  dispatchSqft: "1200",
  ownershipStatus: "Owned (lease for Unit 2 until 2029)",
  shiftsPerDay: "2",
  workingDaysPerWeek: "6",
  utilisationPct: "72",
  spareCapacityPct: "25",
  machineName: "CNC leather cutting press",
  machineQty: "4",
  machineCapacity: "8,000 pcs/week",
  machineMake: "Atom / local fabricator",
  machineYear: "2019",
  productionLines: "3 leather toy lines + 1 packing line",
  outputDailyWeeklyMonthly: "Daily 1,200 pcs · Weekly 7,000 · Monthly ~28,000",
  maxCapacity: "~40,000 pcs/month at 3 shifts",
  capacityUtilisationPct: "70",
  normalLeadTime: "45–55 days after PO + deposit",
  sampleLeadExisting: "7–10 days",
  sampleLeadNew: "18–25 days (new development)",
  plannedExpansion: "Adding automatic packing line in Q4 2026",
  permanentProduction: "85",
  permanentQuality: "8",
  packingWarehouse: "12",
  maintenance: "4",
  supervisory: "6",
  temporary: "20 (peak season)",
  avgPresentDay: "110",
  keyPersonnel: "QC head: 10 yrs · Production manager: 14 yrs leather goods",
  productName: "Leather bone chew toy — medium",
  productCategory: "leather toys",
  productDescription:
    "Vegetable-tanned leather bone, stuffed with cotton, for medium dogs",
  productMaterials: "Buff leather, cotton fill, jute stitching",
  productSizes: "S / M / L · 8 colorways",
  productSku: "YK-LB-M-01",
  productHsn: "4205.00",
  standardPackFormat: "Polybag inner · 24 pcs master carton",
  masterCaseDetails: "24 pcs · 40×30×25 cm · GW 6.2 kg · NW 5.4 kg · 0.030 CBM",
  previousAudits: "Buyer social audit 2024 (passed with minor CAP)",
  recentAuditOutcome: "Mar 2025 · SGS · Grade B",
  yearsDirectExport: "0",
  exportCountries: "USA, EU (via merchant exporter)",
  annualExportTurnover: "USD 0 direct / ~USD 180k indirect",
  yearsIndirectExport: "6",
  indirectExportCountries: "USA, Canada, UK",
  exportCategories: "Leather & suede pet toys",
  productLicences: "None product-specific (toys — general GST/IEC)",
  exportTemplates: "Commercial invoice, packing list templates available",
  portsUsed: "ICD Loni / Nhava Sheva (via forwarder)",
  docRef: "AAAPL1234C / 09AAAAA0000A1Z5 / IEC 05169…",
  sampleLeadTime: "10 days existing · 21 days new",
  intlQueryOwner: "Exports desk — exports@factory.in",
  moq: "500 pcs per SKU (trial 250 subject to discussion)",
  mov: "USD 3,000 per shipment",
  repeatLeadTime: "40 days",
  firstOrderLeadTime: "55 days including sampling lock",
  paymentTerms: "30% TT advance · 70% against BL copy",
  preferredPaymentMethod: "TT in USD",
  incoterms: "FOB Nhava Sheva / Ex-Works Moradabad",
  exportGateway: "ICD Loni → Nhava Sheva",
  commercialConstraints: "No open-account beyond 30 days without credit check",
  authorisedName: "Yash Kumar",
  declarationDesignation: "Director",
  criticalGaps: "IEC applied; need export packing SOP sign-off",
  keyStrengths: "Strong leather capability; responsive sampling",
  recommendedNextSteps: "Complete IEC · trial order 1×40HQ with US buyer",
  evidence: "Shop floor photos + GST cert uploaded to vault",
};

/** Tooltips — why the field matters / how to fill */
export const TIP: Record<string, string> = {
  filledBy:
    "Ops = SNSPL enters from a paper/PDF response. Supplier = manufacturer fills directly. Same form either way.",
  reference:
    "Internal HUB ID for tracking. If blank, ops can assign later (e.g. HUB-2026-0142).",
  preparedBy: "Person completing this form today — SNSPL associate or factory contact.",
  legalName:
    "Exact legal name on GST/PAN/incorporation papers. Used on PI/PO and directory matching.",
  tradeName: "Brand name buyers may know if different from legal entity.",
  constitution: "Business structure affects export docs and contracting.",
  yearEstablished: "Year the manufacturing firm started (not brand launch).",
  registeredAddress: "Registered office as on GST / MCA records.",
  manufacturingAddresses:
    "Where goods are actually made. City helps geographic shortlisting.",
  facilityCount: "Count of plants that can produce the proposed category.",
  website: "Company site or catalogue PDF link — helps buyer diligence.",
  primaryContact: "Day-to-day person for RFQs, samples, and audits.",
  email: "Must be monitored — used for outreach and document chase.",
  phone: "Include country code. WhatsApp-capable numbers preferred.",
  turnover:
    "Approximate is fine. Used for size scoring, not credit approval.",
  yearsManufacturing: "Total years making goods (any category).",
  yearsInCategory:
    "Years in the proposed product family — critical for deal fit.",
  domesticMarkets: "Who buys you today in India — shows commercial maturity.",
  sqft: "Approximate sq. ft. is enough. Feeds infrastructure readiness score.",
  ownershipStatus: "Owned vs leased affects continuity risk for long programmes.",
  utilisationPct:
    "% of practical capacity in use now. High utilisation may limit new buyer volume.",
  spareCapacityPct: "Headroom for new export programmes without CapEx.",
  dedicatedAreas:
    "Controlled areas (quarantine, export staging) signal export discipline.",
  machines:
    "List main production equipment. Capacity/qty drives output scoring.",
  productionLines: "Distinct lines that can run buyer programmes in parallel.",
  output: "State unit (pcs/sets) and time basis so we can compare factories.",
  normalLeadTime:
    "Typical PO→ready time. Used directly in factory recommendation lead-day matching.",
  sampleLead: "Sample speed often decides buyer selection timelines.",
  workforce:
    "Headcount feeds size score. Note if peak labour is mostly temporary.",
  tempLabour:
    "Heavy daily-wage dependency can raise quality/continuity caution flags.",
  productCategory:
    "Use buyer language (e.g. leather toys, silicone mats). Powers deal↔factory matching.",
  materials: "Primary materials — matched against requirement materials field.",
  hsn: "HSN/HS if known — reference only; may be verified per destination.",
  productInfo: "Tick what you can send with an RFQ — speeds quoting.",
  packagingForm: "Finished vs component changes packing and Incoterm advice.",
  exportPackInfo: "Master-case CBM/weight is essential for container planning.",
  customPackaging: "Buyer-branded packs often need MOQ — say so clearly.",
  certifications:
    "ISO, BSCI, Sedex, GRS, etc. Missing certs become recommendation cautions.",
  qcCapabilities: "In-house QC vs third-party labs — quality score input.",
  auditWillingness: "Many US/EU buyers require audits before first order.",
  supplyMarkets:
    "First-time exporters are welcome — say Domestic only if that is true.",
  exportPath: "How goods reach overseas markets today (direct vs merchant).",
  yearsDirectExport: "Enter 0 if you have never exported under your own IEC.",
  exportDocs:
    "Available / Applied / N/A. IEC+GST are highest priority for export-ready class.",
  docRef: "PAN/GST/IEC numbers or application acknowledgement refs.",
  buyerRespond:
    "What your team can answer quickly — drives buyer-support readiness.",
  sampling: "Sampling capability is often the first buyer filter.",
  overseasSample: "Courier/sample cost willingness for overseas buyers.",
  english: "English commercial replies reduce SNSPL chase load.",
  moq: "Minimum order quantity per SKU/style — matched to buyer trial vs programme.",
  mov: "Minimum order value if you enforce one.",
  paymentTerms: "Terms you normally accept (e.g. 30/70 TT). Flag if TT90 is hard.",
  incoterms: "FOB / EXW / CIF previously used — guides quote format.",
  exportGateway: "Nearest ICD/port you ship from.",
  orderTypes: "Trial and small orders matter for first buyer introductions.",
  commercialConstraints:
    "Anything SNSPL must know before introducing a buyer (credit, seasons, exclusivity).",
  assessment:
    "Auto-scored from your answers. SNSPL can override any dimension before submit.",
  declaration:
    "Required to submit. Confirms accuracy; HUB listing is not an order guarantee.",
};

function setErr(errors: FieldErrors, key: string, msg?: string) {
  if (msg) errors[key] = msg;
}

export function validateOnboardingStep(
  stepId: OnboardingStepId,
  app: SupplierHubApplication,
): FieldErrors {
  const errors: FieldErrors = {};

  if (stepId === "meta") {
    if (app.filledBy === "ops") {
      setErr(errors, "preparedBy", requireText(app.preparedBy, "Prepared by"));
    }
  }

  if (stepId === "company") {
    const c = app.company;
    setErr(errors, "legalName", requireText(c.legalName, "Legal company name"));
    setErr(errors, "email", optionalEmail(c.email));
    setErr(errors, "phone", optionalPhone(c.phone || c.whatsapp));
    if (!trim(c.email) && !trim(c.phone) && !trim(c.whatsapp)) {
      errors.email = "Provide email or phone so we can reach the factory";
      errors.phone = "Provide email or phone so we can reach the factory";
    }
    setErr(errors, "website", optionalUrl(c.website));
    setErr(errors, "yearEstablished", optionalYear(c.yearEstablished));
    setErr(
      errors,
      "yearsManufacturing",
      optionalPositiveNumber(c.yearsManufacturing, "e.g. 18"),
    );
    setErr(
      errors,
      "yearsInCategory",
      optionalPositiveNumber(c.yearsInCategory, "e.g. 12"),
    );
    if (!trim(c.primaryContact)) {
      errors.primaryContact = "Primary contact name is required";
    }
  }

  if (stepId === "infrastructure") {
    const i = app.infrastructure;
    const sqftKeys = [
      "totalPremisesSqft",
      "builtUpSqft",
      "productionSqft",
      "rmStorageSqft",
      "wipStorageSqft",
      "fgWarehouseSqft",
      "packingSqft",
      "qcSqft",
      "labSqft",
      "dispatchSqft",
    ] as const;
    for (const k of sqftKeys) {
      setErr(errors, k, optionalPositiveNumber(i[k], "e.g. 18000"));
    }
    setErr(errors, "utilisationPct", optionalPct(i.utilisationPct));
    setErr(errors, "spareCapacityPct", optionalPct(i.spareCapacityPct));
    setErr(
      errors,
      "shiftsPerDay",
      optionalPositiveNumber(i.shiftsPerDay, "e.g. 2"),
    );
    if (!trim(i.productionSqft) && !trim(i.totalPremisesSqft)) {
      errors.productionSqft =
        "Enter at least total premises or production shop-floor area";
    }
  }

  if (stepId === "capacity") {
    const c = app.capacity;
    const named = c.machines.filter((m) => trim(m.name)).length;
    if (named === 0) {
      errors.machines = "List at least one principal machine / equipment";
    }
    c.machines.forEach((m, idx) => {
      if (trim(m.name) && trim(m.year)) {
        setErr(errors, `machineYear-${idx}`, optionalYear(m.year));
      }
      if (trim(m.name) && trim(m.qty)) {
        setErr(
          errors,
          `machineQty-${idx}`,
          optionalPositiveNumber(m.qty, "e.g. 4"),
        );
      }
    });
    setErr(errors, "normalLeadTime", optionalLead(c.normalLeadTime));
    if (!trim(c.normalLeadTime)) {
      errors.normalLeadTime =
        "Normal production lead time is required for deal matching";
    }
    setErr(errors, "sampleLeadExisting", optionalLead(c.sampleLeadExisting));
    setErr(errors, "sampleLeadNew", optionalLead(c.sampleLeadNew));
    setErr(errors, "capacityUtilisationPct", optionalPct(c.capacityUtilisationPct));
  }

  if (stepId === "workforce") {
    const w = app.workforce;
    (
      [
        "permanentProduction",
        "permanentQuality",
        "packingWarehouse",
        "maintenance",
        "supervisory",
        "temporary",
        "avgPresentDay",
      ] as const
    ).forEach((k) => {
      setErr(errors, k, optionalPositiveNumber(w[k], "e.g. 85"));
    });
    if (!trim(w.permanentProduction) && !trim(w.avgPresentDay)) {
      errors.permanentProduction =
        "Enter permanent production headcount or average present per day";
    }
  }

  if (stepId === "products") {
    const families = app.products.families;
    const valid = families.filter((f) => trim(f.name) && trim(f.category));
    if (valid.length === 0) {
      errors.products =
        "Add at least one product with both name and category (e.g. leather toys)";
    }
    families.forEach((f, idx) => {
      if (trim(f.name) && !trim(f.category)) {
        errors[`productCategory-${idx}`] = "Category is required when name is set";
      }
      if (trim(f.category) && !trim(f.name)) {
        errors[`productName-${idx}`] = "Product name is required when category is set";
      }
    });
  }

  if (stepId === "packaging") {
    if (!trim(app.packaging.productForm)) {
      errors.productForm = "Select how the product is offered (finished / component / bulk)";
    }
  }

  if (stepId === "quality") {
    if (!trim(app.quality.auditWillingness)) {
      errors.auditWillingness =
        "Select audit willingness — buyers often require factory audits";
    }
  }

  if (stepId === "market") {
    if (!(app.market.supplyMarkets?.length)) {
      errors.supplyMarkets = "Select at least one current supply market";
    }
    setErr(
      errors,
      "yearsDirectExport",
      optionalPositiveNumber(app.market.yearsDirectExport, "e.g. 0 or 5"),
    );
  }

  if (stepId === "exportDocs") {
    const d = app.exportDocs;
    if (!d.gst) errors.gst = "Select GST status (Available / Applied / N/A)";
    if (!d.pan) errors.pan = "Select PAN status";
    if (!d.iec) {
      errors.iec =
        "Select IEC status — first-time exporters can choose Applied or N/A";
    }
  }

  if (stepId === "buyerSupport") {
    if (!(app.buyerSupport.canRespondTo?.length)) {
      errors.canRespondTo = "Select at least one query type your team can handle";
    }
    if (!trim(app.buyerSupport.englishCommunication)) {
      errors.englishCommunication = "Select English communication capability";
    }
  }

  if (stepId === "commercial") {
    const c = app.commercial;
    if (!trim(c.moq)) errors.moq = "MOQ is required for deal matching";
    if (!trim(c.paymentTerms)) {
      errors.paymentTerms = "Payment terms normally accepted are required";
    }
    setErr(errors, "repeatLeadTime", optionalLead(c.repeatLeadTime));
    setErr(errors, "firstOrderLeadTime", optionalLead(c.firstOrderLeadTime));
  }

  if (stepId === "assessment") {
    if (!app.declaration.confirmed) {
      errors.declaration = "Confirm the manufacturer declaration to submit";
    }
    setErr(
      errors,
      "authorisedName",
      requireText(app.declaration.authorisedName, "Authorised person name"),
    );
    app.assessment.dimensions.forEach((dim, idx) => {
      if (dim.score < 0 || dim.score > 100 || Number.isNaN(dim.score)) {
        errors[`dimScore-${idx}`] = "Score must be between 0 and 100";
      }
    });
    if (!app.assessment.classification) {
      errors.classification = "Select or re-suggest a readiness classification";
    }
  }

  return errors;
}

export function firstErrorMessage(errors: FieldErrors): string | undefined {
  return Object.values(errors)[0];
}
