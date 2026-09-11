/**
 * Seeded multi-deal book of business for Command Center.
 * Stable IDs keep reseeding idempotent. Every deal carries source messages
 * and openable attachments for audit provenance.
 */
import type {
  Deal,
  DealDocument,
  DealStage,
  DocumentType,
  Party,
  SourceAttachment,
  SourceMessage,
} from "@/types/trade";
import {
  GOLDEN_BOOKING,
  GOLDEN_CBM,
  GOLDEN_COMMISSION,
  GOLDEN_DOCS,
  GOLDEN_PAYMENT,
  GOLDEN_PI,
  GOLDEN_PO,
  GOLDEN_PRODUCTION,
  GOLDEN_QUOTE,
  GOLDEN_REQUIREMENT,
} from "./golden";
import { buildShowcaseDeal } from "./showcaseDeal";
import { SEEDED_DEAL_CODES } from "./dealCode";
import { PETRAGEOUS_FIXTURE_EMAIL } from "./fixtures";
import {
  ARTWORK_APPROVAL_EMAIL,
  BARKTRUNK_QUOTE_EMAIL,
  BOOKING_CUTOFF_EMAIL,
  COMMISSION_EMAIL,
  FINANCE_LIQUIDITY_EMAIL,
  GLOBAL_PRAISE_SELECTION_EMAIL,
  PAYMENT_CLOCK_EMAIL,
  PI_PO_ALIGN_EMAIL,
  PRODUCTION_STATUS_EMAIL,
  QUOTE_AS_SHEET_EMAIL,
  SAMPLE_DISPATCH_EMAIL,
  SAMPLE_PATHS,
  SHIPMENT_IN_WATERS_EMAIL,
} from "./fixtureEmails";
import { SEEDED_ECONOMICS } from "./portfolioEconomicsSeed";
import { SEEDED_CASH } from "./portfolioCashSeed";
import { SEEDED_PAYMENT_SCHEDULES } from "./portfolioPaymentScheduleSeed";
import { parseEmailMeta } from "./partyProfiles";
import {
  fileNameFromSamplePath,
  sampleOpenUrl,
} from "./sampleFiles";

const AGENCY: Party = {
  role: "agency",
  name: "Swinder Juneja",
  company: "Savvy Net Sourcing",
  email: "swinder@snspl.in",
};

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function att(
  samplePath: string,
  opts?: {
    name?: string;
    extractedBy?: string;
    extractedSummary?: string;
  },
): SourceAttachment {
  const name = opts?.name || fileNameFromSamplePath(samplePath);
  return {
    name,
    samplePath,
    url: sampleOpenUrl(samplePath),
    extractedBy: opts?.extractedBy,
    extractedSummary: opts?.extractedSummary,
  };
}

function vaultDoc(
  samplePath: string,
  type: DocumentType,
  opts?: { extractedBy?: string; extractedSummary?: string; id?: string },
): DealDocument {
  const name = fileNameFromSamplePath(samplePath);
  return {
    id: opts?.id || `doc-${type}-${name}`,
    name,
    type,
    samplePath,
    url: sampleOpenUrl(samplePath),
    uploadedAt: daysAgo(10),
    extractedBy: opts?.extractedBy,
    extractedSummary: opts?.extractedSummary,
  };
}

function sourceFromEmail(
  kind: SourceMessage["kind"],
  body: string,
  receivedDaysAgo: number,
  opts?: {
    id?: string;
    label?: string;
    attachments?: SourceAttachment[];
    extractedBy?: string;
    extractedSummary?: string;
  },
): SourceMessage {
  const meta = parseEmailMeta(body);
  return {
    id: opts?.id || `src-${kind}-${receivedDaysAgo}`,
    kind,
    body,
    label: opts?.label,
    subject: meta.subject,
    from: meta.from,
    to: meta.to,
    receivedAt: daysAgo(receivedDaysAgo),
    attachments: opts?.attachments || [],
    extractedBy: opts?.extractedBy,
    extractedSummary: opts?.extractedSummary,
  };
}

function baseDeal(
  id: string,
  title: string,
  stage: DealStage,
  daysOld: number,
  extras: Partial<Deal>,
): Deal {
  const created = daysAgo(daysOld);
  const updated = extras.updatedAt || daysAgo(Math.min(daysOld, 3));
  return {
    id,
    code: SEEDED_DEAL_CODES[id] || extras.code || id,
    title,
    stage,
    createdAt: extras.createdAt || created,
    updatedAt: updated,
    parties: extras.parties || [AGENCY],
    documents: extras.documents || [],
    sources: extras.sources || [],
    timeline: extras.timeline?.length
      ? extras.timeline
      : [
          {
            id: `${id}-t0`,
            at: created,
            channel: "portal",
            title: "Deal opened",
          },
        ],
    outreach: extras.outreach || [],
    showcase: extras.showcase,
    portfolioSeed: true,
    requirement: extras.requirement,
    quote: extras.quote,
    selectionLocked: extras.selectionLocked,
    artwork: extras.artwork,
    samples: extras.samples,
    pi: extras.pi,
    po: extras.po,
    discrepancy: extras.discrepancy,
    upcMatch: extras.upcMatch,
    packaging: extras.packaging,
    inspection: extras.inspection,
    production: extras.production,
    booking: extras.booking,
    cbm: extras.cbm,
    docsPack: extras.docsPack,
    payment: extras.payment,
    commission: extras.commission,
    recommendedFactoryIds: extras.recommendedFactoryIds,
  };
}

/** Stable portfolio deal IDs — do not change (idempotent seed). */
export const BOOK_OF_BUSINESS_IDS = [
  "bob-showcase-petrageous",
  "bob-loving-pets-discrepancy",
  "bob-neater-artwork",
  "bob-swastik-production",
  "bob-global-praise-selection",
  "bob-barktrunk-quoting",
  "bob-yk-booking-cutoff",
  "bob-closed-commission",
] as const;

export function buildBookOfBusiness(): Deal[] {
  const showcasePartial = buildShowcaseDeal();
  const showcaseDocs: DealDocument[] = (
    showcasePartial.documents || []
  ).map((d, i) => ({
    ...d,
    id: `bob-showcase-doc-${i}`,
    uploadedAt: daysAgo(20 - i),
    url: d.samplePath ? sampleOpenUrl(d.samplePath) : d.url,
    extractedBy: d.extractedBy,
    extractedSummary: d.extractedSummary,
  }));

  const showcase: Deal = {
    id: "bob-showcase-petrageous",
    code: SEEDED_DEAL_CODES["bob-showcase-petrageous"],
    title: "Petrageous leather toys — Mundra sailing",
    stage: showcasePartial.stage || "docs_payment",
    createdAt: daysAgo(45),
    updatedAt: daysAgo(2),
    parties: showcasePartial.parties || [AGENCY],
    documents: showcaseDocs,
    sources: [
      sourceFromEmail("requirement", PETRAGEOUS_FIXTURE_EMAIL, 45, {
        label: "Buyer enquiry",
        extractedBy: "requirement_extractor",
        extractedSummary:
          "Leather/suede toys · retail ~$4.99 · factory <$1.00 · Ethical as current source",
      }),
      sourceFromEmail("quote", QUOTE_AS_SHEET_EMAIL, 35, {
        label: "Factory AS sheet email",
        attachments: [
          att(SAMPLE_PATHS.asSheet, {
            extractedBy: "quote_normalizer",
            extractedSummary: "FOB matrix · Raccoon/Moose/Bear · MOQ 1000",
          }),
        ],
        extractedBy: "quote_normalizer",
        extractedSummary: "Normalized SKU quote matrix from AS LEATHER TOYS sheet",
      }),
      sourceFromEmail("pi", QUOTE_AS_SHEET_EMAIL.replace("AS Leather Toys", "Petrageous PI-17"), 22, {
        id: "src-pi-petrageous",
        label: "Petrageous PI pack",
        attachments: [
          att(SAMPLE_PATHS.piPetrageous, {
            extractedBy: "pi_extractor",
            extractedSummary: "PI-17 commercial lines + totals",
          }),
        ],
        extractedBy: "pi_extractor",
        extractedSummary: "Proforma invoice fields locked for discrepancy check",
      }),
      sourceFromEmail("booking", BOOKING_CUTOFF_EMAIL, 8, {
        label: "Booking confirmation",
        attachments: [
          att(SAMPLE_PATHS.booking, {
            extractedBy: "booking_extractor",
            extractedSummary: "EID0949971 · SI/CY cut-offs · Mundra ETD",
          }),
          att(SAMPLE_PATHS.cbm, {
            extractedBy: "cbm_container_planner",
            extractedSummary: "40FT CBM finals · Y.K. qty",
          }),
        ],
        extractedBy: "booking_extractor",
        extractedSummary: "Booking held with cut-off calendar",
      }),
      sourceFromEmail("payment", PAYMENT_CLOCK_EMAIL, 5, {
        label: "Payment clock",
        attachments: [
          att(SAMPLE_PATHS.surrender, {
            extractedBy: "payment_clock",
            extractedSummary: "BL / surrender shared · T/T 30-day clock",
          }),
          att(SAMPLE_PATHS.packingList, {
            extractedBy: "final_docs_pack_check",
            extractedSummary: "Packing list present in docs pack",
          }),
        ],
        extractedBy: "payment_clock",
        extractedSummary: "Payment due clock started from BL shared date",
      }),
    ],
    timeline: (showcasePartial.timeline || []).map((e, i) => ({
      ...e,
      id: e.id || `bob-showcase-t-${i}`,
    })),
    outreach: (showcasePartial.outreach || []).map((o, i) => ({
      ...o,
      id: o.id || `bob-showcase-o-${i}`,
    })),
    showcase: true,
    portfolioSeed: true,
    recommendedFactoryIds: ["factory-yk", "factory-v3f", "factory-ethical"],
    requirement: showcasePartial.requirement,
    quote: showcasePartial.quote,
    selectionLocked: showcasePartial.selectionLocked,
    artwork: showcasePartial.artwork,
    samples: showcasePartial.samples,
    pi: showcasePartial.pi,
    po: showcasePartial.po,
    discrepancy: showcasePartial.discrepancy,
    upcMatch: showcasePartial.upcMatch,
    packaging: showcasePartial.packaging,
    inspection: showcasePartial.inspection,
    production: showcasePartial.production,
    booking: showcasePartial.booking,
    cbm: showcasePartial.cbm,
    docsPack: showcasePartial.docsPack,
    payment: showcasePartial.payment,
    commission: showcasePartial.commission,
  };

  return [
    showcase,

    baseDeal(
      "bob-loving-pets-discrepancy",
      "Loving Pets · Swastik PO 14682 — PI/PO mismatch",
      "pi_po",
      28,
      {
        parties: [
          AGENCY,
          {
            role: "buyer",
            name: "Buying Team",
            company: "Loving Pets",
          },
          {
            role: "factory",
            name: "Swastik Industries",
            company: "Swastik Industries",
          },
        ],
        requirement: {
          ...GOLDEN_REQUIREMENT,
          productCategory: "Pet accessories / mats",
          buyerCompany: "Loving Pets",
          summary: "Loving Pets PO 14682 with Swastik — commercial lock pending.",
          urgency: "high",
        },
        documents: [
          vaultDoc(SAMPLE_PATHS.piSwastik, "pi", {
            id: "bob-lp-pi",
            extractedBy: "pi_extractor",
            extractedSummary: "PI-LP-14682 · $18,500 total",
          }),
          vaultDoc(SAMPLE_PATHS.po14682, "po", {
            id: "bob-lp-po",
            extractedBy: "po_extractor",
            extractedSummary: "PO 14682 · $17,200 total",
          }),
        ],
        sources: [
          sourceFromEmail("requirement", PI_PO_ALIGN_EMAIL, 28, {
            label: "Buyer PO align request",
            attachments: [
              att(SAMPLE_PATHS.po14682, {
                extractedBy: "po_extractor",
                extractedSummary: "PO lines · qty · payment terms",
              }),
            ],
            extractedBy: "requirement_extractor",
            extractedSummary: "Align PI to PO 14682 · FOB Mundra",
          }),
          sourceFromEmail("pi", PRODUCTION_STATUS_EMAIL, 6, {
            label: "Factory PI / status thread",
            attachments: [
              att(SAMPLE_PATHS.piSwastik, {
                extractedBy: "pi_extractor",
                extractedSummary: "Swastik performa totals vs PO",
              }),
            ],
            extractedBy: "pi_po_discrepancy",
            extractedSummary:
              "Critical $1,300 amount gap + qty mismatch on E26842",
          }),
        ],
        recommendedFactoryIds: ["factory-swastik", "factory-yk"],
        pi: {
          ...GOLDEN_PI,
          docNumber: "PI-LP-14682",
          totalAmount: 18500,
          buyer: "Loving Pets",
          factory: "Swastik Industries",
        },
        po: {
          ...GOLDEN_PO,
          docNumber: "14682",
          totalAmount: 17200,
          buyer: "Loving Pets",
          factory: "Swastik Industries",
        },
        discrepancy: {
          mismatches: [
            {
              field: "totalAmount",
              piValue: "18500",
              poValue: "17200",
              severity: "critical",
              note: "$1,300 gap — do not lock until clarified",
            },
            {
              field: "qty E26842",
              piValue: "6000",
              poValue: "5000",
              severity: "critical",
            },
            {
              field: "paymentTerms",
              piValue: "T/T against B/L",
              poValue: "30% advance",
              severity: "warning",
            },
          ],
          aligned: false,
          summary:
            "Critical qty/amount mismatches between Swastik PI and Loving Pets PO 14682.",
          confidence: 0.93,
        },
        timeline: [
          {
            id: "bob-lp-t1",
            at: daysAgo(5),
            channel: "email",
            title: "PI vs PO discrepancy flagged",
            detail: "Critical amount and qty gaps",
          },
          {
            id: "bob-lp-t0",
            at: daysAgo(28),
            channel: "portal",
            title: "Deal opened",
          },
        ],
      },
    ),

    baseDeal(
      "bob-neater-artwork",
      "Neater Pets · Mat artwork changes requested",
      "artwork",
      18,
      {
        parties: [
          AGENCY,
          {
            role: "buyer",
            name: "Merch",
            company: "Neater Pets / Tower Star",
          },
        ],
        requirement: {
          productCategory: "Silicone lick mats",
          buyerCompany: "Neater Pets",
          urgency: "normal",
          summary: "Neater Mat India pack artwork cycle.",
        },
        selectionLocked: true,
        quote: {
          factoryName: "Y.K. Industries",
          currency: "USD",
          skus: [
            {
              itemCode: "NM-6x4",
              description: "Neater Mat 6x4",
              unitPrice: 2.1,
              selected: true,
            },
          ],
        },
        artwork: {
          items: [
            {
              asset: "Front insert 6x4 India",
              status: "changes_requested",
              notes: "Buyer asked for font size +1pt",
            },
            {
              asset: "Back barcode placement",
              status: "missing",
            },
            {
              asset: "Master carton print",
              status: "pending",
            },
          ],
          summary:
            "Buyer requested artwork changes; barcode placement still missing.",
          confidence: 0.9,
        },
        documents: [
          vaultDoc(SAMPLE_PATHS.artworkMat, "artwork", {
            id: "bob-ne-art1",
            extractedBy: "artwork_checklist_extractor",
            extractedSummary: "India 6x4 insert — changes requested",
          }),
          vaultDoc(SAMPLE_PATHS.artworkLik, "artwork", {
            id: "bob-ne-art2",
            extractedBy: "artwork_checklist_extractor",
            extractedSummary: "Neat-Lik Express 5x7 pack",
          }),
          vaultDoc(SAMPLE_PATHS.barcodeArt, "barcode", {
            id: "bob-ne-bc",
            extractedBy: "upc_barcode_matcher",
            extractedSummary: "Barcode art pending placement confirmation",
          }),
          vaultDoc(SAMPLE_PATHS.upcMaster, "upc", {
            id: "bob-ne-upc",
            extractedBy: "upc_barcode_matcher",
            extractedSummary: "Item number ↔ UPC master",
          }),
        ],
        sources: [
          sourceFromEmail("artwork", ARTWORK_APPROVAL_EMAIL, 9, {
            label: "Artwork pack",
            attachments: [
              att(SAMPLE_PATHS.artworkMat, {
                extractedBy: "artwork_checklist_extractor",
                extractedSummary: "Front/back insert status: changes_requested",
              }),
              att(SAMPLE_PATHS.artworkLik, {
                extractedBy: "artwork_checklist_extractor",
                extractedSummary: "Fun lick mat pack awaiting markup",
              }),
              att(SAMPLE_PATHS.barcodeArt, {
                extractedBy: "upc_barcode_matcher",
                extractedSummary: "Barcode placement still missing on back",
              }),
              att(SAMPLE_PATHS.neaterSpecs, {
                extractedBy: "artwork_checklist_extractor",
                extractedSummary: "PO 20719 specs pack referenced",
              }),
            ],
            extractedBy: "artwork_checklist_extractor",
            extractedSummary:
              "3 assets tracked · changes + missing barcode placement",
          }),
        ],
        recommendedFactoryIds: ["factory-yk", "factory-swastik"],
        updatedAt: daysAgo(9),
        timeline: [
          {
            id: "bob-ne-t1",
            at: daysAgo(9),
            channel: "email",
            title: "Artwork changes requested",
            detail: "Font + barcode placement",
          },
        ],
      },
    ),

    baseDeal(
      "bob-swastik-production",
      "Swastik · Production blockers (materials delay)",
      "production",
      55,
      {
        parties: [
          AGENCY,
          {
            role: "factory",
            name: "Production",
            company: "Swastik Industries",
          },
          {
            role: "buyer",
            name: "Ops",
            company: "Loving Pets",
          },
        ],
        requirement: {
          productCategory: "Leather toys refill",
          buyerCompany: "Loving Pets",
          urgency: "high",
          targetFactoryCost: 0.95,
        },
        selectionLocked: true,
        quote: GOLDEN_QUOTE,
        pi: GOLDEN_PI,
        po: GOLDEN_PO,
        production: {
          readyDate: "2026-09-20",
          percentComplete: 55,
          blockers: [
            "Suede lot delayed from tannery (ETA +10 days)",
            "Awaiting revised carton artwork approval",
          ],
          summary: "55% complete; tannery suede delay pushing ready date.",
          confidence: 0.88,
        },
        documents: [
          vaultDoc(SAMPLE_PATHS.inspection, "inspection", {
            id: "bob-sw-insp",
            extractedBy: "inspection_photo_summarizer",
            extractedSummary: "Inspection photos pack PO-20719 pattern",
          }),
          vaultDoc(SAMPLE_PATHS.po14682, "po", {
            id: "bob-sw-po",
            extractedBy: "po_extractor",
          }),
          vaultDoc(SAMPLE_PATHS.packaging, "packaging", {
            id: "bob-sw-pkg",
            extractedBy: "packaging_photo_checklist",
          }),
        ],
        sources: [
          sourceFromEmail("production", PRODUCTION_STATUS_EMAIL, 12, {
            label: "Factory production update",
            attachments: [
              att(SAMPLE_PATHS.inspection, {
                extractedBy: "inspection_photo_summarizer",
                extractedSummary: "Photo evidence pack on file",
              }),
            ],
            extractedBy: "production_status_extractor",
            extractedSummary: "~55–85% · blockers: suede delay + carton art",
          }),
          sourceFromEmail("samples", SAMPLE_DISPATCH_EMAIL, 30, {
            label: "Sample dispatch",
            attachments: [
              att(SAMPLE_PATHS.asSheet, {
                extractedBy: "sample_request_summarizer",
                extractedSummary: "SKU refs E26842/43/44 from AS sheet",
              }),
            ],
            extractedBy: "sample_request_summarizer",
            extractedSummary: "DHL AWB 1234567890 · ETA 5–7 days",
          }),
        ],
        recommendedFactoryIds: ["factory-swastik"],
        inspection: undefined,
        updatedAt: daysAgo(12),
        timeline: [
          {
            id: "bob-sw-t1",
            at: daysAgo(12),
            channel: "whatsapp",
            title: "Factory reported material delay",
            detail: "Suede lot +10 days",
          },
        ],
      },
    ),

    baseDeal(
      "bob-global-praise-selection",
      "Global Praise · Buyer selection pending",
      "selection",
      14,
      {
        parties: [
          AGENCY,
          {
            role: "buyer",
            name: "Buyer desk",
            company: "Global Praise",
          },
          {
            role: "factory",
            name: "Yash",
            company: "Y.K. Industries",
          },
        ],
        requirement: {
          productCategory: "Plush / soft toys",
          buyerCompany: "Global Praise",
          urgency: "normal",
          destination: "USA",
          summary: "AS sheet shared; waiting on buyer SKU picks.",
          nextActions: ["Chase buyer selection on WhatsApp"],
        },
        quote: {
          ...GOLDEN_QUOTE,
          factoryName: "Y.K. Industries",
          skus: GOLDEN_QUOTE.skus.map((s) => ({ ...s, selected: false })),
        },
        selectionLocked: false,
        documents: [
          vaultDoc(SAMPLE_PATHS.asSheet, "quote", {
            id: "bob-gp-as",
            extractedBy: "quote_normalizer",
            extractedSummary: "AS sheet → quote matrix (selection open)",
          }),
        ],
        sources: [
          sourceFromEmail("quote", QUOTE_AS_SHEET_EMAIL, 12, {
            label: "Factory quote pack",
            attachments: [
              att(SAMPLE_PATHS.asSheet, {
                extractedBy: "quote_normalizer",
                extractedSummary: "4 SKUs normalized · none selected yet",
              }),
            ],
            extractedBy: "quote_normalizer",
            extractedSummary: "Quote matrix ready for buyer selection",
          }),
          sourceFromEmail(
            "requirement",
            GLOBAL_PRAISE_SELECTION_EMAIL,
            6,
            {
              label: "Buyer holding picks",
              extractedBy: "requirement_extractor",
              extractedSummary: "Buyer reviewing SKUs · hold MOQ",
            },
          ),
        ],
        updatedAt: daysAgo(6),
        outreach: [
          {
            id: "bob-gp-o1",
            factoryName: "Y.K. Industries",
            channel: "whatsapp",
            status: "QuotePromised",
            enrolledAt: daysAgo(12),
            disposition: "QuotePromised",
          },
        ],
        timeline: [
          {
            id: "bob-gp-t1",
            at: daysAgo(6),
            channel: "email",
            title: "Quote matrix sent to buyer",
            detail: "4 SKUs awaiting selection",
          },
        ],
      },
    ),

    baseDeal(
      "bob-barktrunk-quoting",
      "Barktrunk / V3F · Healthy quote cycle",
      "quoting",
      8,
      {
        parties: [
          AGENCY,
          {
            role: "factory",
            name: "V Three Fortunes",
            company: "Barktrunk / V Three Fortunes",
          },
          {
            role: "buyer",
            name: "Gretchen George",
            company: "Petrageous Designs",
          },
        ],
        requirement: {
          ...GOLDEN_REQUIREMENT,
          productCategory: "Leather toys — Barktrunk lane",
          urgency: "low",
          summary: "Parallel factory quote; no blockers.",
        },
        quote: {
          factoryName: "V Three Fortunes",
          currency: "USD",
          confidence: 0.85,
          skus: [
            {
              itemCode: "BT-101",
              description: "Leather bone toy",
              unitPrice: 0.92,
              moq: 1000,
              currency: "USD",
            },
            {
              itemCode: "BT-102",
              description: "Leather ring tug",
              unitPrice: 0.88,
              moq: 1000,
              currency: "USD",
            },
          ],
        },
        documents: [
          vaultDoc(SAMPLE_PATHS.packingList, "packing_list", {
            id: "bob-bt-pl",
            extractedBy: "quote_normalizer",
            extractedSummary: "V3F packing list reference",
          }),
          vaultDoc(SAMPLE_PATHS.asSheet, "quote", {
            id: "bob-bt-as",
            extractedBy: "quote_normalizer",
            extractedSummary: "Parallel AS format quote",
          }),
        ],
        sources: [
          sourceFromEmail("requirement", PETRAGEOUS_FIXTURE_EMAIL, 8, {
            label: "Buyer RFQ (parallel lane)",
            extractedBy: "requirement_extractor",
            extractedSummary: "Leather toys · <$1 factory · Barktrunk lane",
          }),
          sourceFromEmail("quote", BARKTRUNK_QUOTE_EMAIL, 1, {
            label: "V3F quote pack",
            attachments: [
              att(SAMPLE_PATHS.asSheet, {
                extractedBy: "quote_normalizer",
                extractedSummary: "BT-101 $0.92 · BT-102 $0.88 · MOQ 1000",
              }),
              att(SAMPLE_PATHS.packingList, {
                extractedBy: "quote_normalizer",
                extractedSummary: "Factory packing list V3F pattern",
              }),
            ],
            extractedBy: "quote_normalizer",
            extractedSummary: "2 SKUs normalized · healthy quote cycle",
          }),
        ],
        updatedAt: daysAgo(1),
        timeline: [
          {
            id: "bob-bt-t1",
            at: daysAgo(1),
            channel: "portal",
            title: "Quote matrix normalized",
            detail: "2 SKUs from V Three Fortunes",
          },
        ],
      },
    ),

    baseDeal(
      "bob-yk-booking-cutoff",
      "Y.K. · Booking cut-off this week",
      "booking",
      40,
      {
        parties: [
          AGENCY,
          {
            role: "factory",
            name: "Yash",
            company: "Y.K. Industries",
          },
          {
            role: "forwarder",
            name: "Skyline Freight",
            company: "Skyline Freight & Travels",
          },
        ],
        requirement: {
          productCategory: "Leather toys sailing",
          buyerCompany: "Petrageous Designs",
          urgency: "high",
        },
        selectionLocked: true,
        quote: GOLDEN_QUOTE,
        production: {
          ...GOLDEN_PRODUCTION,
          percentComplete: 100,
          blockers: [],
          summary: "Cargo ready; awaiting cut-off confirmation.",
        },
        booking: {
          ...GOLDEN_BOOKING,
          cutOffs: "SI cut-off tomorrow 17:00 IST; CY cut-off in 3 days",
          etd: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
          summary: "Booking held — SI cut-off tomorrow; confirm docs today.",
        },
        cbm: GOLDEN_CBM,
        documents: [
          vaultDoc(SAMPLE_PATHS.booking, "booking", {
            id: "bob-yk-bkg",
            extractedBy: "booking_extractor",
            extractedSummary: "EID0949971 confirmation",
          }),
          vaultDoc(SAMPLE_PATHS.cbm, "cbm", {
            id: "bob-yk-cbm",
            extractedBy: "cbm_container_planner",
            extractedSummary: "YK toys CBM sheet · 40FT",
          }),
          vaultDoc(SAMPLE_PATHS.piPetrageous18, "pi", {
            id: "bob-yk-pi",
            extractedBy: "pi_extractor",
          }),
        ],
        sources: [
          sourceFromEmail("booking", BOOKING_CUTOFF_EMAIL, 1, {
            label: "Forwarder cut-off alert",
            attachments: [
              att(SAMPLE_PATHS.booking, {
                extractedBy: "booking_extractor",
                extractedSummary: "SI tomorrow 17:00 IST · CY +3 days",
              }),
              att(SAMPLE_PATHS.cbm, {
                extractedBy: "cbm_container_planner",
                extractedSummary: "Final qty CBM for sailing",
              }),
            ],
            extractedBy: "booking_extractor",
            extractedSummary: "Cut-off calendar extracted · action today",
          }),
          sourceFromEmail("production", PRODUCTION_STATUS_EMAIL, 10, {
            label: "Cargo ready note",
            extractedBy: "production_status_extractor",
            extractedSummary: "Production 100% · ready for booking",
          }),
        ],
        updatedAt: daysAgo(1),
        timeline: [
          {
            id: "bob-yk-t1",
            at: daysAgo(1),
            channel: "email",
            title: "Forwarder flagged SI cut-off",
            detail: "Tomorrow 17:00 IST",
          },
        ],
      },
    ),

    baseDeal(
      "bob-closed-commission",
      "Neater · Closed — commission invoice open",
      "closed",
      90,
      {
        parties: [
          AGENCY,
          {
            role: "buyer",
            name: "Accounts",
            company: "Neater Pets",
          },
        ],
        requirement: {
          productCategory: "Neat-Lik Express",
          buyerCompany: "Neater Pets",
          urgency: "low",
        },
        docsPack: {
          ...GOLDEN_DOCS,
          present: [
            "Commercial Invoice",
            "Packing List",
            "Bill of Lading",
            "Certificate of Origin",
          ],
          missing: [],
          complete: true,
          summary: "Full docs pack archived.",
        },
        payment: {
          ...GOLDEN_PAYMENT,
          status: "paid",
          daysRemaining: 0,
          summary: "Buyer paid factory; release done.",
        },
        commission: {
          ...GOLDEN_COMMISSION,
          items: [
            { item: "Buyer paid factory", done: true },
            { item: "FX rate confirmed by accounts", done: true },
            { item: "Commission invoice issued", done: false },
            { item: "Payment advice received", done: false },
            { item: "Deal marked closed", done: true },
          ],
          complete: false,
          summary: "Deal closed operationally; commission invoice still open.",
        },
        documents: [
          vaultDoc(SAMPLE_PATHS.packaging, "packaging", {
            id: "bob-cl-pkg",
            extractedBy: "final_docs_pack_check",
          }),
          vaultDoc(SAMPLE_PATHS.packingList, "packing_list", {
            id: "bob-cl-pl",
            extractedBy: "final_docs_pack_check",
          }),
          vaultDoc(SAMPLE_PATHS.surrender, "bl", {
            id: "bob-cl-bl",
            extractedBy: "payment_clock",
            extractedSummary: "Surrender / BL archived",
          }),
          vaultDoc(SAMPLE_PATHS.neatLikUpc, "upc", {
            id: "bob-cl-upc",
            extractedBy: "upc_barcode_matcher",
          }),
        ],
        sources: [
          sourceFromEmail("commission", COMMISSION_EMAIL, 4, {
            label: "Commission close checklist",
            attachments: [
              att(SAMPLE_PATHS.surrender, {
                extractedBy: "commission_checklist",
                extractedSummary: "Payment confirmation artefact on file",
              }),
            ],
            extractedBy: "commission_checklist",
            extractedSummary:
              "FX 83.25 · invoice still open · payment advice outstanding",
          }),
          sourceFromEmail("payment", PAYMENT_CLOCK_EMAIL, 20, {
            label: "Payment received archive",
            attachments: [
              att(SAMPLE_PATHS.packingList, {
                extractedBy: "final_docs_pack_check",
                extractedSummary: "Docs pack complete",
              }),
              att(SAMPLE_PATHS.packaging, {
                extractedBy: "packaging_photo_checklist",
              }),
            ],
            extractedBy: "payment_clock",
            extractedSummary: "Buyer paid · clock closed",
          }),
          sourceFromEmail("artwork", ARTWORK_APPROVAL_EMAIL, 60, {
            label: "Historical artwork (archived)",
            attachments: [
              att(SAMPLE_PATHS.artworkLik, {
                extractedBy: "artwork_checklist_extractor",
              }),
            ],
            extractedBy: "artwork_checklist_extractor",
            extractedSummary: "Neat-Lik artwork cycle completed earlier",
          }),
        ],
        updatedAt: daysAgo(4),
        timeline: [
          {
            id: "bob-cl-t1",
            at: daysAgo(4),
            channel: "portal",
            title: "Stage → closed",
            detail: "Commission invoice pending",
          },
        ],
      },
    ),
  ].map(enrichPortfolioDeal);
}

function enrichPortfolioDeal(deal: Deal): Deal {
  const economics = SEEDED_ECONOMICS[deal.id] || deal.economics;
  const cashExposure = SEEDED_CASH[deal.id] || deal.cashExposure;
  const paymentSchedule =
    SEEDED_PAYMENT_SCHEDULES[deal.id] || deal.paymentSchedule;
  const payment = deal.payment
    ? {
        ...deal.payment,
        amountUsd:
          deal.payment.amountUsd ?? economics?.commercialValueUsd,
        currency: deal.payment.currency || "USD",
      }
    : economics &&
        (deal.stage === "docs_payment" ||
          deal.stage === "pi_po" ||
          deal.id === "bob-loving-pets-discrepancy")
      ? {
          ...GOLDEN_PAYMENT,
          amountUsd: economics.commercialValueUsd,
          status:
            deal.id === "bob-loving-pets-discrepancy"
              ? ("overdue" as const)
              : GOLDEN_PAYMENT.status,
          summary: economics.liquidityNote,
        }
      : deal.payment;

  const booking = deal.booking
    ? {
        ...deal.booking,
        shipmentStatus:
          deal.booking.shipmentStatus ||
          (deal.id === "bob-yk-booking-cutoff"
            ? ("about_to_sail" as const)
            : deal.id === "bob-showcase-petrageous"
              ? ("in_waters" as const)
              : deal.booking.shipmentStatus),
        etd:
          deal.booking.etd ||
          (deal.id === "bob-showcase-petrageous"
            ? daysAgo(3).slice(0, 10)
            : deal.booking.etd),
        eta:
          deal.booking.eta ||
          (deal.id === "bob-showcase-petrageous"
            ? new Date(Date.now() + 22 * 86400000).toISOString().slice(0, 10)
            : deal.booking.eta),
      }
    : deal.booking;

  const commission = deal.commission
    ? {
        ...deal.commission,
        amount: deal.commission.amount ?? economics?.agencyCommissionUsd,
      }
    : deal.commission;

  // Ensure finance / shipment provenance mails on cash & sailing deals
  let sources = deal.sources || [];
  if (
    deal.id === "bob-showcase-petrageous" &&
    !sources.some((s) => s.id.includes("finance-liq"))
  ) {
    sources = [
      ...sources,
      sourceFromEmail("payment", FINANCE_LIQUIDITY_EMAIL, 2, {
        id: "src-finance-liq",
        label: "Working capital snapshot",
        extractedBy: "finance_pulse",
        extractedSummary:
          "Coming / came / at risk / payables broken out for Command Center",
      }),
      sourceFromEmail("booking", SHIPMENT_IN_WATERS_EMAIL, 1, {
        id: "src-ship-waters",
        label: "In waters update",
        extractedBy: "shipment_pulse",
        extractedSummary: "Vessel sailed — cargo in waters · ETA +22d",
      }),
    ];
  }
  if (
    deal.id === "bob-loving-pets-discrepancy" &&
    !sources.some((s) => s.kind === "payment")
  ) {
    sources = [
      ...sources,
      sourceFromEmail("payment", PAYMENT_CLOCK_EMAIL, 3, {
        id: "src-payment-lp",
        label: "Overdue payment clock",
        extractedBy: "payment_clock",
        extractedSummary: "USD 17,200 overdue · agency USD 860 at risk",
      }),
    ];
  }
  if (
    deal.id === "bob-closed-commission" &&
    !sources.some((s) => s.body.includes("19,500"))
  ) {
    sources = [
      sourceFromEmail("commission", COMMISSION_EMAIL, 4, {
        id: "src-commission-4",
        label: "Commission close checklist",
        extractedBy: "commission_checklist",
        extractedSummary: "USD 19,500 settled · USD 975 commission open",
      }),
      ...sources,
    ];
  }

  return {
    ...deal,
    economics,
    cashExposure,
    paymentSchedule,
    payment,
    booking,
    commission,
    sources,
  };
}
