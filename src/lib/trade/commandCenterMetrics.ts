/**
 * Deterministic Command Center KPIs grounded in deal economics and source mail.
 * Agents refine and narrate; this layer keeps charts and provenance available.
 */
import type {
  Deal,
  DealEconomics,
  FinancePulseLine,
  FinancePulseReport,
  ProvenanceCite,
  ShipmentPulseLine,
  ShipmentPulseReport,
} from "@/types/trade";

function money(n: number) {
  return Math.round(n);
}

function citeFromDeal(deal: Deal, preferKinds?: string[]): ProvenanceCite[] {
  const sources = deal.sources || [];
  const preferred = preferKinds?.length
    ? sources.filter((s) => preferKinds.includes(s.kind))
    : sources;
  const pick = (preferred.length ? preferred : sources).slice(0, 3);
  return pick.map((s) => ({
    dealId: deal.id,
    dealCode: deal.code,
    sourceId: s.id,
    kind: s.kind,
    subject: s.subject,
    from: s.from,
    excerpt: (s.extractedSummary || s.body || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180),
  }));
}

export function ensureDealEconomics(deal: Deal): DealEconomics {
  if (deal.economics) return deal.economics;

  const commercial =
    deal.payment?.amountUsd ||
    deal.pi?.totalAmount ||
    deal.po?.totalAmount ||
    0;
  const commission =
    deal.commission?.amount ||
    money(commercial * (deal.commission?.complete === false ? 0.05 : 0.05));
  const elapsed = Math.max(
    1,
    Math.floor(
      (Date.now() - Date.parse(deal.createdAt || deal.updatedAt)) / 86400000,
    ),
  );
  const typical =
    deal.stage === "closed"
      ? Math.max(elapsed, 60)
      : deal.stage === "booking" || deal.stage === "docs_payment"
        ? 75
        : 55;

  const commercialAtRisk =
    deal.payment?.status === "overdue" || deal.payment?.status === "due_soon"
      ? commercial
      : deal.discrepancy?.aligned === false
        ? money(commercial * 0.35)
        : 0;
  const agencyAtRisk =
    deal.commission && !deal.commission.complete
      ? commission
      : deal.payment?.status === "overdue"
        ? commission
        : 0;
  const inflow =
    deal.payment?.status === "pending" || deal.payment?.status === "due_soon"
      ? money(commission * 0.6)
      : deal.payment?.status === "paid" && deal.commission && !deal.commission.complete
        ? commission
        : 0;

  const riskReward =
    Math.round(
      ((commission + inflow) / Math.max(agencyAtRisk || commercialAtRisk * 0.05, 1)) *
        10,
    ) / 10;

  let affordability: DealEconomics["affordability"] = "comfortable";
  if (agencyAtRisk > inflow * 1.5) affordability = "blocked";
  else if (agencyAtRisk > inflow) affordability = "tight";

  return {
    commercialValueUsd: money(commercial),
    agencyCommissionUsd: money(commission),
    agencyCommissionPct: commercial ? money((commission / commercial) * 1000) / 10 : 5,
    cycleDaysTypical: typical,
    cycleDaysElapsed: elapsed,
    commercialCashAtRiskUsd: money(commercialAtRisk),
    agencyCashAtRiskUsd: money(agencyAtRisk),
    agencyInflowNext14dUsd: money(inflow),
    riskRewardRatio: riskReward,
    affordability,
    liquidityNote:
      affordability === "comfortable"
        ? "Near-term inflows cover agency exposure."
        : affordability === "tight"
          ? "Commission at risk exceeds near inflows — watch cash."
          : "Cash stuck relative to inflows — escalate payment / commission.",
    sources: citeFromDeal(deal, ["payment", "commission", "pi", "po", "quote"]),
    summary: `${deal.code}: $${money(commercial).toLocaleString()} commercial · $${money(commission).toLocaleString()} agency`,
  };
}

export function buildFinancePulseFromDeals(deals: Deal[]): FinancePulseReport {
  let commercialReceived = 0;
  let commercialAbout = 0;
  let commercialAtRisk = 0;
  let agencyReceived = 0;
  let agencyAbout = 0;
  let agencyAtRisk = 0;
  let agencyPayables = 0;
  const lines: FinancePulseLine[] = [];
  const sources: ProvenanceCite[] = [];

  for (const d of deals) {
    const e = ensureDealEconomics(d);
    const pay = d.payment;
    const cites = citeFromDeal(d, ["payment", "commission", "pi", "po"]);
    sources.push(...cites.slice(0, 1));

    if (pay?.status === "paid") {
      commercialReceived += e.commercialValueUsd;
      lines.push({
        dealId: d.id,
        dealCode: d.code,
        title: d.title,
        bucket: "commercial_received",
        amountUsd: e.commercialValueUsd,
        note: pay.summary,
        sources: cites,
      });
      if (d.commission?.complete) {
        agencyReceived += e.agencyCommissionUsd;
        lines.push({
          dealId: d.id,
          dealCode: d.code,
          title: d.title,
          bucket: "agency_received",
          amountUsd: e.agencyCommissionUsd,
          sources: cites,
        });
      } else if (d.commission) {
        agencyAbout += e.agencyCommissionUsd;
        lines.push({
          dealId: d.id,
          dealCode: d.code,
          title: d.title,
          bucket: "agency_about_to_come",
          amountUsd: e.agencyCommissionUsd,
          note: "Buyer paid factory; commission invoice still open",
          sources: cites,
        });
      }
    } else if (pay?.status === "overdue" || pay?.status === "due_soon") {
      commercialAtRisk += e.commercialValueUsd;
      agencyAtRisk += e.agencyCommissionUsd;
      lines.push({
        dealId: d.id,
        dealCode: d.code,
        title: d.title,
        bucket: "commercial_at_risk",
        amountUsd: e.commercialValueUsd,
        note: pay.summary,
        sources: cites,
      });
      lines.push({
        dealId: d.id,
        dealCode: d.code,
        title: d.title,
        bucket: "agency_at_risk",
        amountUsd: e.agencyCommissionUsd,
        sources: cites,
      });
    } else if (pay?.status === "pending" || pay?.status === "not_started") {
      if (d.stage === "docs_payment" || d.stage === "booking" || d.stage === "closed") {
        commercialAbout += e.commercialValueUsd;
        agencyAbout += e.agencyCommissionUsd;
        lines.push({
          dealId: d.id,
          dealCode: d.code,
          title: d.title,
          bucket: "commercial_about_to_come",
          amountUsd: e.commercialValueUsd,
          sources: cites,
        });
        lines.push({
          dealId: d.id,
          dealCode: d.code,
          title: d.title,
          bucket: "agency_about_to_come",
          amountUsd: e.agencyCommissionUsd,
          sources: cites,
        });
      }
    }

    // Agency payables: inspection / sample courier / minor ops costs when noted
    if (d.stage === "samples" || d.stage === "production") {
      const payable = 450;
      agencyPayables += payable;
      lines.push({
        dealId: d.id,
        dealCode: d.code,
        title: d.title,
        bucket: "agency_payables",
        amountUsd: payable,
        note: "Sample / inspection outlay to settle",
        sources: citeFromDeal(d, ["samples", "inspection", "production"]),
      });
    }
  }

  const commercialExpected =
    commercialReceived + commercialAbout + commercialAtRisk;
  const agencyExpected = agencyReceived + agencyAbout + agencyAtRisk;

  return {
    currency: "USD",
    commercialReceivedUsd: money(commercialReceived),
    commercialAboutToComeUsd: money(commercialAbout),
    commercialAtRiskUsd: money(commercialAtRisk),
    commercialExpectedTotalUsd: money(commercialExpected),
    agencyReceivedUsd: money(agencyReceived),
    agencyAboutToComeUsd: money(agencyAbout),
    agencyAtRiskUsd: money(agencyAtRisk),
    agencyExpectedTotalUsd: money(agencyExpected),
    agencyPayablesUsd: money(agencyPayables),
    lines,
    summary: `Commercial: $${money(commercialReceived).toLocaleString()} received · $${money(commercialAbout).toLocaleString()} about to come · $${money(commercialAtRisk).toLocaleString()} at risk. Agency: $${money(agencyReceived).toLocaleString()} received · $${money(agencyAbout).toLocaleString()} about to come · $${money(agencyAtRisk).toLocaleString()} at risk · $${money(agencyPayables).toLocaleString()} to pay.`,
    sources: sources.slice(0, 12),
    confidence: 0.85,
  };
}

export function buildShipmentPulseFromDeals(deals: Deal[]): ShipmentPulseReport {
  const lines: ShipmentPulseLine[] = [];
  let aboutToCome = 0;
  let aboutToGo = 0;
  let inWaters = 0;
  const sources: ProvenanceCite[] = [];
  const now = Date.now();

  for (const d of deals) {
    const b = d.booking;
    if (!b && d.stage !== "booking" && d.stage !== "docs_payment") continue;
    const cites = citeFromDeal(d, ["booking", "payment", "production"]);
    sources.push(...cites.slice(0, 1));

    const status = b?.shipmentStatus;
    const etd = b?.etd ? Date.parse(b.etd) : NaN;
    const eta = b?.eta ? Date.parse(b.eta) : NaN;

    let posture: ShipmentPulseLine["posture"] = "other";
    if (status === "in_waters" || (!Number.isNaN(etd) && etd < now && !Number.isNaN(eta) && eta > now)) {
      posture = "in_waters";
      inWaters += 1;
    } else if (
      status === "about_to_arrive" ||
      status === "arrived" ||
      (!Number.isNaN(eta) && eta - now < 14 * 86400000 && eta >= now)
    ) {
      posture = "about_to_come";
      aboutToCome += 1;
    } else if (
      status === "about_to_sail" ||
      status === "planned" ||
      d.stage === "booking" ||
      (!Number.isNaN(etd) && etd >= now)
    ) {
      posture = "about_to_go";
      aboutToGo += 1;
    }

    if (posture !== "other") {
      lines.push({
        dealId: d.id,
        dealCode: d.code,
        title: d.title,
        posture,
        etd: b?.etd,
        eta: b?.eta,
        vessel: b?.vessel,
        pol: b?.pol,
        pod: b?.pod,
        note: b?.summary || b?.cutOffs,
        sources: cites,
      });
    }
  }

  return {
    aboutToCome,
    aboutToGo,
    inWaters,
    lines,
    summary: `${aboutToCome} shipment(s) about to arrive · ${aboutToGo} about to sail · ${inWaters} in waters.`,
    sources: sources.slice(0, 12),
    confidence: 0.85,
  };
}

export function buildDealEconomicsList(deals: Deal[]): DealEconomics[] {
  return deals.map((d) => {
    const e = ensureDealEconomics(d);
    return {
      ...e,
      dealId: d.id,
      dealCode: d.code,
      title: d.title,
      summary: e.summary || d.title,
    };
  });
}

export function usd(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}
