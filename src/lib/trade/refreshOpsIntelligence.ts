"use client";

import { getExecutionResult, runWorkerAndWait } from "@/services/agentsApi";
import { buildAgentDealPack } from "@/lib/trade/agentDealPack";
import {
  buildDealEconomicsList,
  buildFinancePulseFromDeals,
  buildShipmentPulseFromDeals,
  ensureDealEconomics,
} from "@/lib/trade/commandCenterMetrics";
import type {
  AttentionItem,
  Deal,
  DealEconomics,
  FinancePulseReport,
  OpsIntelCache,
  ProvenanceCite,
  ShipmentPulseReport,
  DealPriority,
} from "@/types/trade";

type RoutingSlice = {
  ops_daily_brief?: string;
  ops_priority_ranker?: string;
  ops_risk_scanner?: string;
  deal_economics_analyst?: string;
  finance_pulse?: string;
  shipment_pulse?: string;
};

function asAttention(
  raw: Record<string, unknown>,
  i: number,
): AttentionItem | null {
  const dealId = String(raw.dealId || "");
  if (!dealId) return null;
  const severity = (raw.severity as AttentionItem["severity"]) || "info";
  const category = (raw.category as AttentionItem["category"]) || "stage_aging";
  return {
    id: String(raw.id || `${dealId}-attn-${i}`),
    dealId,
    dealCode: String(raw.dealCode || ""),
    dealTitle: String(raw.dealTitle || raw.title || ""),
    severity:
      severity === "critical" || severity === "warning" || severity === "info"
        ? severity
        : "info",
    category,
    title: String(raw.title || "Attention"),
    detail: String(raw.detail || ""),
    dueAt: raw.dueAt ? String(raw.dueAt) : undefined,
    nextStep: String(raw.nextStep || "Review deal"),
    href: `/deals/${dealId}`,
  };
}

function asRanked(raw: Record<string, unknown>): DealPriority | null {
  const dealId = String(raw.dealId || "");
  if (!dealId) return null;
  return {
    dealId,
    code: String(raw.code || ""),
    title: String(raw.title || ""),
    stage: (raw.stage as DealPriority["stage"]) || "requirement",
    score: Number(raw.score) || 0,
    reasons: Array.isArray(raw.rationale)
      ? raw.rationale.map(String)
      : raw.rationale
        ? [String(raw.rationale)]
        : Array.isArray(raw.reasons)
          ? raw.reasons.map(String)
          : [],
    attentionCount: Number(raw.attentionCount) || 0,
  };
}

function asCite(raw: Record<string, unknown>): ProvenanceCite {
  return {
    dealId: String(raw.dealId || ""),
    dealCode: raw.dealCode ? String(raw.dealCode) : undefined,
    sourceId: raw.sourceId ? String(raw.sourceId) : undefined,
    subject: raw.subject ? String(raw.subject) : undefined,
    from: raw.from ? String(raw.from) : undefined,
    excerpt: String(raw.excerpt || raw.detail || "").slice(0, 220),
  };
}

function asEconomics(
  raw: Record<string, unknown>,
  fallback?: DealEconomics,
): DealEconomics {
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map((s) => asCite(s as Record<string, unknown>))
    : fallback?.sources || [];
  return {
    dealId: String(raw.dealId || fallback?.dealId || ""),
    dealCode: raw.dealCode ? String(raw.dealCode) : fallback?.dealCode,
    title: raw.title ? String(raw.title) : fallback?.title,
    commercialValueUsd: Number(raw.commercialValueUsd) || fallback?.commercialValueUsd || 0,
    agencyCommissionUsd:
      Number(raw.agencyCommissionUsd) || fallback?.agencyCommissionUsd || 0,
    agencyCommissionPct:
      raw.agencyCommissionPct != null
        ? Number(raw.agencyCommissionPct)
        : fallback?.agencyCommissionPct,
    cycleDaysTypical: Number(raw.cycleDaysTypical) || fallback?.cycleDaysTypical || 60,
    cycleDaysElapsed: Number(raw.cycleDaysElapsed) || fallback?.cycleDaysElapsed || 0,
    commercialCashAtRiskUsd:
      Number(raw.commercialCashAtRiskUsd) || fallback?.commercialCashAtRiskUsd || 0,
    agencyCashAtRiskUsd:
      Number(raw.agencyCashAtRiskUsd) || fallback?.agencyCashAtRiskUsd || 0,
    agencyInflowNext14dUsd:
      Number(raw.agencyInflowNext14dUsd) || fallback?.agencyInflowNext14dUsd || 0,
    riskRewardRatio: Number(raw.riskRewardRatio) || fallback?.riskRewardRatio || 0,
    affordability:
      raw.affordability === "tight" || raw.affordability === "blocked"
        ? raw.affordability
        : fallback?.affordability || "comfortable",
    liquidityNote: String(
      raw.liquidityNote || fallback?.liquidityNote || "",
    ),
    sources,
    summary: raw.summary ? String(raw.summary) : fallback?.summary,
  };
}

function asFinance(raw: Record<string, unknown>, fallback: FinancePulseReport): FinancePulseReport {
  return {
    currency: String(raw.currency || fallback.currency || "USD"),
    commercialReceivedUsd:
      Number(raw.commercialReceivedUsd) || fallback.commercialReceivedUsd,
    commercialAboutToComeUsd:
      Number(raw.commercialAboutToComeUsd) || fallback.commercialAboutToComeUsd,
    commercialAtRiskUsd:
      Number(raw.commercialAtRiskUsd) || fallback.commercialAtRiskUsd,
    commercialExpectedTotalUsd:
      Number(raw.commercialExpectedTotalUsd) ||
      fallback.commercialExpectedTotalUsd,
    agencyReceivedUsd:
      Number(raw.agencyReceivedUsd) || fallback.agencyReceivedUsd,
    agencyAboutToComeUsd:
      Number(raw.agencyAboutToComeUsd) || fallback.agencyAboutToComeUsd,
    agencyAtRiskUsd: Number(raw.agencyAtRiskUsd) || fallback.agencyAtRiskUsd,
    agencyExpectedTotalUsd:
      Number(raw.agencyExpectedTotalUsd) || fallback.agencyExpectedTotalUsd,
    agencyPayablesUsd:
      Number(raw.agencyPayablesUsd) || fallback.agencyPayablesUsd,
    lines: Array.isArray(raw.lines)
      ? (raw.lines as Record<string, unknown>[]).map((l) => ({
          dealId: String(l.dealId || ""),
          dealCode: String(l.dealCode || ""),
          title: String(l.title || ""),
          bucket: (l.bucket as FinancePulseReport["lines"][0]["bucket"]) ||
            "commercial_about_to_come",
          amountUsd: Number(l.amountUsd) || 0,
          note: l.note ? String(l.note) : undefined,
          sources: Array.isArray(l.sources)
            ? l.sources.map((s) => asCite(s as Record<string, unknown>))
            : [],
        }))
      : fallback.lines,
    summary: String(raw.summary || fallback.summary),
    sources: Array.isArray(raw.sources)
      ? raw.sources.map((s) => asCite(s as Record<string, unknown>))
      : fallback.sources,
    confidence: Number(raw.confidence) || fallback.confidence,
  };
}

function asShipment(
  raw: Record<string, unknown>,
  fallback: ShipmentPulseReport,
): ShipmentPulseReport {
  return {
    aboutToCome: Number(raw.aboutToCome) || fallback.aboutToCome,
    aboutToGo: Number(raw.aboutToGo) || fallback.aboutToGo,
    inWaters: Number(raw.inWaters) || fallback.inWaters,
    lines: Array.isArray(raw.lines)
      ? (raw.lines as Record<string, unknown>[]).map((l) => ({
          dealId: String(l.dealId || ""),
          dealCode: String(l.dealCode || ""),
          title: String(l.title || ""),
          posture:
            l.posture === "about_to_come" ||
            l.posture === "about_to_go" ||
            l.posture === "in_waters"
              ? l.posture
              : "other",
          etd: l.etd ? String(l.etd) : undefined,
          eta: l.eta ? String(l.eta) : undefined,
          vessel: l.vessel ? String(l.vessel) : undefined,
          pol: l.pol ? String(l.pol) : undefined,
          pod: l.pod ? String(l.pod) : undefined,
          note: l.note ? String(l.note) : undefined,
          sources: Array.isArray(l.sources)
            ? l.sources.map((s) => asCite(s as Record<string, unknown>))
            : [],
        }))
      : fallback.lines,
    summary: String(raw.summary || fallback.summary),
    sources: Array.isArray(raw.sources)
      ? raw.sources.map((s) => asCite(s as Record<string, unknown>))
      : fallback.sources,
    confidence: Number(raw.confidence) || fallback.confidence,
  };
}

/** Run Command Center workers — insights are agent-authored; metrics seed from deal pack. */
export async function refreshOpsIntelligence(opts: {
  deals: Deal[];
  routing: RoutingSlice;
  onStatus?: (msg: string) => void;
}): Promise<OpsIntelCache> {
  const { deals, routing, onStatus } = opts;
  const deals_json = JSON.stringify(buildAgentDealPack(deals));
  const localFinance = buildFinancePulseFromDeals(deals);
  const localShipment = buildShipmentPulseFromDeals(deals);
  const localEconomics = buildDealEconomicsList(deals);

  const patch: OpsIntelCache = {
    refreshedAt: new Date().toISOString(),
    lastAutoDayKey: new Date().toISOString().slice(0, 10),
    agentSourced: true,
    finance: localFinance,
    shipment: localShipment,
    dealEconomics: localEconomics,
  };

  const jobs: Promise<void>[] = [];

  if (routing.ops_daily_brief) {
    jobs.push(
      (async () => {
        onStatus?.("Daily brief…");
        const ex = await runWorkerAndWait(routing.ops_daily_brief!, {
          deals_json,
        });
        if (ex.status === "completed") {
          const r = getExecutionResult(ex) as {
            briefMarkdown?: string;
            headline?: string;
          };
          if (r.briefMarkdown) patch.briefMarkdown = r.briefMarkdown;
          if (r.headline) patch.headline = r.headline;
        } else {
          throw new Error(ex.error || "Daily brief agent failed");
        }
      })(),
    );
  }

  if (routing.ops_priority_ranker) {
    jobs.push(
      (async () => {
        onStatus?.("Priority ranker…");
        const ex = await runWorkerAndWait(routing.ops_priority_ranker!, {
          deals_json,
        });
        if (ex.status === "completed") {
          const r = getExecutionResult(ex) as {
            ranked?: Record<string, unknown>[];
            todos?: Record<string, unknown>[];
            focusDealIds?: string[];
            summary?: string;
          };
          const ranked = (r.ranked || [])
            .map(asRanked)
            .filter((x): x is DealPriority => Boolean(x));
          if (ranked.length) {
            patch.ranked = ranked;
            patch.rankedDealIds = ranked.map((x) => x.dealId);
            const rationales: Record<string, string> = {};
            for (const row of ranked) {
              if (row.reasons[0]) rationales[row.dealId] = row.reasons[0];
            }
            patch.rankRationales = rationales;
          } else if (r.focusDealIds?.length) {
            patch.rankedDealIds = r.focusDealIds;
          }
          if (r.todos?.length) {
            patch.todos = r.todos
              .map((t, i) => asAttention(t, i))
              .filter((x): x is AttentionItem => Boolean(x));
          }
          if (r.summary) patch.prioritySummary = r.summary;
        } else {
          throw new Error(ex.error || "Priority ranker failed");
        }
      })(),
    );
  }

  if (routing.ops_risk_scanner) {
    jobs.push(
      (async () => {
        onStatus?.("Risk scanner…");
        const ex = await runWorkerAndWait(routing.ops_risk_scanner!, {
          deals_json,
        });
        if (ex.status === "completed") {
          const r = getExecutionResult(ex) as {
            summary?: string;
            topRisks?: string[];
            attention?: Record<string, unknown>[];
          };
          patch.riskSummary =
            r.summary ||
            (r.topRisks || []).slice(0, 5).join(" · ") ||
            undefined;
          if (r.attention?.length) {
            patch.attention = r.attention
              .map((a, i) => asAttention(a, i))
              .filter((x): x is AttentionItem => Boolean(x));
          }
        } else {
          throw new Error(ex.error || "Risk scanner failed");
        }
      })(),
    );
  }

  if (routing.deal_economics_analyst) {
    jobs.push(
      (async () => {
        onStatus?.("Deal economics…");
        const ex = await runWorkerAndWait(routing.deal_economics_analyst!, {
          deals_json,
        });
        if (ex.status === "completed") {
          const r = getExecutionResult(ex) as {
            deals?: Record<string, unknown>[];
            summary?: string;
          };
          if (r.deals?.length) {
            patch.dealEconomics = r.deals.map((row) => {
              const id = String(row.dealId || "");
              const deal = deals.find((d) => d.id === id);
              return asEconomics(row, deal ? ensureDealEconomics(deal) : undefined);
            });
          }
          if (r.summary) patch.economicsSummary = r.summary;
        }
        // Soft-fail: keep local economics if agent errors
      })(),
    );
  }

  if (routing.finance_pulse) {
    jobs.push(
      (async () => {
        onStatus?.("Finance pulse…");
        const ex = await runWorkerAndWait(routing.finance_pulse!, {
          deals_json,
        });
        if (ex.status === "completed") {
          const r = getExecutionResult(ex) as Record<string, unknown>;
          patch.finance = asFinance(r, localFinance);
        }
      })(),
    );
  }

  if (routing.shipment_pulse) {
    jobs.push(
      (async () => {
        onStatus?.("Shipment pulse…");
        const ex = await runWorkerAndWait(routing.shipment_pulse!, {
          deals_json,
        });
        if (ex.status === "completed") {
          const r = getExecutionResult(ex) as Record<string, unknown>;
          patch.shipment = asShipment(r, localShipment);
        }
      })(),
    );
  }

  const core = [
    routing.ops_daily_brief,
    routing.ops_priority_ranker,
    routing.ops_risk_scanner,
  ].filter(Boolean);
  if (!core.length) {
    throw new Error(
      "Ops agents not configured — set ops_daily_brief, ops_priority_ranker, ops_risk_scanner in Agent Routing",
    );
  }

  await Promise.all(jobs);
  return patch;
}
