import type { RequirementFields, QuoteMatrix, QuoteSku } from "@/types/trade";

/** Local fallback extractor when worker agent is not yet provisioned. */
export function extractRequirementLocal(emailText: string): RequirementFields {
  const text = emailText.trim();
  const lower = text.toLowerCase();

  const retailMatch = text.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:retail|msrp)/i)
    || text.match(/retail(?:\s*price)?[^\d$]*\$?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const costMatch = text.match(/(?:factory|cost|target)[^\d$]*\$?\s*([0-9]+(?:\.[0-9]+)?)/i)
    || text.match(/less than\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/i);

  let productCategory = "General merchandise";
  if (lower.includes("leather") && lower.includes("toy")) {
    productCategory = "Leather / suede toys";
  } else if (lower.includes("silicone") || lower.includes("mat")) {
    productCategory = "Pet mats / silicone";
  } else if (lower.includes("bowl")) {
    productCategory = "Pet bowls";
  }

  const emailMatches = text.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  );

  return {
    productCategory,
    materials: lower.includes("suede")
      ? "Leather / suede"
      : lower.includes("silicone")
        ? "Silicone"
        : undefined,
    targetRetailPrice: retailMatch ? Number(retailMatch[1]) : undefined,
    targetFactoryCost: costMatch ? Number(costMatch[1]) : undefined,
    currency: "USD",
    destination: lower.includes("usa") || lower.includes("us ")
      ? "USA"
      : undefined,
    buyerContacts: emailMatches ? [...new Set(emailMatches)] : [],
    urgency: lower.includes("asap") || lower.includes("urgent")
      ? "high"
      : "normal",
    summary: text.slice(0, 280),
    confidence: 0.55,
    raw: { mode: "local_fallback" },
  };
}

export function normalizeQuoteFromWorkerOutput(
  output: Record<string, unknown> | undefined,
  executionId?: string,
): QuoteMatrix {
  if (!output) {
    return { skus: [], executionId, raw: {} };
  }

  const skusRaw =
    (output.skus as unknown[]) ||
    (output.items as unknown[]) ||
    (output.products as unknown[]) ||
    [];

  const skus: QuoteSku[] = skusRaw.map((row) => {
    const r = (row || {}) as Record<string, unknown>;
    return {
      itemCode: String(r.itemCode || r.item_code || r.sku || r.code || ""),
      description: String(r.description || r.name || r.product || ""),
      imageRef: r.imageRef || r.image_ref || r.image
        ? String(r.imageRef || r.image_ref || r.image)
        : undefined,
      moq: r.moq != null ? Number(r.moq) : undefined,
      unitPrice:
        r.unitPrice != null
          ? Number(r.unitPrice)
          : r.unit_price != null
            ? Number(r.unit_price)
            : r.price != null
              ? Number(r.price)
              : undefined,
      currency: String(r.currency || output.currency || "USD"),
      packingNotes: r.packingNotes || r.packing_notes || r.packing
        ? String(r.packingNotes || r.packing_notes || r.packing)
        : undefined,
      selected: false,
    };
  });

  return {
    factoryName: String(
      output.factoryName || output.factory_name || output.factory || "",
    ),
    currency: String(output.currency || "USD"),
    skus,
    raw: output,
    executionId,
  };
}

export function requirementFromWorkerOutput(
  output: Record<string, unknown> | undefined,
): RequirementFields {
  if (!output) return { confidence: 0, summary: "" };
  return {
    productCategory: String(
      output.productCategory || output.product_category || "",
    ),
    materials: output.materials ? String(output.materials) : undefined,
    targetRetailPrice:
      output.targetRetailPrice != null
        ? Number(output.targetRetailPrice)
        : output.target_retail_price != null
          ? Number(output.target_retail_price)
          : undefined,
    targetFactoryCost:
      output.targetFactoryCost != null
        ? Number(output.targetFactoryCost)
        : output.target_factory_cost != null
          ? Number(output.target_factory_cost)
          : undefined,
    currency: String(output.currency || "USD"),
    destination: output.destination
      ? String(output.destination)
      : undefined,
    buyerContacts: Array.isArray(output.buyerContacts)
      ? (output.buyerContacts as string[])
      : Array.isArray(output.buyer_contacts)
        ? (output.buyer_contacts as string[])
        : [],
    urgency: output.urgency ? String(output.urgency) : "normal",
    summary: String(output.summary || ""),
    confidence:
      output.confidence != null ? Number(output.confidence) : 0.8,
    raw: output,
  };
}

export const PETRAGEOUS_FIXTURE_EMAIL = `From: Gretchen George <gretchen@petrageousdesigns.com>
To: Swinder Juneja <swinder@snspl.in>
Cc: Brian George <brian@petrageousdesigns.com>, Matthew Smigiel <Matthew@petrageousdesigns.com>
Subject: Leather Toys AS Sheet

Hi Swinder,

Do you know of a factory that can produce leather/suede toys? These are currently made in India (Ethical is one of the sources). Retail is around $4.99 so factory cost needs to be less than $1.00.

I have design sheets ready to send once we identify a potential factory. I also have INTERZOO notes I can dig through if helpful.

Thanks,
Gretchen`;
