import type { RequirementFields, QuoteMatrix, QuoteSku } from "@/types/trade";

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

function pickStringArray(...values: Array<unknown>): string[] {
  for (const v of values) {
    if (!Array.isArray(v)) continue;
    return [
      ...new Set(
        v
          .map((x) => (typeof x === "string" ? x.trim() : String(x || "")))
          .filter(Boolean),
      ),
    ];
  }
  return [];
}

function unwrapPayload(
  output: Record<string, unknown>,
): Record<string, unknown> {
  const nestedCandidates = [output.result, output.data, output.fields];
  for (const nested of nestedCandidates) {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const n = nested as Record<string, unknown>;
      if (
        n.productCategory ||
        n.product_category ||
        n.summary ||
        n.skus ||
        n.items
      ) {
        return n;
      }
    }
  }
  return output;
}

/** True when the agent result has no usable commercial fields. */
export function isSparseRequirement(fields: RequirementFields): boolean {
  return !(
    fields.productCategory ||
    fields.materials ||
    fields.targetRetailPrice != null ||
    fields.targetFactoryCost != null ||
    fields.summary ||
    (fields.buyerContacts && fields.buyerContacts.length > 0)
  );
}

export function isSparseQuote(matrix: QuoteMatrix): boolean {
  return !matrix.skus.length;
}

/** Map requirement_extractor worker result → UI fields. */
export function requirementFromWorkerOutput(
  output: Record<string, unknown> | undefined,
): RequirementFields {
  if (!output) {
    throw new Error("Worker completed without a result payload");
  }

  const src = unwrapPayload(output);
  const fields: RequirementFields = {
    productCategory: pickString(src.productCategory, src.product_category),
    materials: pickString(src.materials),
    targetRetailPrice: pickNumber(
      src.targetRetailPrice,
      src.target_retail_price,
    ),
    targetFactoryCost: pickNumber(
      src.targetFactoryCost,
      src.target_factory_cost,
    ),
    currency: pickString(src.currency) || "USD",
    destination: pickString(src.destination),
    buyerCompany: pickString(src.buyerCompany, src.buyer_company),
    buyerContacts: pickStringArray(src.buyerContacts, src.buyer_contacts),
    urgency: pickString(src.urgency) || "normal",
    currentSourcingNotes: pickString(
      src.currentSourcingNotes,
      src.current_sourcing_notes,
    ),
    packingRequirements: pickString(
      src.packingRequirements,
      src.packing_requirements,
    ),
    complianceNotes: pickString(src.complianceNotes, src.compliance_notes),
    quantityHints: pickString(src.quantityHints, src.quantity_hints),
    openQuestions: pickStringArray(src.openQuestions, src.open_questions),
    nextActions: pickStringArray(src.nextActions, src.next_actions),
    subject: pickString(src.subject),
    summary: pickString(src.summary) || "",
    confidence: pickNumber(src.confidence) ?? 0,
    raw: output,
  };

  if (isSparseRequirement(fields)) {
    throw new Error(
      "Worker result was empty — check agent schema / execution logs",
    );
  }

  return fields;
}

/** Map quote_normalizer worker result → SKU matrix. */
export function normalizeQuoteFromWorkerOutput(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): QuoteMatrix {
  if (!output) {
    throw new Error("Worker completed without a result payload");
  }

  const src = unwrapPayload(output);
  const skusRaw =
    (src.skus as unknown[]) ||
    (src.items as unknown[]) ||
    (src.products as unknown[]) ||
    [];

  const skus: QuoteSku[] = skusRaw.map((row) => {
    const r = (row || {}) as Record<string, unknown>;
    return {
      itemCode: pickString(r.itemCode, r.item_code, r.sku, r.code) || "",
      description: pickString(r.description, r.name, r.product) || "",
      imageRef: pickString(r.imageRef, r.image_ref, r.image),
      moq: pickNumber(r.moq),
      unitPrice: pickNumber(r.unitPrice, r.unit_price, r.price),
      currency: pickString(r.currency, src.currency) || "USD",
      packingNotes: pickString(r.packingNotes, r.packing_notes, r.packing),
      innerCarton: pickNumber(r.innerCarton, r.inner_carton),
      masterCarton: pickNumber(r.masterCarton, r.master_carton),
      cbm: pickNumber(r.cbm),
      selected: false,
    };
  });

  const matrix: QuoteMatrix = {
    factoryName: pickString(src.factoryName, src.factory_name, src.factory),
    currency: pickString(src.currency) || "USD",
    quoteDate: pickString(src.quoteDate, src.quote_date),
    incoterm: pickString(src.incoterm),
    paymentTerms: pickString(src.paymentTerms, src.payment_terms),
    leadTimeDays: pickNumber(src.leadTimeDays, src.lead_time_days),
    notes: pickString(src.notes),
    confidence: pickNumber(src.confidence),
    skus,
    raw: output,
    executionId,
  };

  if (isSparseQuote(matrix)) {
    throw new Error(
      "Worker returned no SKUs — check the document URL and agent logs",
    );
  }

  return matrix;
}
