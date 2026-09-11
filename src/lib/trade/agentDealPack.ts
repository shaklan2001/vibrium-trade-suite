/**
 * Pack raw deal state for ops agents — includes source emails for provenance.
 */
import type { Deal, PartyProfile } from "@/types/trade";
import { ensureDealEconomics } from "./commandCenterMetrics";

export function buildAgentDealPack(deals: Deal[], asOf = new Date()) {
  return {
    asOf: asOf.toISOString(),
    deals: deals.map((d) => ({
      id: d.id,
      code: d.code,
      title: d.title,
      stage: d.stage,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      parties: d.parties,
      urgency: d.requirement?.urgency,
      productCategory: d.requirement?.productCategory,
      buyerCompany: d.requirement?.buyerCompany,
      targetFactoryCost: d.requirement?.targetFactoryCost,
      targetRetailPrice: d.requirement?.targetRetailPrice,
      requirementSummary: d.requirement?.summary,
      quoteFactory: d.quote?.factoryName,
      skuCount: d.quote?.skus?.length || 0,
      selectedSkuCount: d.quote?.skus?.filter((s) => s.selected).length || 0,
      selectionLocked: d.selectionLocked,
      artworkSummary: d.artwork?.summary,
      artworkItems: d.artwork?.items,
      samplesSummary: d.samples?.summary,
      piNumber: d.pi?.docNumber,
      piTotal: d.pi?.totalAmount,
      poNumber: d.po?.docNumber,
      poTotal: d.po?.totalAmount,
      discrepancyAligned: d.discrepancy?.aligned,
      discrepancySummary: d.discrepancy?.summary,
      discrepancyMismatches: d.discrepancy?.mismatches,
      production: d.production,
      booking: d.booking,
      cbm: d.cbm,
      docsPack: d.docsPack,
      payment: d.payment,
      commission: d.commission,
      economics: ensureDealEconomics(d),
      sources: (d.sources || []).map((s) => ({
        id: s.id,
        kind: s.kind,
        subject: s.subject,
        from: s.from,
        to: s.to,
        receivedAt: s.receivedAt,
        label: s.label,
        extractedBy: s.extractedBy,
        extractedSummary: s.extractedSummary,
        body: (s.body || "").slice(0, 2500),
        attachments: (s.attachments || []).map((a) => ({
          name: a.name,
          samplePath: a.samplePath,
          extractedSummary: a.extractedSummary,
        })),
      })),
      cashExposure: d.cashExposure,
      timelineHead: d.timeline?.[0]
        ? { at: d.timeline[0].at, title: d.timeline[0].title }
        : null,
    })),
  };
}

export function buildFactoryDirectoryPack(profiles: PartyProfile[]) {
  return profiles
    .filter((p) => p.role === "factory")
    .map((p) => ({
      id: p.id,
      company: p.company,
      name: p.name,
      country: p.country,
      city: p.city,
      categories: p.categories,
      scores: p.scores,
      avgLeadDays: p.avgLeadDays,
      moqTypical: p.moqTypical,
      movTypical: p.movTypical,
      notes: p.notes,
      materials: p.materials,
      certifications: p.certifications,
      readinessClass: p.readinessClass,
      readinessScore: p.readinessScore,
      paymentTermsAccepted: p.paymentTermsAccepted,
      incoterms: p.incoterms,
      exportPort: p.exportPort,
      sampleLeadDays: p.sampleLeadDays,
      englishOk: p.englishOk,
      auditWillingness: p.auditWillingness,
      hubOnboardedAt: p.hubOnboardedAt,
      sourceApplicationId: p.sourceApplicationId,
    }));
}
