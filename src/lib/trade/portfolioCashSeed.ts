/** Seeded cash exposure for the portfolio book of business. */
import type { DealCashExposure, ProvenanceCite } from "@/types/trade";

function cite(
  dealId: string,
  dealCode: string,
  sourceId: string,
  excerpt: string,
  subject?: string,
): ProvenanceCite {
  return {
    dealId,
    dealCode,
    sourceId,
    excerpt,
    subject,
    from: "accounts@snspl.in",
    kind: "payment",
  };
}

export const SEEDED_CASH: Record<string, DealCashExposure> = {
  "bob-showcase-petrageous": {
    pipelineCommitmentUsd: 24800,
    cashDeployedUsd: 24800,
    cashStillRequiredUsd: 0,
    receivableExpectedUsd: 24800,
    receivableDueDate: new Date(Date.now() + 8 * 86400000)
      .toISOString()
      .slice(0, 10),
    receivableStatus: "expected",
    blockedAt: "buyer",
    payGapDays: 32,
    commissionInvoiceUsd: 1240,
    commissionStatus: "invoiced",
    commissionFxRate: "83.25 INR/USD",
    sources: [
      cite(
        "bob-showcase-petrageous",
        "SNS-26-1001",
        "src-payment-5",
        "Commercial USD 24,800 pending (due in 8 days); cash deployed 100%; blocked at buyer recovery",
        "BL shared — payment clocks",
      ),
    ],
  },
  "bob-loving-pets-discrepancy": {
    pipelineCommitmentUsd: 17200,
    cashDeployedUsd: 17200,
    cashStillRequiredUsd: 0,
    receivableExpectedUsd: 17200,
    receivableDueDate: "2026-08-31",
    receivableStatus: "overdue",
    blockedAt: "buyer",
    payGapDays: 45,
    commissionInvoiceUsd: 860,
    commissionStatus: "chasing",
    sources: [
      cite(
        "bob-loving-pets-discrepancy",
        "SNS-26-1002",
        "src-payment-lp",
        "USD 17,200 OVERDUE — cash deployed to factory; recovery blocked at buyer",
        "Payment clocks",
      ),
    ],
  },
  "bob-neater-artwork": {
    pipelineCommitmentUsd: 9800,
    cashDeployedUsd: 2940,
    cashStillRequiredUsd: 6860,
    wipValueUsd: 0,
    receivableExpectedUsd: 0,
    receivableStatus: "none",
    blockedAt: "production",
    commissionInvoiceUsd: 490,
    commissionStatus: "awaiting_fx",
    sources: [
      cite(
        "bob-neater-artwork",
        "SNS-26-1003",
        "src-artwork-9",
        "Artwork gate — ~30% advance deployed; balance still required before shipment",
        "Artwork pack",
      ),
    ],
  },
  "bob-swastik-production": {
    pipelineCommitmentUsd: 18500,
    cashDeployedUsd: 5550,
    cashStillRequiredUsd: 12950,
    wipValueUsd: 10175,
    receivableExpectedUsd: 0,
    receivableStatus: "none",
    blockedAt: "production",
    payGapDays: 40,
    commissionInvoiceUsd: 925,
    sources: [
      cite(
        "bob-swastik-production",
        "SNS-26-1004",
        "src-production-12",
        "WIP ~55% — cash in production; next balance payment after ready date",
        "Factory production update",
      ),
    ],
  },
  "bob-global-praise-selection": {
    pipelineCommitmentUsd: 12000,
    cashDeployedUsd: 0,
    cashStillRequiredUsd: 12000,
    receivableExpectedUsd: 0,
    receivableStatus: "none",
    blockedAt: "vendor",
    sources: [
      cite(
        "bob-global-praise-selection",
        "SNS-26-1005",
        "src-quote-12",
        "PI pipeline commitment only — no cash out until PO + advance",
        "Factory quote pack",
      ),
    ],
  },
  "bob-barktrunk-quoting": {
    pipelineCommitmentUsd: 9000,
    cashDeployedUsd: 0,
    cashStillRequiredUsd: 9000,
    receivableExpectedUsd: 0,
    receivableStatus: "none",
    blockedAt: "vendor",
    sources: [
      cite(
        "bob-barktrunk-quoting",
        "SNS-26-1006",
        "src-quote-1",
        "Quoting — pipeline commitment, zero cash deployed",
        "V3F quote pack",
      ),
    ],
  },
  "bob-yk-booking-cutoff": {
    pipelineCommitmentUsd: 24800,
    cashDeployedUsd: 17360,
    cashStillRequiredUsd: 7440,
    receivableExpectedUsd: 0,
    receivableStatus: "none",
    blockedAt: "transit",
    payGapDays: 28,
    commissionInvoiceUsd: 1240,
    sources: [
      cite(
        "bob-yk-booking-cutoff",
        "SNS-26-1007",
        "src-booking-1",
        "About to sail — ~70% cash deployed; exposure rolling to transit",
        "Booking cut-off",
      ),
    ],
  },
  "bob-closed-commission": {
    pipelineCommitmentUsd: 19500,
    cashDeployedUsd: 19500,
    cashStillRequiredUsd: 0,
    receivableExpectedUsd: 0,
    receivableStatus: "collected",
    blockedAt: "none",
    payGapDays: 30,
    commissionInvoiceUsd: 975,
    commissionStatus: "chasing",
    commissionFxRate: "83.25 INR/USD",
    sources: [
      cite(
        "bob-closed-commission",
        "SNS-26-1008",
        "src-commission-4",
        "Buyer paid factory; FX 83.25; agency commission USD 975 — chasing payment advice",
        "Commission close",
      ),
    ],
  },
};
