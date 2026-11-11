/**
 * Team early warnings from the hydrated mailbox book.
 * Day windows use the Asia/Kolkata calendar. One deal can emit several rows.
 */
import type { Deal } from "@/types/trade";

export type EarlyWarningKind = "po_risk" | "delivery_risk" | "action_needed";

export interface EarlyWarning {
  id: string;
  dealId: string | null;
  dealCode: string;
  kind: EarlyWarningKind;
  severity: "critical" | "warning";
  title: string;
  reason: string;
  href: string;
  sortBand: number;
  sortKey: string;
}

const TITLE: Record<EarlyWarningKind, string> = {
  po_risk: "PO at risk",
  delivery_risk: "Delivery at risk",
  action_needed: "Action needed",
};

function kolkataDay(ms: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function asDay(stamp: string | undefined) {
  if (!stamp) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp;
  const ms = Date.parse(stamp);
  if (Number.isNaN(ms)) return null;
  return kolkataDay(ms);
}

function addDays(iso: string, n: number) {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function dayDelta(iso: string | null, today: string) {
  if (!iso) return null;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

function latestMail(deal: Deal) {
  const stamps = [
    ...deal.sources.map((s) => asDay(s.receivedAt)),
    ...deal.timeline.map((t) => asDay(t.at)),
  ].filter((d): d is string => Boolean(d));
  return stamps.sort().at(-1) ?? null;
}

function hasOrderAmount(deal: Deal) {
  return (deal.po?.totalAmount || 0) > 0 || (deal.pi?.totalAmount || 0) > 0;
}

function row(
  deal: Deal | null,
  kind: EarlyWarningKind,
  reason: string,
  sortBand: number,
  sortKey: string,
  suffix: string,
): EarlyWarning {
  const id = deal ? `${deal.id}-${suffix}` : "book-failed-extracts";
  return {
    id,
    dealId: deal?.id ?? null,
    dealCode: deal?.code ?? "",
    kind,
    severity: kind === "action_needed" ? "warning" : "critical",
    title: TITLE[kind],
    reason,
    href: deal ? `/deals/${deal.id}` : "/mailbox",
    sortBand,
    sortKey,
  };
}

function paymentRow(deal: Deal, today: string): EarlyWarning | null {
  if (!hasOrderAmount(deal) || deal.payment?.status === "paid") return null;
  const due = asDay(deal.payment?.dueDate);
  const dueDelta = dayDelta(due, today);
  const buyerCheckpoint =
    deal.paymentSchedule?.checkpoints.some((c) => {
      if (c.side !== "buyer" || c.status !== "overdue") return false;
      const checkpointDue = asDay(c.dueDate);
      return Boolean(due && checkpointDue === due);
    }) ?? false;
  if (deal.payment?.status === "overdue" || buyerCheckpoint) {
    const band = dueDelta != null && dueDelta >= -30 && dueDelta <= 0 ? 1 : 3;
    return row(deal, "po_risk", "Payment overdue", band, due || "payment", "payment");
  }
  if (dueDelta != null && dueDelta >= 0 && dueDelta <= 7) {
    return row(deal, "action_needed", `Payment due ${due}`, 4, due || "due", "due");
  }
  return null;
}

function deliveryRow(deal: Deal, today: string): EarlyWarning | null {
  const eta = asDay(deal.booking?.eta);
  const etd = asDay(deal.booking?.etd);
  const etaDelta = dayDelta(eta, today);
  const etdDelta = dayDelta(etd, today);
  const unpaid = Boolean(deal.payment) && deal.payment?.status !== "paid";
  if (etaDelta != null && etaDelta >= -21 && etaDelta <= -1 && unpaid) {
    return row(
      deal,
      "delivery_risk",
      "ETA passed, delivery not confirmed",
      2,
      eta || "eta",
      "delivery",
    );
  }
  const mail = latestMail(deal);
  const mailDelta = dayDelta(mail, today);
  if (
    !eta &&
    etdDelta != null &&
    etdDelta <= -3 &&
    mailDelta != null &&
    mailDelta >= -90
  ) {
    return row(
      deal,
      "delivery_risk",
      "Sail date passed, no arrival date",
      2,
      etd || "etd",
      "delivery",
    );
  }
  return null;
}

function docsRow(deal: Deal, today: string): EarlyWarning | null {
  const missing = deal.docsPack?.missing?.length || 0;
  const etd = asDay(deal.booking?.etd);
  const etdDelta = dayDelta(etd, today);
  if (missing > 0 && etdDelta != null && etdDelta >= -7 && etdDelta <= 14) {
    return row(
      deal,
      "action_needed",
      `Docs missing: ${deal.docsPack?.missing.join(", ")}`,
      4,
      etd || "docs",
      "docs",
    );
  }
  return null;
}

function cutoffDates(text: string, mailDay: string | null) {
  const out: string[] = [];
  for (const iso of text.match(/\d{4}-\d{2}-\d{2}/g) || []) out.push(iso);
  for (const raw of text.match(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g) || []) {
    const m = raw.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (!m) continue;
    out.push(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  if (mailDay && /\btomorrow\b/i.test(text)) out.push(addDays(mailDay, 1));
  if (mailDay) {
    for (const m of text.matchAll(/\+\s*(\d+)\s*days?\b/gi)) {
      out.push(addDays(mailDay, Number(m[1])));
    }
  }
  return out;
}

function cutoffRow(deal: Deal, today: string): EarlyWarning | null {
  const text = deal.booking?.cutOffs || "";
  if (!text) return null;
  const etdDelta = dayDelta(asDay(deal.booking?.etd), today);
  if (etdDelta != null && etdDelta < 0) return null;
  const hit = cutoffDates(text, latestMail(deal)).find((d) => {
    const delta = dayDelta(d, today);
    return delta != null && delta >= -2 && delta <= 3;
  });
  if (!hit) return null;
  return row(deal, "action_needed", "Booking cut-off", 4, hit, "cutoff");
}

function mismatchRow(deal: Deal, today: string): EarlyWarning | null {
  if (deal.commercialModel === "trader_principal") return null;
  const buyer = deal.po?.totalAmount;
  const factory = deal.pi?.totalAmount;
  if (!buyer || !factory) return null;
  const gap = Math.abs(buyer - factory) / Math.max(buyer, factory);
  if (gap <= 0.05) return null;
  const mailDelta = dayDelta(latestMail(deal), today);
  if (mailDelta == null || mailDelta < -90) return null;
  return row(
    deal,
    "po_risk",
    "Buyer and factory amounts differ",
    3,
    "mismatch",
    "mismatch",
  );
}

function skipDeal(deal: Deal) {
  return Boolean(
    deal.portfolioSeed || deal.showcase || deal.id.startsWith("bob-"),
  );
}

/** Rows for the selected book, plus one book row when extracts failed. */
export function collectEarlyWarnings(
  deals: Deal[],
  opts?: { failedExtracts?: number; now?: number },
): EarlyWarning[] {
  const today = kolkataDay(opts?.now ?? Date.now());
  const rows: EarlyWarning[] = [];
  const failed = opts?.failedExtracts || 0;
  if (failed > 0) {
    rows.push(
      row(
        null,
        "action_needed",
        `${failed} mailbox extracts failed`,
        0,
        "failed",
        "failed",
      ),
    );
  }
  for (const deal of deals) {
    if (skipDeal(deal)) continue;
    const hits = [
      paymentRow(deal, today),
      deliveryRow(deal, today),
      docsRow(deal, today),
      cutoffRow(deal, today),
      mismatchRow(deal, today),
    ];
    for (const hit of hits) if (hit) rows.push(hit);
  }
  rows.sort(
    (a, b) =>
      a.sortBand - b.sortBand ||
      a.sortKey.localeCompare(b.sortKey) ||
      a.dealCode.localeCompare(b.dealCode),
  );
  return rows;
}
