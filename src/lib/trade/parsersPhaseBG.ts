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
  SampleRequestSummary,
  UpcBarcodeMatch,
} from "@/types/trade";

function pickString(...values: Array<unknown>): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function pickNumber(...values: Array<unknown>): number | undefined {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickBool(...values: Array<unknown>): boolean | undefined {
  for (const v of values) {
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

function pickStringArray(...values: Array<unknown>): string[] {
  for (const v of values) {
    if (!Array.isArray(v)) continue;
    return v
      .map((x) => (typeof x === "string" ? x.trim() : String(x || "")))
      .filter(Boolean);
  }
  return [];
}

function requireResult(
  output: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!output) throw new Error("Worker completed without a result payload");
  return output;
}

export function artworkFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): ArtworkChecklist {
  const src = requireResult(output);
  const itemsRaw = (src.items as unknown[]) || [];
  return {
    items: itemsRaw.map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        asset: pickString(r.asset, r.name) || "",
        status: (pickString(r.status) || "pending") as ArtworkChecklist["items"][0]["status"],
        notes: pickString(r.notes),
      };
    }),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function samplesFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): SampleRequestSummary {
  const src = requireResult(output);
  return {
    courier: pickString(src.courier),
    trackingNumber: pickString(src.trackingNumber, src.tracking_number),
    dispatchDate: pickString(src.dispatchDate, src.dispatch_date),
    expectedArrival: pickString(src.expectedArrival, src.expected_arrival),
    photoRefs: pickStringArray(src.photoRefs, src.photo_refs),
    items: pickStringArray(src.items),
    status: pickString(src.status),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function commercialFromWorker(
  output: Record<string, unknown> | undefined,
  fallbackType: "pi" | "po",
  executionId?: string,
): CommercialDocument {
  const src = requireResult(output);
  const linesRaw = (src.lines as unknown[]) || [];
  return {
    docType: (pickString(src.docType, src.doc_type) as "pi" | "po") || fallbackType,
    docNumber: pickString(src.docNumber, src.doc_number),
    shipper: pickString(src.shipper),
    consignee: pickString(src.consignee),
    buyer: pickString(src.buyer),
    factory: pickString(src.factory),
    incoterm: pickString(src.incoterm),
    paymentTerms: pickString(src.paymentTerms, src.payment_terms),
    pol: pickString(src.pol),
    pod: pickString(src.pod),
    currency: pickString(src.currency) || "USD",
    totalAmount: pickNumber(src.totalAmount, src.total_amount),
    totalCbm: pickNumber(src.totalCbm, src.total_cbm),
    readyDate: pickString(src.readyDate, src.ready_date),
    lines: linesRaw.map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        itemCode: pickString(r.itemCode, r.item_code),
        description: pickString(r.description),
        qty: pickNumber(r.qty, r.quantity),
        unitPrice: pickNumber(r.unitPrice, r.unit_price),
        amount: pickNumber(r.amount),
        cbm: pickNumber(r.cbm),
        packing: pickString(r.packing),
      };
    }),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function discrepancyFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): PiPoDiscrepancy {
  const src = requireResult(output);
  const mismatches = ((src.mismatches as unknown[]) || []).map((row) => {
    const r = (row || {}) as Record<string, unknown>;
    return {
      field: pickString(r.field) || "",
      piValue: pickString(r.piValue, r.pi_value),
      poValue: pickString(r.poValue, r.po_value),
      severity: (pickString(r.severity) || "info") as PiPoDiscrepancy["mismatches"][0]["severity"],
      note: pickString(r.note),
    };
  });
  return {
    mismatches,
    aligned: pickBool(src.aligned) ?? mismatches.every((m) => m.severity === "info"),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function upcFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): UpcBarcodeMatch {
  const src = requireResult(output);
  return {
    rows: ((src.rows as unknown[]) || []).map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        itemCode: pickString(r.itemCode, r.item_code),
        description: pickString(r.description),
        upc: pickString(r.upc),
        barcodePresent: pickBool(r.barcodePresent, r.barcode_present),
        matchStatus: (pickString(r.matchStatus, r.match_status) ||
          "missing_upc") as UpcBarcodeMatch["rows"][0]["matchStatus"],
        notes: pickString(r.notes),
      };
    }),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function packagingFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): PackagingChecklist {
  const src = requireResult(output);
  return {
    poNumber: pickString(src.poNumber, src.po_number),
    items: ((src.items as unknown[]) || []).map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        view: pickString(r.view) || "",
        present: pickBool(r.present) ?? false,
        notes: pickString(r.notes),
      };
    }),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function inspectionFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): InspectionSummary {
  const src = requireResult(output);
  return {
    findings: ((src.findings as unknown[]) || []).map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        itemCode: pickString(r.itemCode, r.item_code),
        result: (pickString(r.result) ||
          "unknown") as InspectionSummary["findings"][0]["result"],
        notes: pickString(r.notes),
      };
    }),
    overall: pickString(src.overall),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function productionFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): ProductionStatus {
  const src = requireResult(output);
  return {
    readyDate: pickString(src.readyDate, src.ready_date),
    percentComplete: pickNumber(src.percentComplete, src.percent_complete),
    blockers: pickStringArray(src.blockers),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function bookingFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): BookingDetails {
  const src = requireResult(output);
  return {
    bookingNumber: pickString(src.bookingNumber, src.booking_number),
    carrier: pickString(src.carrier),
    vessel: pickString(src.vessel),
    voyage: pickString(src.voyage),
    pol: pickString(src.pol),
    pod: pickString(src.pod),
    etd: pickString(src.etd),
    eta: pickString(src.eta),
    equipment: pickString(src.equipment),
    cutOffs: pickString(src.cutOffs, src.cut_offs),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function cbmFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): CbmPlan {
  const src = requireResult(output);
  return {
    totalCbm: pickNumber(src.totalCbm, src.total_cbm),
    containerType: pickString(src.containerType, src.container_type),
    containersNeeded: pickNumber(src.containersNeeded, src.containers_needed),
    utilizationPct: pickNumber(src.utilizationPct, src.utilization_pct),
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function docsPackFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): DocsPackCheck {
  const src = requireResult(output);
  return {
    required: pickStringArray(src.required),
    present: pickStringArray(src.present),
    missing: pickStringArray(src.missing),
    complete: pickBool(src.complete) ?? false,
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function paymentFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): PaymentClock {
  const src = requireResult(output);
  return {
    blSharedDate: pickString(src.blSharedDate, src.bl_shared_date),
    dueDate: pickString(src.dueDate, src.due_date),
    daysRemaining: pickNumber(src.daysRemaining, src.days_remaining),
    status: (pickString(src.status) ||
      "pending") as PaymentClock["status"],
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}

export function commissionFromWorker(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): CommissionChecklist {
  const src = requireResult(output);
  return {
    items: ((src.items as unknown[]) || []).map((row) => {
      const r = (row || {}) as Record<string, unknown>;
      return {
        item: pickString(r.item) || "",
        done: pickBool(r.done) ?? false,
        notes: pickString(r.notes),
      };
    }),
    fxRate: pickString(src.fxRate, src.fx_rate),
    amount: pickNumber(src.amount),
    currency: pickString(src.currency),
    complete: pickBool(src.complete) ?? false,
    summary: pickString(src.summary),
    confidence: pickNumber(src.confidence),
    executionId,
    raw: src,
  };
}
