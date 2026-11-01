/**
 * Agency commission lifecycle — visibility overlay only.
 * Commission is the last step: it becomes due once shipment evidence exists
 * (sailed / BL / arrived) — NOT merely because stage mapped to docs_payment.
 */
import type { Deal } from "@/types/trade";
import {
  agencyCommissionForDeal,
  type BuyerCommissionRate,
} from "./agencyCommission";
import { dealCommercialModel } from "./commercialModel";

export type CommissionLifecycleStatus =
  | "not_due"
  | "due"
  | "overdue"
  | "received";

const SAILED: NonNullable<
  NonNullable<Deal["booking"]>["shipmentStatus"]
>[] = ["in_waters", "about_to_arrive", "arrived"];

function etdPast(deal: Deal, asOf: Date): boolean {
  const etd = deal.booking?.etd;
  if (!etd) return false;
  // Prefer sailed language in booking summary before trusting ETD alone
  const summary = `${deal.booking?.summary || ""} ${deal.sources?.map((s) => s.extractedSummary || "").join(" ") || ""}`;
  const sailedLang =
    /\b(sailed|has\s+sailed|vessel\s+sailed|departed|in\s+waters|on\s+board)\b/i.test(
      summary,
    );
  const t = Date.parse(`${etd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(t)) return false;
  return sailedLang || (t <= asOf.getTime() && Boolean(deal.booking?.vessel));
}

/** Shipment done → commission stage of the lifecycle opens. */
export function isShipmentDone(deal: Deal, asOf = new Date()): boolean {
  if (deal.payment?.blSharedDate) return true;
  const status = deal.booking?.shipmentStatus;
  if (status && SAILED.includes(status)) return true;
  if (etdPast(deal, asOf)) return true;
  // Closed with booking evidence (not payment-only mailbox rows)
  if (
    deal.stage === "closed" &&
    (deal.booking?.vessel || deal.booking?.etd || deal.payment?.blSharedDate)
  ) {
    return true;
  }
  // Explicit commission checklist / commission stage after logistics
  if (
    deal.mailboxSlot === "commission_checklist" ||
    deal.commission?.items?.length
  ) {
    return true;
  }
  return false;
}

/**
 * Gate for Agency commission due. Prefer true shipment evidence; also open when
 * commercial is locked and logistics stage has started (booking/docs) — mailbox
 * often has value on PO extract and sail on a separate docs row without shared $.
 */
export function isCommissionGateOpen(deal: Deal, asOf = new Date()): boolean {
  if (isShipmentDone(deal, asOf)) return true;
  const value =
    deal.economics?.commercialValueUsd ||
    deal.payment?.amountUsd ||
    deal.po?.totalAmount ||
    deal.pi?.totalAmount ||
    0;
  if (!(value > 0)) return false;
  if (["booking", "docs_payment", "closed"].includes(deal.stage)) return true;
  return false;
}

export function isCommissionReceived(deal: Deal): boolean {
  if (deal.commission?.complete) return true;
  if (deal.cashExposure?.commissionStatus === "received") return true;
  const blob = `${deal.commission?.summary || ""} ${deal.payment?.summary || ""}`;
  if (
    /\b(commission\s+(?:received|paid|credited|settled)|fee\s+received)\b/i.test(
      blob,
    )
  ) {
    return true;
  }
  return false;
}

/** Days since shipment gate (ETD / BL / ETA) — positive = past. */
export function daysSinceShipmentGate(
  deal: Deal,
  asOf = new Date(),
): number | undefined {
  const raw =
    deal.payment?.blSharedDate ||
    deal.booking?.etd ||
    deal.booking?.eta ||
    (deal.commission?.items?.length ? deal.updatedAt : undefined);
  if (!raw) return undefined;
  const t = Date.parse(`${String(raw).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(t)) return undefined;
  return Math.round((asOf.getTime() - t) / 86400000);
}

/**
 * Lifecycle status for Agency commission.
 * not_due until shipped; then due / overdue / received.
 */
export function commissionLifecycleStatus(
  deal: Deal,
  asOf = new Date(),
): CommissionLifecycleStatus {
  if (isCommissionReceived(deal)) return "received";
  if (!isCommissionGateOpen(deal, asOf)) return "not_due";

  if (deal.cashExposure?.commissionStatus === "chasing") return "overdue";
  const days = daysSinceShipmentGate(deal, asOf);
  // Typical T/T + commission lag — treat >30d post-gate unpaid as overdue
  if (days != null && days > 30) return "overdue";
  if (deal.stage === "closed" && (days == null || days > 14)) {
    return "overdue";
  }
  // Booking/docs with value but no sail date yet — due, not overdue
  return "due";
}

export type AgencyCommissionBookLine = {
  dealId: string;
  dealCode: string;
  title: string;
  amountUsd: number;
  meta?: string;
  href: string;
  sources: [];
  lifecycle: CommissionLifecycleStatus;
  buyerName?: string;
  pct?: number | null;
};

export type AgencyCommissionBook = {
  /** Shipped deals — commission in play (due + overdue + received) */
  bookUsd: number;
  collectedUsd: number;
  outstandingUsd: number;
  overdueUsd: number;
  /** Pre-shipment — not yet due */
  notYetDueUsd: number;
  collectionPct: number;
  commercialFootnoteUsd: number;
  lines: AgencyCommissionBookLine[];
  collectedLines: AgencyCommissionBookLine[];
  outstandingLines: AgencyCommissionBookLine[];
  overdueLines: AgencyCommissionBookLine[];
  notYetDueLines: AgencyCommissionBookLine[];
};

export function buildAgencyCommissionBook(
  deals: Deal[],
  rates: BuyerCommissionRate[],
  asOf = new Date(),
): AgencyCommissionBook {
  const lines: AgencyCommissionBookLine[] = [];
  let bookUsd = 0;
  let collectedUsd = 0;
  let outstandingUsd = 0;
  let overdueUsd = 0;
  let notYetDueUsd = 0;
  let commercialFootnoteUsd = 0;

  for (const d of deals) {
    if (dealCommercialModel(d) !== "agency_commission") continue;
    const overlay = agencyCommissionForDeal(d, rates);
    commercialFootnoteUsd += overlay.commercialValueUsd;
    const amount = overlay.commissionUsd;
    if (!(amount > 0)) continue;

    const lifecycle = commissionLifecycleStatus(d, asOf);
    const days = daysSinceShipmentGate(d, asOf);
    const line: AgencyCommissionBookLine = {
      dealId: d.id,
      dealCode: d.code,
      title: d.title,
      amountUsd: amount,
      meta: [
        lifecycle === "not_due"
          ? "Not yet due · awaiting shipment"
          : lifecycle === "received"
            ? "Commission received"
            : lifecycle === "overdue"
              ? `Commission overdue${days != null && days > 0 ? ` · +${days}D post-shipment` : ""}`
              : "Commission due · shipment done",
        overlay.pct != null ? `${overlay.pct}%` : null,
        overlay.buyerName,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/deals/${d.id}`,
      sources: [],
      lifecycle,
      buyerName: overlay.buyerName,
      pct: overlay.pct,
    };
    lines.push(line);

    if (lifecycle === "not_due") {
      notYetDueUsd += amount;
      continue;
    }
    bookUsd += amount;
    if (lifecycle === "received") collectedUsd += amount;
    else if (lifecycle === "overdue") {
      overdueUsd += amount;
      outstandingUsd += amount;
    } else {
      outstandingUsd += amount;
    }
  }

  const collectionPct =
    bookUsd > 0 ? Math.round((collectedUsd / bookUsd) * 1000) / 10 : 0;

  return {
    bookUsd,
    collectedUsd,
    outstandingUsd,
    overdueUsd,
    notYetDueUsd,
    collectionPct,
    commercialFootnoteUsd,
    lines,
    collectedLines: lines.filter((l) => l.lifecycle === "received"),
    outstandingLines: lines.filter(
      (l) => l.lifecycle === "due" || l.lifecycle === "overdue",
    ),
    overdueLines: lines.filter((l) => l.lifecycle === "overdue"),
    notYetDueLines: lines.filter((l) => l.lifecycle === "not_due"),
  };
}
