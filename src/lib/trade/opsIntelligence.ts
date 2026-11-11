/**
 * Deterministic ops intelligence — facts/scores in code; agents only narrate.
 */
import type {
  AttentionItem,
  AttentionSeverity,
  CompanyPulse,
  Deal,
  DealPriority,
  DealStage,
} from "@/types/trade";
import { ALL_STAGES, STAGE_LABELS } from "@/types/trade";

const STAGE_AGING_WARN_DAYS: Partial<Record<DealStage, number>> = {
  requirement: 5,
  outreach: 7,
  quoting: 7,
  selection: 5,
  artwork: 7,
  samples: 10,
  pi_po: 5,
  packaging: 7,
  production: 14,
  booking: 4,
  docs_payment: 7,
  closed: 30,
};

const STAGE_NEXT: Record<DealStage, string> = {
  requirement: "Run Requirement Intake and extract the buyer enquiry",
  outreach: "Enroll factory outreach or chase QuotePromised factories",
  quoting: "Normalize the AS/quote sheet and review the SKU matrix",
  selection: "Chase buyer SKU selection and lock the matrix",
  artwork: "Resolve artwork checklist gaps in Pipeline → Artwork",
  samples: "Confirm sample dispatch / arrival in Pipeline → Samples",
  pi_po: "Resolve PI/PO discrepancies before locking commercial terms",
  packaging: "Complete UPC/barcode and packaging photo checklist",
  production: "Clear production blockers and confirm ready date",
  booking: "Confirm booking cut-offs and sailing with forwarder",
  docs_payment: "Close docs pack gaps and chase the payment clock",
  closed: "Finish commission checklist and archive",
};

function daysBetween(iso: string, now = Date.now()): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((now - t) / 86400000);
}

function stageAgeDays(deal: Deal, now = Date.now()): number {
  const last =
    deal.timeline?.[0]?.at ||
    deal.updatedAt ||
    deal.createdAt;
  return daysBetween(last, now);
}

function dealValueProxy(deal: Deal): number {
  if (deal.pi?.totalAmount != null) return deal.pi.totalAmount;
  if (deal.po?.totalAmount != null) return deal.po.totalAmount;
  const skus = deal.quote?.skus?.filter((s) => s.selected) || deal.quote?.skus || [];
  const sum = skus.reduce(
    (acc, s) => acc + (s.unitPrice || 0) * (s.moq || 500),
    0,
  );
  return sum;
}

function severityRank(s: AttentionSeverity): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : 1;
}

function push(
  out: AttentionItem[],
  item: Omit<AttentionItem, "dealTitle" | "dealCode"> & {
    dealTitle?: string;
    dealCode?: string;
  },
  deal: Deal,
) {
  out.push({
    ...item,
    dealTitle: item.dealTitle || deal.title,
    dealCode: item.dealCode || deal.code || "",
  });
}

/** Collect attention items for one deal. */
export function collectDealAttention(
  deal: Deal,
  now = Date.now(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const href = `/deals/${deal.id}`;
  const age = stageAgeDays(deal, now);

  if (deal.payment?.status === "overdue") {
    push(
      items,
      {
        id: `${deal.id}-pay-overdue`,
        dealId: deal.id,
        severity: "critical",
        category: "payment",
        title: "Payment overdue",
        detail:
          deal.payment.summary ||
          `Due ${deal.payment.dueDate || "—"} · ${deal.payment.daysRemaining ?? "?"} days remaining`,
        dueAt: deal.payment.dueDate,
        nextStep: "Chase buyer T/T and confirm release conditions",
        href: `/pipeline?deal=${deal.id}&focus=payment`,
      },
      deal,
    );
  } else if (deal.payment?.status === "due_soon") {
    push(
      items,
      {
        id: `${deal.id}-pay-due`,
        dealId: deal.id,
        severity: "warning",
        category: "payment",
        title: "Payment due soon",
        detail: deal.payment.summary || `Due ${deal.payment.dueDate}`,
        dueAt: deal.payment.dueDate,
        nextStep: "Send payment reminder before due date",
        href: `/pipeline?deal=${deal.id}&focus=payment`,
      },
      deal,
    );
  }

  if (deal.docsPack && !deal.docsPack.complete && (deal.docsPack.missing?.length || 0) > 0) {
    push(
      items,
      {
        id: `${deal.id}-docs`,
        dealId: deal.id,
        severity:
          deal.stage === "docs_payment" || deal.stage === "booking"
            ? "critical"
            : "warning",
        category: "docs",
        title: "Docs pack incomplete",
        detail: `Missing: ${deal.docsPack.missing.join(", ")}`,
        nextStep: "Collect outstanding shipping documents in Pipeline / Vault",
        href: `/pipeline?deal=${deal.id}&focus=docs`,
      },
      deal,
    );
  }

  const criticalMismatch = deal.discrepancy?.mismatches?.filter(
    (m) => m.severity === "critical",
  );
  if (criticalMismatch?.length) {
    push(
      items,
      {
        id: `${deal.id}-disc`,
        dealId: deal.id,
        severity: "critical",
        category: "discrepancy",
        title: "Critical PI/PO discrepancy",
        detail:
          deal.discrepancy?.summary ||
          criticalMismatch.map((m) => m.field).join(", "),
        nextStep: "Clarify with factory/buyer before commercial lock",
        href: `/pipeline?deal=${deal.id}&focus=pi_po`,
      },
      deal,
    );
  } else if (deal.discrepancy && !deal.discrepancy.aligned) {
    push(
      items,
      {
        id: `${deal.id}-disc-w`,
        dealId: deal.id,
        severity: "warning",
        category: "discrepancy",
        title: "PI/PO not aligned",
        detail: deal.discrepancy.summary || "Mismatches present",
        nextStep: "Review discrepancy list and resolve warnings",
        href: `/pipeline?deal=${deal.id}&focus=pi_po`,
      },
      deal,
    );
  }

  if (deal.production?.blockers?.length) {
    push(
      items,
      {
        id: `${deal.id}-prod`,
        dealId: deal.id,
        severity: "critical",
        category: "production",
        title: "Production blockers",
        detail: deal.production.blockers.join("; "),
        nextStep: "Escalate blockers with factory; update ready date",
        href: `/pipeline?deal=${deal.id}&focus=production`,
      },
      deal,
    );
  }

  const artBad = deal.artwork?.items?.filter(
    (i) => i.status === "changes_requested" || i.status === "missing",
  );
  if (artBad?.length) {
    push(
      items,
      {
        id: `${deal.id}-art`,
        dealId: deal.id,
        severity: artBad.some((i) => i.status === "changes_requested")
          ? "warning"
          : "info",
        category: "artwork",
        title: "Artwork needs action",
        detail: artBad.map((i) => `${i.asset} (${i.status})`).join("; "),
        nextStep: "Chase artwork revisions / missing assets",
        href: `/pipeline?deal=${deal.id}&focus=artwork`,
      },
      deal,
    );
  }

  if (
    deal.stage === "selection" &&
    !deal.selectionLocked &&
    (deal.quote?.skus?.length || 0) > 0
  ) {
    push(
      items,
      {
        id: `${deal.id}-sel`,
        dealId: deal.id,
        severity: age >= 5 ? "warning" : "info",
        category: "selection",
        title: "Buyer selection pending",
        detail: `${deal.quote?.skus.length} SKUs awaiting lock`,
        nextStep: "Chase buyer to select SKUs and lock selection",
        href: `/quotes?deal=${deal.id}`,
      },
      deal,
    );
  }

  if (deal.booking?.cutOffs && deal.stage === "booking") {
    push(
      items,
      {
        id: `${deal.id}-book`,
        dealId: deal.id,
        severity: "warning",
        category: "booking",
        title: "Booking cut-off approaching",
        detail: deal.booking.cutOffs,
        nextStep: "Confirm SI/CY cut-offs with forwarder today",
        href: `/pipeline?deal=${deal.id}&focus=booking`,
      },
      deal,
    );
  }

  if (
    deal.commission &&
    !deal.commission.complete &&
    deal.commission.items?.some((i) => !i.done)
  ) {
    const open = deal.commission.items.filter((i) => !i.done);
    push(
      items,
      {
        id: `${deal.id}-comm`,
        dealId: deal.id,
        severity: deal.stage === "closed" ? "warning" : "info",
        category: "commission",
        title: "Commission checklist incomplete",
        detail: open.map((i) => i.item).join("; "),
        nextStep: "Issue commission invoice / chase payment advice",
        href: `/pipeline?deal=${deal.id}&focus=commission`,
      },
      deal,
    );
  }

  const escalate = deal.outreach?.filter(
    (o) =>
      o.status === "EscalateToHuman" || o.status === "NeedClarification",
  );
  if (escalate?.length) {
    push(
      items,
      {
        id: `${deal.id}-out`,
        dealId: deal.id,
        severity: "warning",
        category: "outreach",
        title: "Outreach needs human",
        detail: escalate
          .map((o) => `${o.factoryName}: ${o.status}`)
          .join("; "),
        nextStep: "Open Outreach and resolve escalations",
        href: `/outreach`,
      },
      deal,
    );
  }

  const warnDays = STAGE_AGING_WARN_DAYS[deal.stage];
  if (
    deal.stage !== "closed" &&
    warnDays != null &&
    age >= warnDays
  ) {
    push(
      items,
      {
        id: `${deal.id}-age`,
        dealId: deal.id,
        severity: age >= warnDays * 1.5 ? "warning" : "info",
        category: "stage_aging",
        title: `Stalled in ${STAGE_LABELS[deal.stage]}`,
        detail: `${age} days since last update (threshold ${warnDays}d)`,
        nextStep: STAGE_NEXT[deal.stage],
        href,
      },
      deal,
    );
  }

  // Always offer a stage default next step as info when nothing else (healthy deal)
  if (items.length === 0 && deal.stage !== "closed") {
    push(
      items,
      {
        id: `${deal.id}-next`,
        dealId: deal.id,
        severity: "info",
        category: "stage_aging",
        title: `Next: ${STAGE_LABELS[deal.stage]}`,
        detail: "No blockers detected",
        nextStep: STAGE_NEXT[deal.stage],
        href,
      },
      deal,
    );
  }

  return items;
}

export function collectAllAttention(
  deals: Deal[],
  now = Date.now(),
): AttentionItem[] {
  return deals
    .flatMap((d) => collectDealAttention(d, now))
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        a.dealTitle.localeCompare(b.dealTitle),
    );
}

export function scoreDeal(
  deal: Deal,
  attention: AttentionItem[],
  now = Date.now(),
): DealPriority {
  const mine = attention.filter((a) => a.dealId === deal.id);
  let score = 20;
  const reasons: string[] = [];

  const crit = mine.filter((a) => a.severity === "critical").length;
  const warn = mine.filter((a) => a.severity === "warning").length;
  score += crit * 18 + warn * 8;
  if (crit) reasons.push(`${crit} critical issue${crit > 1 ? "s" : ""}`);
  if (warn) reasons.push(`${warn} warning${warn > 1 ? "s" : ""}`);

  const age = stageAgeDays(deal, now);
  const ageBoost = Math.min(20, Math.floor(age / 2));
  score += ageBoost;
  if (ageBoost >= 8) reasons.push(`Stage age ${age}d`);

  if (deal.payment?.status === "overdue") {
    score += 15;
    reasons.push("Payment overdue");
  } else if (deal.payment?.daysRemaining != null && deal.payment.daysRemaining <= 3) {
    score += 8;
    reasons.push("Payment due ≤3d");
  }

  const value = dealValueProxy(deal);
  if (value >= 15000) {
    score += 10;
    reasons.push(`Value ~$${Math.round(value).toLocaleString("en-US")}`);
  } else if (value >= 5000) {
    score += 5;
    reasons.push(`Value ~$${Math.round(value).toLocaleString("en-US")}`);
  }

  const urg = (deal.requirement?.urgency || "").toLowerCase();
  if (urg === "high" || urg === "urgent") {
    score += 8;
    reasons.push("Marked urgent");
  }

  if (deal.stage === "closed" && !mine.some((a) => a.severity !== "info")) {
    score = Math.min(score, 35);
  }

  score = Math.max(0, Math.min(100, score));
  if (reasons.length === 0) reasons.push("Baseline pipeline priority");

  return {
    dealId: deal.id,
    code: deal.code || "",
    title: deal.title,
    stage: deal.stage,
    score,
    reasons,
    attentionCount: mine.filter((a) => a.severity !== "info").length,
  };
}

export function rankDeals(deals: Deal[], now = Date.now()): DealPriority[] {
  const attention = collectAllAttention(deals, now);
  return deals
    .map((d) => scoreDeal(d, attention, now))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function todaysTodos(
  deals: Deal[],
  now = Date.now(),
): AttentionItem[] {
  const attention = collectAllAttention(deals, now);
  const today = new Date(now).toISOString().slice(0, 10);

  const dueish = attention.filter((a) => {
    if (a.severity === "critical") return true;
    if (a.dueAt) {
      const due = a.dueAt.slice(0, 10);
      return due <= today;
    }
    if (
      a.category === "booking" ||
      a.category === "payment" ||
      a.category === "discrepancy" ||
      a.category === "production"
    ) {
      return a.severity === "warning";
    }
    return false;
  });

  // Ensure each open deal with warnings contributes a next step
  const seen = new Set(dueish.map((a) => a.id));
  for (const d of deals) {
    if (d.stage === "closed") continue;
    const top = attention.find(
      (a) => a.dealId === d.id && a.severity !== "info" && !seen.has(a.id),
    );
    if (top && dueish.length < 12) {
      dueish.push(top);
      seen.add(top.id);
    }
  }

  return dueish
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 12);
}

export function companyPulse(deals: Deal[], now = Date.now()): CompanyPulse {
  const attention = collectAllAttention(deals, now);
  const byStage = Object.fromEntries(
    ALL_STAGES.map((s) => [s, 0]),
  ) as Record<DealStage, number>;
  let ageSum = 0;
  let open = 0;
  let closed = 0;

  for (const d of deals) {
    byStage[d.stage] = (byStage[d.stage] || 0) + 1;
    if (d.stage === "closed") closed += 1;
    else {
      open += 1;
      ageSum += stageAgeDays(d, now);
    }
  }

  const criticalAttention = attention.filter((a) => a.severity === "critical").length;
  const warningAttention = attention.filter((a) => a.severity === "warning").length;
  const overduePayments = deals.filter((d) => d.payment?.status === "overdue").length;
  const atRiskCount = new Set(
    attention
      .filter((a) => a.severity === "critical" || a.severity === "warning")
      .map((a) => a.dealId),
  ).size;

  return {
    openDeals: open,
    closedDeals: closed,
    byStage,
    atRiskCount,
    overduePayments,
    criticalAttention,
    warningAttention,
    avgStageAgeDays: open ? Math.round(ageSum / open) : 0,
    needsAttentionNow: criticalAttention + warningAttention,
  };
}

/** Local Markdown brief when the daily-brief worker is unavailable. */
export function buildLocalBrief(deals: Deal[], now = Date.now()): string {
  const pulse = companyPulse(deals, now);
  const todos = todaysTodos(deals, now);
  const ranked = rankDeals(deals, now).slice(0, 5);
  const date = new Date(now).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const lines = [
    `## Morning brief · ${date}`,
    "",
    `**Book of business:** ${pulse.openDeals} open · ${pulse.atRiskCount} at risk · ${pulse.overduePayments} overdue payments · avg stage age ${pulse.avgStageAgeDays}d.`,
    "",
    "### Needs you now",
  ];

  const crit = collectAllAttention(deals, now).filter(
    (a) => a.severity === "critical",
  );
  if (crit.length === 0) {
    lines.push("- No critical blockers — stay on warning items and cut-offs.");
  } else {
    for (const c of crit.slice(0, 6)) {
      lines.push(`- **${c.dealTitle}:** ${c.title} — ${c.nextStep}`);
    }
  }

  lines.push("", "### Today's todos");
  for (const t of todos.slice(0, 8)) {
    lines.push(`1. ${t.nextStep} _( ${t.dealTitle} )_`);
  }

  lines.push("", "### Priority queue");
  for (const r of ranked) {
    lines.push(
      `- **${r.score}** · ${r.code ? r.code + " · " : ""}${r.title} (${STAGE_LABELS[r.stage]}) — ${r.reasons.slice(0, 2).join("; ")}`,
    );
  }

  lines.push(
    "",
    "_Facts computed locally from deal state. Refresh intelligence to narrate with ops agents._",
  );
  return lines.join("\n");
}

/** Compact fact pack for workers + Ops Copilot grounding. */
export function buildOpsFactPack(deals: Deal[], now = Date.now()) {
  const pulse = companyPulse(deals, now);
  const attention = collectAllAttention(deals, now);
  const ranked = rankDeals(deals, now);
  const todos = todaysTodos(deals, now);

  return {
    asOf: new Date(now).toISOString(),
    pulse,
    attention: attention.map((a) => ({
      id: a.id,
      dealId: a.dealId,
      dealCode: a.dealCode,
      dealTitle: a.dealTitle,
      severity: a.severity,
      category: a.category,
      title: a.title,
      detail: a.detail,
      nextStep: a.nextStep,
      dueAt: a.dueAt,
    })),
    todos: todos.map((t) => ({
      id: t.id,
      dealCode: t.dealCode,
      dealTitle: t.dealTitle,
      title: t.title,
      nextStep: t.nextStep,
      severity: t.severity,
    })),
    ranked: ranked.map((r) => ({
      dealId: r.dealId,
      code: r.code,
      title: r.title,
      stage: r.stage,
      score: r.score,
      reasons: r.reasons,
    })),
    deals: deals.map((d) => ({
      id: d.id,
      code: d.code,
      title: d.title,
      stage: d.stage,
      updatedAt: d.updatedAt,
      urgency: d.requirement?.urgency,
      paymentStatus: d.payment?.status,
      docsComplete: d.docsPack?.complete,
      productionBlockers: d.production?.blockers || [],
      discrepancyAligned: d.discrepancy?.aligned,
    })),
  };
}
