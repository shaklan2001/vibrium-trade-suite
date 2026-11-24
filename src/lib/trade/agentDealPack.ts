/**
 * Pack deal state for the Command Center ops agents (brief, risk, priority,
 * economics, finance, shipment).
 *
 * The full mailbox book is ~2,000 deals; sending all of them with email bodies
 * was ~7.7 MB per call and the agent API answered 413 (and Vercel caps function
 * bodies at 4.5 MB). So the agents get a compact pack instead: book-wide
 * counts, plus the top open deals by local priority with only the fields the
 * worker prompts read, short text, and source headers + a short excerpt for
 * provenance — no email bodies, no raw extractor output.
 */
import type { AttentionItem, Deal, PartyProfile } from "@/types/trade";
import { ensureDealEconomics } from "./commandCenterMetrics";
import {
  collectAllAttention,
  companyPulse,
  scoreDeal,
} from "./opsIntelligence";

/** Deals sent in full detail (highest local priority first). */
export const OPS_PACK_TOP_DEALS = 60;
/** Hard ceiling on the serialized pack; deals are dropped from the tail to fit. */
export const OPS_PACK_MAX_CHARS = 300_000;

const ATTENTION_PER_DEAL = 4;
const SOURCES_PER_DEAL = 2;

function clip(text: string | undefined | null, max: number): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function round(n: number | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Drop undefined / empty values so they don't cost bytes. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v as object).length === 0
    )
      continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

function packDeal(d: Deal, attention: AttentionItem[], score: ReturnType<typeof scoreDeal>) {
  const e = ensureDealEconomics(d);
  const buyer = d.parties?.find((p) => p.role === "buyer");
  const factory = d.parties?.find((p) => p.role === "factory");
  return compact({
    id: d.id,
    code: d.code,
    title: clip(d.title, 120),
    stage: d.stage,
    updatedAt: d.updatedAt,
    localScore: score.score,
    localReasons: score.reasons.slice(0, 3),
    buyer: clip(d.requirement?.buyerCompany || buyer?.company || buyer?.name, 60),
    factory: clip(d.quote?.factoryName || factory?.company || factory?.name, 60),
    urgency: d.requirement?.urgency,
    productCategory: clip(d.requirement?.productCategory, 60),
    requirement: clip(d.requirement?.summary, 200),
    piNumber: d.pi?.docNumber,
    piTotal: round(d.pi?.totalAmount),
    poNumber: d.po?.docNumber,
    poTotal: round(d.po?.totalAmount),
    discrepancy:
      d.discrepancy && !d.discrepancy.aligned
        ? clip(
            d.discrepancy.summary ||
              d.discrepancy.mismatches
                ?.map((m) => m.field)
                .filter(Boolean)
                .join(", "),
            160,
          ) || "PI/PO not aligned"
        : undefined,
    artwork: clip(d.artwork?.summary, 120),
    samples: clip(d.samples?.summary, 120),
    production: d.production
      ? compact({
          readyDate: d.production.readyDate,
          pct: d.production.percentComplete,
          blockers: (d.production.blockers || []).slice(0, 3).map((b) => clip(b, 100)),
        })
      : undefined,
    booking: d.booking
      ? compact({
          status: d.booking.shipmentStatus,
          etd: d.booking.etd,
          eta: d.booking.eta,
          vessel: clip(d.booking.vessel, 40),
          pol: clip(d.booking.pol, 40),
          pod: clip(d.booking.pod, 40),
          cutOffs: clip(d.booking.cutOffs, 80),
        })
      : undefined,
    docs: d.docsPack
      ? compact({
          complete: d.docsPack.complete,
          missing: (d.docsPack.missing || []).slice(0, 6),
        })
      : undefined,
    payment: d.payment
      ? compact({
          status: d.payment.status,
          dueDate: d.payment.dueDate,
          daysRemaining: d.payment.daysRemaining,
          amountUsd: round(d.payment.amountUsd),
        })
      : undefined,
    commission: d.commission
      ? compact({
          complete: d.commission.complete,
          amount: round(d.commission.amount),
          currency: d.commission.currency,
        })
      : undefined,
    economics: compact({
      commercialValueUsd: round(e.commercialValueUsd),
      agencyCommissionUsd: round(e.agencyCommissionUsd),
      agencyCommissionPct: e.agencyCommissionPct,
      cycleDaysTypical: e.cycleDaysTypical,
      cycleDaysElapsed: e.cycleDaysElapsed,
      commercialCashAtRiskUsd: round(e.commercialCashAtRiskUsd),
      agencyCashAtRiskUsd: round(e.agencyCashAtRiskUsd),
      agencyInflowNext14dUsd: round(e.agencyInflowNext14dUsd),
      affordability: e.affordability,
    }),
    attention: attention.slice(0, ATTENTION_PER_DEAL).map((a) =>
      compact({
        severity: a.severity,
        category: a.category,
        title: clip(a.title, 80),
        detail: clip(a.detail, 140),
        nextStep: clip(a.nextStep, 100),
        dueAt: a.dueAt,
      }),
    ),
    sources: [...(d.sources || [])]
      .sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""))
      .slice(0, SOURCES_PER_DEAL)
      .map((s) =>
        compact({
          sourceId: s.id,
          subject: clip(s.subject, 100),
          from: clip(s.from, 60),
          receivedAt: s.receivedAt,
          excerpt: clip(s.extractedSummary || s.body, 200),
        }),
      ),
  });
}

/**
 * Compact book for the ops workers. Shape: { asOf, book, deals[] } where
 * `book` covers every deal and `deals` is the top open deals by local
 * priority (worst first).
 */
export function buildAgentDealPack(
  deals: Deal[],
  asOf = new Date(),
  opts: { topN?: number; maxChars?: number } = {},
) {
  const topN = opts.topN ?? OPS_PACK_TOP_DEALS;
  const maxChars = opts.maxChars ?? OPS_PACK_MAX_CHARS;
  const now = asOf.getTime();

  const attention = collectAllAttention(deals, now);
  const byDeal = new Map<string, AttentionItem[]>();
  const byCategory: Record<string, number> = {};
  for (const a of attention) {
    const list = byDeal.get(a.dealId);
    if (list) list.push(a);
    else byDeal.set(a.dealId, [a]);
    if (a.severity !== "info") {
      byCategory[a.category] = (byCategory[a.category] || 0) + 1;
    }
  }

  const open = deals.filter((d) => d.stage !== "closed");
  const ranked = open
    .map((d) => ({ d, score: scoreDeal(d, byDeal.get(d.id) || [], now) }))
    .sort((a, b) => b.score.score - a.score.score || a.d.title.localeCompare(b.d.title))
    .slice(0, topN);

  const pulse = companyPulse(deals, now);
  const packed = ranked.map(({ d, score }) => packDeal(d, byDeal.get(d.id) || [], score));

  const pack = {
    asOf: asOf.toISOString(),
    note: `Top ${packed.length} of ${open.length} open deals by local priority (worst first). "book" counts cover all ${deals.length} deals. Only cite deals listed in "deals".`,
    book: {
      totalDeals: deals.length,
      openDeals: pulse.openDeals,
      closedDeals: pulse.closedDeals,
      byStage: Object.fromEntries(
        Object.entries(pulse.byStage).filter(([, n]) => n > 0),
      ),
      atRiskDeals: pulse.atRiskCount,
      overduePayments: pulse.overduePayments,
      criticalAttention: pulse.criticalAttention,
      warningAttention: pulse.warningAttention,
      attentionByCategory: byCategory,
      avgStageAgeDays: pulse.avgStageAgeDays,
    },
    deals: packed,
  };

  // Stay under the ceiling even if individual deals carry unusually long fields.
  while (pack.deals.length > 1 && JSON.stringify(pack).length > maxChars) {
    pack.deals = pack.deals.slice(0, Math.floor(pack.deals.length * 0.8));
  }
  return pack;
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
