/** Deal code helpers — human-facing SNS-YY-NNNN */

export function formatDealCode(seq: number, at = new Date()): string {
  const yy = String(at.getFullYear()).slice(-2);
  return `SNS-${yy}-${String(seq).padStart(4, "0")}`;
}

/** Stable codes for seeded portfolio deals */
export const SEEDED_DEAL_CODES: Record<string, string> = {
  "bob-showcase-petrageous": "SNS-26-1001",
  "bob-loving-pets-discrepancy": "SNS-26-1002",
  "bob-neater-artwork": "SNS-26-1003",
  "bob-swastik-production": "SNS-26-1004",
  "bob-global-praise-selection": "SNS-26-1005",
  "bob-barktrunk-quoting": "SNS-26-1006",
  "bob-yk-booking-cutoff": "SNS-26-1007",
  "bob-closed-commission": "SNS-26-1008",
};

export function dealLabel(deal: { code?: string; title: string }): string {
  return deal.code ? `${deal.code} · ${deal.title}` : deal.title;
}

/** Day index from deal open (Day 1 = created date calendar day). */
export function dealDayNumber(
  dealCreatedAt: string,
  eventAt: string,
): number {
  const start = Date.parse(dealCreatedAt.slice(0, 10) + "T00:00:00");
  const at = Date.parse(eventAt.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(start) || Number.isNaN(at)) return 1;
  return Math.max(1, Math.floor((at - start) / 86400000) + 1);
}

export function formatDealDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
