/**
 * Payment-term schedule analytics — month-wise and order-wise
 * received vs about-to-come installments from PO/PI checkpoints.
 */
import type {
  Deal,
  DealPaymentSchedule,
  PaymentCheckpoint,
  PaymentCheckpointStatus,
  ProvenanceCite,
} from "@/types/trade";
import type { CashDrillDeal } from "./cashExposure";
import type { BuyerCommissionRate } from "./agencyCommission";
import { toAgencyShareUsd } from "./agencyCommission";

export interface PaymentLine {
  dealId: string;
  dealCode: string;
  title: string;
  checkpointId: string;
  side: PaymentCheckpoint["side"];
  label: string;
  amountUsd: number;
  status: PaymentCheckpointStatus;
  dueDate?: string;
  receivedAt?: string;
  checkpoint?: string;
  /** Days past due (received late or still outstanding) */
  daysLate?: number;
  /** Still unpaid after due date */
  notReceived?: boolean;
  termsExcerpt?: string;
  monthKey: string;
  monthLabel: string;
  sources: ProvenanceCite[];
  href: string;
  buyerTerms?: string;
  factoryTerms?: string;
}

export interface MonthPaymentBucket {
  monthKey: string;
  monthLabel: string;
  receivedUsd: number;
  upcomingUsd: number;
  overdueUsd: number;
  lines: PaymentLine[];
}

export interface OrderPaymentBucket {
  dealId: string;
  dealCode: string;
  title: string;
  buyerTerms?: string;
  factoryTerms?: string;
  receivedUsd: number;
  upcomingUsd: number;
  overdueUsd: number;
  lines: PaymentLine[];
  href: string;
}

export interface PaymentScheduleReport {
  asOf: string;
  agencyMode?: boolean;
  /** Buyer remittances (recovery lane) */
  buyerReceivedUsd: number;
  buyerUpcomingUsd: number;
  buyerOverdueUsd: number;
  /** Factory payables (deploy lane) */
  factoryReceivedUsd: number;
  factoryUpcomingUsd: number;
  factoryOverdueUsd: number;
  byMonth: MonthPaymentBucket[];
  byOrder: OrderPaymentBucket[];
  lines: PaymentLine[];
  summary: string;
}

export type PaymentScheduleOptions = {
  agencyMode?: boolean;
  rates?: BuyerCommissionRate[];
};

function monthKeyFromIso(iso?: string, fallback = new Date()): string {
  const d = iso ? new Date(`${iso}T12:00:00`) : fallback;
  if (Number.isNaN(d.getTime())) {
    return `${fallback.getUTCFullYear()}-${String(fallback.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m || 1) - 1, 1));
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function scheduleSources(
  deal: Deal,
  schedule: DealPaymentSchedule,
  cp: PaymentCheckpoint,
): ProvenanceCite[] {
  const cites: ProvenanceCite[] = [];
  const pushMsg = (s: (typeof deal.sources)[number], excerpt?: string) => {
    cites.push({
      dealId: deal.id,
      dealCode: deal.code,
      sourceId: s.id,
      kind: s.kind,
      subject: s.subject || s.label,
      from: s.from,
      excerpt: (
        excerpt ||
        s.extractedSummary ||
        s.body ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220),
    });
  };

  // Prefer the confirmation email for this checkpoint
  if (cp.confirmationSourceId) {
    const match = (deal.sources || []).find(
      (s) => s.id === cp.confirmationSourceId,
    );
    if (match) {
      pushMsg(
        match,
        cp.status === "received"
          ? `Confirmed ${cp.label}: ${cp.amountUsd ? `$${cp.amountUsd.toLocaleString()}` : ""} received${cp.receivedAt ? ` on ${cp.receivedAt}` : ""}`
          : match.extractedSummary,
      );
    }
  }

  // Terms artefacts (PO / PI)
  for (const s of deal.sources || []) {
    if (!["po", "pi", "payment"].includes(s.kind)) continue;
    if (cites.some((c) => c.sourceId === s.id)) continue;
    pushMsg(
      s,
      s.kind === "po" || s.kind === "pi"
        ? `Payment terms: ${cp.termsExcerpt || schedule.buyerTerms || schedule.factoryTerms || s.extractedSummary || ""}`
        : undefined,
    );
    if (cites.length >= 3) break;
  }

  if (!cites.length && schedule.sources?.length) {
    cites.push(...schedule.sources.slice(0, 3));
  }

  return cites;
}

/** Days late vs due date — positive means past due. */
export function computeDaysLate(
  cp: Pick<PaymentCheckpoint, "dueDate" | "receivedAt" | "status">,
  asOf = new Date(),
): number | undefined {
  if (!cp.dueDate) return undefined;
  const due = Date.parse(`${cp.dueDate}T12:00:00`);
  if (Number.isNaN(due)) return undefined;

  if (cp.status === "received" && cp.receivedAt) {
    const got = Date.parse(`${cp.receivedAt}T12:00:00`);
    if (Number.isNaN(got)) return undefined;
    const days = Math.round((got - due) / 86400000);
    return days > 0 ? days : undefined;
  }

  if (
    cp.status === "overdue" ||
    cp.status === "due" ||
    (cp.status === "upcoming" && due < asOf.getTime())
  ) {
    const days = Math.round((asOf.getTime() - due) / 86400000);
    return days > 0 ? days : days === 0 ? 0 : undefined;
  }
  return undefined;
}

export function lateLabel(daysLate?: number, notReceived?: boolean): string | null {
  if (daysLate == null || daysLate <= 0) {
    return notReceived ? "Not received" : null;
  }
  const late = `+${daysLate}D`;
  return notReceived ? `${late} · not received` : `${late} late`;
}

export function ensurePaymentSchedule(deal: Deal): DealPaymentSchedule | undefined {
  return deal.paymentSchedule;
}

export function linesFromDeal(deal: Deal): PaymentLine[] {
  const schedule = ensurePaymentSchedule(deal);
  if (!schedule?.checkpoints?.length) return [];
  return schedule.checkpoints.map((cp) => {
    const daysLate = computeDaysLate(cp);
    const notReceived =
      cp.status === "overdue" ||
      (daysLate != null &&
        daysLate > 0 &&
        cp.status !== "received" &&
        cp.status !== "waived");
    const anchor =
      cp.status === "received" ? cp.receivedAt || cp.dueDate : cp.dueDate;
    const key = monthKeyFromIso(anchor);
    return {
      dealId: deal.id,
      dealCode: deal.code,
      title: deal.title,
      checkpointId: cp.id,
      side: cp.side,
      label: cp.label,
      amountUsd: cp.amountUsd,
      status: cp.status,
      dueDate: cp.dueDate,
      receivedAt: cp.receivedAt,
      checkpoint: cp.checkpoint,
      daysLate,
      notReceived,
      termsExcerpt: cp.termsExcerpt,
      monthKey: key,
      monthLabel: monthLabel(key),
      sources: scheduleSources(deal, schedule, cp),
      href: `/deals/${deal.id}#payments`,
      buyerTerms: schedule.buyerTerms,
      factoryTerms: schedule.factoryTerms,
    };
  });
}

export function paymentLineToDrill(line: PaymentLine): CashDrillDeal {
  const late = lateLabel(line.daysLate, line.notReceived);
  return {
    dealId: line.dealId,
    dealCode: line.dealCode,
    title: line.title,
    amountUsd: line.amountUsd,
    meta: [
      line.side === "buyer" ? "Buyer" : "Factory",
      line.label,
      line.checkpoint,
      line.status === "received"
        ? `received ${line.receivedAt || ""}`.trim()
        : `due ${line.dueDate || "—"}`,
      late,
      line.termsExcerpt,
    ]
      .filter(Boolean)
      .join(" · "),
    sources: line.sources,
    href: line.href,
  };
}

function sum(lines: PaymentLine[], pred: (l: PaymentLine) => boolean) {
  return lines.filter(pred).reduce((a, l) => a + l.amountUsd, 0);
}

/** Month-wise received / upcoming / overdue for one order's payment lines. */
export function monthBucketsFromLines(lines: PaymentLine[]): MonthPaymentBucket[] {
  const byMonthMap = new Map<string, MonthPaymentBucket>();
  for (const line of lines) {
    let bucket = byMonthMap.get(line.monthKey);
    if (!bucket) {
      bucket = {
        monthKey: line.monthKey,
        monthLabel: line.monthLabel,
        receivedUsd: 0,
        upcomingUsd: 0,
        overdueUsd: 0,
        lines: [],
      };
      byMonthMap.set(line.monthKey, bucket);
    }
    bucket.lines.push(line);
    if (line.status === "received") bucket.receivedUsd += line.amountUsd;
    else if (line.status === "overdue") bucket.overdueUsd += line.amountUsd;
    else if (line.status === "upcoming" || line.status === "due")
      bucket.upcomingUsd += line.amountUsd;
  }
  return [...byMonthMap.values()].sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );
}

export function buildPaymentScheduleReport(
  deals: Deal[],
  options: PaymentScheduleOptions = {},
): PaymentScheduleReport {
  const agencyMode = Boolean(options.agencyMode);
  const rates = options.rates || [];
  const asOf = new Date().toISOString().slice(0, 10);
  const dealById = new Map(deals.map((d) => [d.id, d]));

  let lines = deals.flatMap(linesFromDeal);
  if (agencyMode) {
    lines = lines.map((line) => {
      const deal = dealById.get(line.dealId);
      if (!deal) return { ...line, amountUsd: 0 };
      const share = toAgencyShareUsd(deal, line.amountUsd, rates);
      return {
        ...line,
        amountUsd: share.amountUsd,
        termsExcerpt: share.configured
          ? `${line.termsExcerpt || line.label} · ${share.pct}% commission`
          : `${line.termsExcerpt || line.label} · commission % not configured`,
      };
    });
  }

  const byMonth = monthBucketsFromLines(lines);

  const byOrderMap = new Map<string, OrderPaymentBucket>();
  for (const deal of deals) {
    const schedule = ensurePaymentSchedule(deal);
    const dealLines = lines.filter((l) => l.dealId === deal.id);
    if (!dealLines.length) continue;
    byOrderMap.set(deal.id, {
      dealId: deal.id,
      dealCode: deal.code,
      title: deal.title,
      buyerTerms: schedule?.buyerTerms,
      factoryTerms: schedule?.factoryTerms,
      receivedUsd: sum(dealLines, (l) => l.status === "received"),
      upcomingUsd: sum(
        dealLines,
        (l) => l.status === "upcoming" || l.status === "due",
      ),
      overdueUsd: sum(dealLines, (l) => l.status === "overdue"),
      lines: dealLines,
      href: `/deals/${deal.id}`,
    });
  }

  const byOrder = [...byOrderMap.values()].sort(
    (a, b) =>
      b.upcomingUsd + b.overdueUsd + b.receivedUsd -
      (a.upcomingUsd + a.overdueUsd + a.receivedUsd),
  );

  const buyer = lines.filter((l) => l.side === "buyer");
  const factory = lines.filter((l) => l.side === "factory");

  const buyerReceivedUsd = sum(buyer, (l) => l.status === "received");
  const buyerUpcomingUsd = sum(
    buyer,
    (l) => l.status === "upcoming" || l.status === "due",
  );
  const buyerOverdueUsd = sum(buyer, (l) => l.status === "overdue");
  const factoryReceivedUsd = sum(factory, (l) => l.status === "received");
  const factoryUpcomingUsd = sum(
    factory,
    (l) => l.status === "upcoming" || l.status === "due",
  );
  const factoryOverdueUsd = sum(factory, (l) => l.status === "overdue");

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return {
    asOf,
    agencyMode,
    buyerReceivedUsd,
    buyerUpcomingUsd,
    buyerOverdueUsd,
    factoryReceivedUsd,
    factoryUpcomingUsd,
    factoryOverdueUsd,
    byMonth,
    byOrder,
    lines,
    summary: agencyMode
      ? `Agency commission share — buyer received ${fmt(buyerReceivedUsd)} · upcoming ${fmt(buyerUpcomingUsd + buyerOverdueUsd)}`
      : `Buyer received ${fmt(buyerReceivedUsd)} · due/upcoming ${fmt(buyerUpcomingUsd + buyerOverdueUsd)} · factory paid ${fmt(factoryReceivedUsd)} · still to pay factory ${fmt(factoryUpcomingUsd + factoryOverdueUsd)}`,
  };
}

/** Totals used by cash exposure when a schedule exists. */
export function scheduleCashHints(deal: Deal): {
  cashDeployedUsd: number;
  cashStillRequiredUsd: number;
  receivableExpectedUsd: number;
  receivableStatus: "none" | "expected" | "overdue" | "collected";
} | null {
  const schedule = ensurePaymentSchedule(deal);
  if (!schedule?.checkpoints?.length) return null;
  const factory = schedule.checkpoints.filter((c) => c.side === "factory");
  const buyer = schedule.checkpoints.filter((c) => c.side === "buyer");
  const cashDeployedUsd = factory
    .filter((c) => c.status === "received")
    .reduce((a, c) => a + c.amountUsd, 0);
  const cashStillRequiredUsd = factory
    .filter((c) => c.status === "upcoming" || c.status === "due" || c.status === "overdue")
    .reduce((a, c) => a + c.amountUsd, 0);
  const openBuyer = buyer.filter(
    (c) => c.status === "upcoming" || c.status === "due" || c.status === "overdue",
  );
  const receivableExpectedUsd = openBuyer.reduce((a, c) => a + c.amountUsd, 0);
  const allBuyerReceived =
    buyer.length > 0 && buyer.every((c) => c.status === "received");
  const anyOverdue = openBuyer.some((c) => c.status === "overdue");
  return {
    cashDeployedUsd,
    cashStillRequiredUsd,
    receivableExpectedUsd,
    receivableStatus: allBuyerReceived
      ? "collected"
      : anyOverdue
        ? "overdue"
        : receivableExpectedUsd > 0
          ? "expected"
          : "none",
  };
}
