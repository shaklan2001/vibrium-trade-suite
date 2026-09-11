import type { Deal, DealDocument, DocumentType, OutreachEnrollment, TimelineEvent } from "@/types/trade";
import {
  GOLDEN_ARTWORK,
  GOLDEN_BOOKING,
  GOLDEN_CBM,
  GOLDEN_COMMISSION,
  GOLDEN_DISCREPANCY,
  GOLDEN_DOCS,
  GOLDEN_INSPECTION,
  GOLDEN_PACKAGING,
  GOLDEN_PAYMENT,
  GOLDEN_PI,
  GOLDEN_PO,
  GOLDEN_PRODUCTION,
  GOLDEN_QUOTE,
  GOLDEN_REQUIREMENT,
  GOLDEN_SAMPLES,
  GOLDEN_UPC,
} from "./golden";
import { SAMPLE_PATHS } from "./fixtureEmails";
import { sampleOpenUrl } from "./sampleFiles";

function doc(
  name: string,
  type: DocumentType,
  samplePath: string,
  extractedBy?: string,
  extractedSummary?: string,
): Omit<DealDocument, "id" | "uploadedAt"> {
  return {
    name,
    type,
    samplePath,
    url: sampleOpenUrl(samplePath),
    extractedBy,
    extractedSummary,
  };
}

/** Build a fully staged showcase deal (golden agent outputs + sample vault). */
export function buildShowcaseDeal(): Omit<Partial<Deal>, "documents"> & {
  documents: Array<Omit<DealDocument, "id" | "uploadedAt">>;
  outreach: OutreachEnrollment[];
  timeline: TimelineEvent[];
} {
  return {
    title: "Petrageous leather toys — docs & payment",
    stage: "docs_payment",
    showcase: true,
    parties: [
      {
        role: "buyer",
        name: "Gretchen George",
        company: "Petrageous Designs",
        email: "gretchen@petrageousdesigns.com",
      },
      {
        role: "agency",
        name: "Swinder Juneja",
        company: "Savvy Net Sourcing",
        email: "swinder@snspl.in",
      },
      {
        role: "factory",
        name: "Yash",
        company: "Y.K. Industries",
        email: "yash@ykindustries.co.in",
      },
      {
        role: "factory",
        name: "Swastik Industries",
        company: "Swastik Industries",
      },
      {
        role: "forwarder",
        name: "Skyline Freight",
        company: "Skyline Freight & Travels",
      },
    ],
    requirement: GOLDEN_REQUIREMENT,
    quote: GOLDEN_QUOTE,
    selectionLocked: true,
    artwork: GOLDEN_ARTWORK,
    samples: GOLDEN_SAMPLES,
    pi: GOLDEN_PI,
    po: GOLDEN_PO,
    discrepancy: GOLDEN_DISCREPANCY,
    upcMatch: GOLDEN_UPC,
    packaging: GOLDEN_PACKAGING,
    inspection: GOLDEN_INSPECTION,
    production: GOLDEN_PRODUCTION,
    booking: GOLDEN_BOOKING,
    cbm: GOLDEN_CBM,
    docsPack: GOLDEN_DOCS,
    payment: GOLDEN_PAYMENT,
    commission: GOLDEN_COMMISSION,
    documents: [
      doc(
        "AS LEATHER TOYS 6.3.25.xlsx",
        "quote",
        SAMPLE_PATHS.asSheet,
        "quote_normalizer",
        "FOB SKU matrix",
      ),
      doc(
        "NP_neatermat_6x4_INDIA.pdf",
        "artwork",
        SAMPLE_PATHS.artworkMat,
        "artwork_checklist_extractor",
      ),
      doc(
        "090 Performa Invoice-LP-14682.xls",
        "pi",
        SAMPLE_PATHS.piSwastik,
        "pi_extractor",
      ),
      doc(
        "PO# 14682 Swastik 9-1-2026.xlsx",
        "po",
        SAMPLE_PATHS.po14682,
        "po_extractor",
      ),
      doc(
        "Neater Mats Item Number & UPC.xlsx",
        "upc",
        SAMPLE_PATHS.upcMaster,
        "upc_barcode_matcher",
      ),
      doc(
        "BARCODES FINAL - NEATLICK MAT- SMALL.jpg",
        "barcode",
        SAMPLE_PATHS.barcodeArt,
        "upc_barcode_matcher",
      ),
      doc(
        "PACKAGING PO-20958.pdf",
        "packaging",
        SAMPLE_PATHS.packaging,
        "packaging_photo_checklist",
      ),
      doc(
        "Inspection pictures Po-20719.pdf",
        "inspection",
        SAMPLE_PATHS.inspection,
        "inspection_photo_summarizer",
      ),
      doc(
        "BKGCONF_EID0949971.pdf",
        "booking",
        SAMPLE_PATHS.booking,
        "booking_extractor",
      ),
      doc(
        "CBM SHEET -TOYS FINAL QTY - YK .xlsx",
        "cbm",
        SAMPLE_PATHS.cbm,
        "cbm_container_planner",
      ),
      doc(
        "P L V3F 26 27 E 002.pdf",
        "packing_list",
        SAMPLE_PATHS.packingList,
        "final_docs_pack_check",
      ),
    ],
    outreach: [
      {
        id: "showcase-outreach",
        factoryName: "Y.K. Industries",
        channel: "whatsapp",
        status: "QuotePromised",
        enrolledAt: new Date().toISOString(),
        disposition: "QuotePromised",
      },
    ],
    timeline: [
      {
        id: "t1",
        at: new Date(Date.now() - 86400000 * 40).toISOString(),
        channel: "email",
        title: "Buyer enquiry received",
        detail: GOLDEN_REQUIREMENT.summary,
      },
      {
        id: "t2",
        at: new Date(Date.now() - 86400000 * 35).toISOString(),
        channel: "whatsapp",
        title: "Factory outreach · Y.K. Industries",
        detail: "Disposition QuotePromised",
      },
      {
        id: "t3",
        at: new Date(Date.now() - 86400000 * 30).toISOString(),
        channel: "portal",
        title: "Quote matrix normalized",
        detail: "4 SKUs from Y.K. Industries",
      },
      {
        id: "t4",
        at: new Date(Date.now() - 86400000 * 28).toISOString(),
        channel: "portal",
        title: "Buyer selection locked",
        detail: "3 SKUs selected",
      },
      {
        id: "t5",
        at: new Date(Date.now() - 86400000 * 20).toISOString(),
        channel: "email",
        title: "Artwork checklist extracted",
        detail: GOLDEN_ARTWORK.summary,
      },
      {
        id: "t6",
        at: new Date(Date.now() - 86400000 * 15).toISOString(),
        channel: "email",
        title: "PI / PO extracted & compared",
        detail: GOLDEN_DISCREPANCY.summary,
      },
      {
        id: "t7",
        at: new Date(Date.now() - 86400000 * 10).toISOString(),
        channel: "portal",
        title: "Booking confirmed",
        detail: GOLDEN_BOOKING.summary,
      },
      {
        id: "t8",
        at: new Date(Date.now() - 86400000 * 2).toISOString(),
        channel: "email",
        title: "Payment clock & commission checklist",
        detail: GOLDEN_PAYMENT.summary,
      },
    ],
  };
}
