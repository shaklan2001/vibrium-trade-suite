/**
 * Ops Pulse / Command Center workers — produce insights from raw deal state.
 * No hardcoded narratives: agents own brief, risk, priority, and factory fit.
 */

type WorkerSpec = {
  name: string;
  bot_kind: "worker";
  category_override: string;
  description: string;
  persona: string;
  task: string;
  model: { provider: string; model: string };
  config: { max_turns: number; timeout_seconds: number };
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
};

const base = (
  partial: Omit<WorkerSpec, "bot_kind" | "category_override" | "model"> & {
    model?: WorkerSpec["model"];
  },
): WorkerSpec => ({
  bot_kind: "worker",
  category_override: "trade_sourcing",
  model: partial.model || { provider: "openai", model: "gpt-4.1" },
  ...partial,
});

const GROUNDING = `
Grounding rules (mandatory):
1. Analyze only deals / profiles present in the input JSON.
2. Never invent dealIds, codes, factories, amounts, or dates not in the input.
3. Cite deal code + title when referencing a deal.
4. If the book is empty, say so — do not fabricate a portfolio.
5. You ARE the intelligence layer — produce judgments, priorities, and next steps (do not expect precomputed scores).
`;

export const OPS_RISK_SCANNER_SPEC = base({
  name: "Trade Ops Risk Scanner",
  description:
    "AI risk radar over the SNSPL book of business — surfaces attention items and clusters.",
  persona: `You are an SNSPL ops risk analyst for Vibrium Trade Suite Command Center.

You receive raw deal snapshots (stage, payment, docs, discrepancy, production blockers, artwork, booking cut-offs, commission, aging).

Your job: decide what needs attention, assign severity, cluster themes, and suggest owners.

${GROUNDING}`,
  task: `Given deals_json (stringified { asOf, deals[] }), return:
- attention: array of { dealId, dealCode, dealTitle, severity (critical|warning|info), category (payment|docs|discrepancy|production|artwork|samples|stage_aging|selection|booking|commission|outreach), title, detail, nextStep, dueAt }
- clusters: array of { theme, severity, dealIds, dealTitles, summary, suggestedOwner }
- topRisks: short strings (max 8)
- summary: 2–3 sentence risk radar overview
- confidence 0–1

Prioritize: overdue payment, critical PI/PO gaps, production blockers, incomplete docs near sailing, artwork changes_requested, aged stages.`,
  config: { max_turns: 6, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    properties: {
      deals_json: {
        type: "string",
        description: "Stringified book-of-business deal snapshots",
      },
    },
    required: ["deals_json"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      attention: { type: "array" },
      clusters: { type: "array" },
      topRisks: { type: "array" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["attention", "clusters", "topRisks", "summary", "confidence"],
    additionalProperties: false,
  },
});

export const OPS_PRIORITY_RANKER_SPEC = base({
  name: "Trade Ops Priority Ranker",
  description:
    "AI morning work-order — scores and ranks deals for SNSPL ops.",
  persona: `You are an SNSPL ops lead planning the morning queue.

You receive raw deal snapshots. You invent priority scores (0–100) from commercial urgency, risk, value, aging, and stage criticality — then order the day.

${GROUNDING}`,
  task: `Given deals_json, return:
- ranked: array of { dealId, code, title, stage, score (0-100), rationale, attentionCount }
- todos: array of { dealId, dealCode, dealTitle, severity, title, nextStep } — today's actionable work list (max 12)
- focusDealIds: top 3 dealIds
- summary: short paragraph for Priority Queue
- confidence 0–1

Score high for overdue payments, critical discrepancies, cut-offs today/tomorrow, production blockers, urgent requirements.`,
  config: { max_turns: 6, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    properties: {
      deals_json: {
        type: "string",
        description: "Stringified book-of-business deal snapshots",
      },
    },
    required: ["deals_json"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      ranked: { type: "array" },
      todos: { type: "array" },
      focusDealIds: { type: "array" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["ranked", "todos", "focusDealIds", "summary", "confidence"],
    additionalProperties: false,
  },
});

export const OPS_DAILY_BRIEF_SPEC = base({
  name: "Trade Ops Daily Brief",
  description:
    "AI morning brief for Command Center — fully authored by the agent.",
  persona: `You are Savvy's briefing writer for SNSPL Command Center.

Write crisp Markdown ops briefs from raw deal state. Calm, precise, actionable. No filler.

${GROUNDING}`,
  task: `Given deals_json, write:
- briefMarkdown: Markdown with ## Morning brief, ### Needs you now, ### Today's todos, ### Priority queue. Real line breaks. Max ~400 words. Cite deal codes.
- headline: one-line status for the day
- confidence 0–1`,
  config: { max_turns: 6, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    properties: {
      deals_json: {
        type: "string",
        description: "Stringified book-of-business deal snapshots",
      },
    },
    required: ["deals_json"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      briefMarkdown: { type: "string" },
      headline: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["briefMarkdown", "headline", "confidence"],
    additionalProperties: false,
  },
});

export const FACTORY_RECOMMENDER_SPEC = base({
  name: "Trade Factory Recommender",
  description:
    "AI factory shortlist for a buyer requirement using partner profiles.",
  persona: `You are an SNSPL sourcing advisor matching buyer briefs to factory partners.

You receive a requirement object and a directory of factory profiles. Profiles may include:
- composite scores (size, output, on-time, shipments, quality)
- categories, materials, certifications
- MOQ / MOV / lead times / sample lead times
- Supplier HUB export readiness (readinessClass, readinessScore)
- payment terms, Incoterms, export port, English capability, audit willingness

Use HUB readiness and commercial fit as first-class signals for deal mapping — not only the composite score.

Recommend the best factories for THIS brief. Be honest about cautions (e.g. partially export ready, MOQ mismatch, missing certs).

${GROUNDING}`,
  task: `Given requirement_json and factories_json, return:
- recommendations: array of { profileId, company, score (0-100), fitReasons (string[]), caution } sorted best-first (max 5)
- summary: 1–2 sentences on why the top pick fits
- confidence 0–1

Prefer category/material fit, then capacity/lead/MOQ, then readinessClass + quality scores.
Only use profileIds from factories_json.`,
  config: { max_turns: 4, timeout_seconds: 90 },
  input_schema: {
    type: "object",
    properties: {
      requirement_json: {
        type: "string",
        description: "Stringified requirement fields",
      },
      factories_json: {
        type: "string",
        description: "Stringified factory PartyProfile[]",
      },
    },
    required: ["requirement_json", "factories_json"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      recommendations: { type: "array" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["recommendations", "summary", "confidence"],
    additionalProperties: false,
  },
});

const PROVENANCE_RULE = `
Provenance (mandatory):
- Every numeric claim must cite at least one source from deals[].sources[] (use sourceId, subject, from, and a short excerpt).
- Prefer economics / payment / booking / commission / email body facts already in the pack — do not invent USD amounts or ETAs.
- Dual cash views: (1) commercial buyer→factory FOB cash (2) agency commission / fee cash.
`;

export const DEAL_ECONOMICS_ANALYST_SPEC = base({
  name: "Trade Deal Economics Analyst",
  description:
    "Per-deal cycle time, money, risk/reward, and affordability with mail provenance.",
  persona: `You are an SNSPL commercial controller for the Command Center Deals section.

For each open (and recently closed) deal, answer:
- How long does this deal typically take vs elapsed?
- How much commercial USD and agency commission is involved?
- Risk-to-reward if cash is stuck; can SNSPL afford to wait given near-term inflows?

${GROUNDING}
${PROVENANCE_RULE}`,
  task: `Given deals_json (with sources + economics hints), return:
- deals: array of {
    dealId, dealCode, title,
    commercialValueUsd, agencyCommissionUsd, agencyCommissionPct,
    cycleDaysTypical, cycleDaysElapsed,
    commercialCashAtRiskUsd, agencyCashAtRiskUsd, agencyInflowNext14dUsd,
    riskRewardRatio, affordability (comfortable|tight|blocked),
    liquidityNote, summary,
    sources: [{ dealId, dealCode, sourceId, subject, from, excerpt }]
  }
- summary: 2–3 sentences on portfolio economics
- confidence 0–1

riskRewardRatio ≈ (agencyCommissionUsd + near-term inflow) / max(agencyCashAtRiskUsd, 1).
affordability: comfortable if agencyInflowNext14d covers at-risk; tight if partial; blocked if cash stuck with no near inflow.`,
  config: { max_turns: 8, timeout_seconds: 150 },
  input_schema: {
    type: "object",
    properties: {
      deals_json: {
        type: "string",
        description: "Stringified book with sources and economics",
      },
    },
    required: ["deals_json"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      deals: { type: "array" },
      summary: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["deals", "summary", "confidence"],
    additionalProperties: false,
  },
});

export const FINANCE_PULSE_SPEC = base({
  name: "Trade Finance Pulse",
  description:
    "Portfolio finance KPIs — coming / came / about to come / at risk / payables — with mail provenance.",
  persona: `You are SNSPL finance ops for Command Center.

Answer clearly for BOTH ledgers:
Commercial (buyer→factory): how much is coming, actually came, about to come, at risk.
Agency: how much commission is coming / came / about to come / at risk, and what SNSPL needs to pay (payables).

${GROUNDING}
${PROVENANCE_RULE}`,
  task: `Given deals_json, return FinancePulseReport-shaped JSON:
- currency (usually USD)
- commercialReceivedUsd, commercialAboutToComeUsd, commercialAtRiskUsd, commercialExpectedTotalUsd
- agencyReceivedUsd, agencyAboutToComeUsd, agencyAtRiskUsd, agencyExpectedTotalUsd, agencyPayablesUsd
- lines: detailed rows with bucket + amountUsd + sources[]
- summary: 2–4 sentences answering the finance questions
- sources: portfolio-level cites
- confidence 0–1

Buckets for lines: commercial_received | commercial_about_to_come | commercial_at_risk | agency_received | agency_about_to_come | agency_at_risk | agency_payables | commercial_incoming | agency_incoming.`,
  config: { max_turns: 8, timeout_seconds: 150 },
  input_schema: {
    type: "object",
    properties: {
      deals_json: {
        type: "string",
        description: "Stringified book with payment/commission/sources",
      },
    },
    required: ["deals_json"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      currency: { type: "string" },
      commercialReceivedUsd: { type: "number" },
      commercialAboutToComeUsd: { type: "number" },
      commercialAtRiskUsd: { type: "number" },
      commercialExpectedTotalUsd: { type: "number" },
      agencyReceivedUsd: { type: "number" },
      agencyAboutToComeUsd: { type: "number" },
      agencyAtRiskUsd: { type: "number" },
      agencyExpectedTotalUsd: { type: "number" },
      agencyPayablesUsd: { type: "number" },
      lines: { type: "array" },
      summary: { type: "string" },
      sources: { type: "array" },
      confidence: { type: "number" },
    },
    required: [
      "currency",
      "commercialReceivedUsd",
      "commercialAboutToComeUsd",
      "commercialAtRiskUsd",
      "agencyReceivedUsd",
      "agencyAboutToComeUsd",
      "agencyAtRiskUsd",
      "agencyPayablesUsd",
      "lines",
      "summary",
      "sources",
      "confidence",
    ],
    additionalProperties: false,
  },
});

export const SHIPMENT_PULSE_SPEC = base({
  name: "Trade Shipment Pulse",
  description:
    "Shipment KPIs — about to come, about to go, in waters — with booking-mail provenance.",
  persona: `You are SNSPL logistics ops for Command Center.

Classify each sailing deal:
- about_to_come: inbound ETA within ~14 days / arrived pending clearance
- about_to_go: booked, SI/CY cut-off soon, not yet sailed
- in_waters: ETD passed, ETA in future (on the water)

${GROUNDING}
${PROVENANCE_RULE}`,
  task: `Given deals_json (booking, etd/eta, shipmentStatus, sources), return:
- aboutToCome, aboutToGo, inWaters (counts)
- lines: [{ dealId, dealCode, title, posture, etd, eta, vessel, pol, pod, note, sources[] }]
- summary: 2–3 sentences answering shipment questions
- sources: portfolio cites
- confidence 0–1`,
  config: { max_turns: 6, timeout_seconds: 120 },
  input_schema: {
    type: "object",
    properties: {
      deals_json: {
        type: "string",
        description: "Stringified book with booking + sources",
      },
    },
    required: ["deals_json"],
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      aboutToCome: { type: "number" },
      aboutToGo: { type: "number" },
      inWaters: { type: "number" },
      lines: { type: "array" },
      summary: { type: "string" },
      sources: { type: "array" },
      confidence: { type: "number" },
    },
    required: [
      "aboutToCome",
      "aboutToGo",
      "inWaters",
      "lines",
      "summary",
      "sources",
      "confidence",
    ],
    additionalProperties: false,
  },
});

export const OPS_PULSE_WORKER_SPECS = {
  ops_risk_scanner: OPS_RISK_SCANNER_SPEC,
  ops_priority_ranker: OPS_PRIORITY_RANKER_SPEC,
  ops_daily_brief: OPS_DAILY_BRIEF_SPEC,
  factory_recommender: FACTORY_RECOMMENDER_SPEC,
  deal_economics_analyst: DEAL_ECONOMICS_ANALYST_SPEC,
  finance_pulse: FINANCE_PULSE_SPEC,
  shipment_pulse: SHIPMENT_PULSE_SPEC,
} as const;
